import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import type { AiPurpose, Prisma } from "@prisma/client";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodType, ZodTypeAny } from "zod";
import {
  AssessmentOutput,
  EmailGenerationOutput,
  EmailQaOutput,
  ErrorCodes,
  FieldMappingSuggestion,
  IcpExtractionOutput,
  WorkspaceSettings,
  type AssessmentBatchRequest,
  type ChatMessage,
  type EmailGenerationRequest,
  type EmailQaRequest,
  type IcpDraftDefinition,
} from "@prospect/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { ProviderRegistryService } from "../../providers/provider-registry.service";
import { AppException } from "../../common/errors";
import { ProviderCallError } from "../../common/provider-call.error";
import { POLICIES, withPolicy } from "../../common/resilience";
import { env } from "../../config/env";
import { PromptLoaderService } from "./prompt-loader.service";
import type { AiTier, GenerateStructuredMessage } from "./ai-provider.interface";

export interface AiCallerCtx {
  workspaceId: string;
  projectId?: string;
}

export interface AiCallOptions<T> {
  purpose: AiPurpose;
  promptKey: string;

  variables: Record<string, unknown>;
  messages: GenerateStructuredMessage[];

  schema: ZodType<T, any, any>;

  tier?: AiTier;
  refType?: string;
  refId?: string;
}

export interface AiCallResult<T> {
  data: T;
  aiRunId: string;
}

const zodToJsonSchemaUntyped = zodToJsonSchema as unknown as (schema: unknown, options?: unknown) => { definitions?: Record<string, unknown> };
const logger = new Logger("AiService");

function summarizeProviderError(pce: ProviderCallError): string {
  try {
    const parsed = JSON.parse(pce.message) as { error?: { message?: string } };
    if (typeof parsed.error?.message === "string") return parsed.error.message;
  } catch (e) {
    logger.debug(`Provider error message was not JSON, using it verbatim: ${e instanceof Error ? e.message : e}`);
  }
  return pce.message;
}

function toJsonSchema(schema: unknown): Record<string, unknown> {
  const converted = zodToJsonSchemaUntyped(schema, { name: "output", target: "jsonSchema7" });
  const output = converted.definitions?.output as Record<string, unknown> | undefined;
  if (!output) return converted as Record<string, unknown>;

  return JSON.parse(JSON.stringify(output).replaceAll("#/definitions/output/", "#/")) as Record<string, unknown>;
}

interface UntypedCallOptions {
  purpose: AiPurpose;
  promptKey: string;
  variables: Record<string, unknown>;
  messages: GenerateStructuredMessage[];
  schema: ZodTypeAny;
  tier?: AiTier;
  refType?: string;
  refId?: string;
}

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistryService,
    private readonly prompts: PromptLoaderService,
  ) {}

  async call<T>(caller: AiCallerCtx, opts: AiCallOptions<T>): Promise<AiCallResult<T>> {
    const result = await this.callUntyped(caller, opts as unknown as UntypedCallOptions);
    return result as AiCallResult<T>;
  }

  private async callUntyped(caller: AiCallerCtx, opts: UntypedCallOptions): Promise<AiCallResult<unknown>> {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: caller.workspaceId } });
    const settings = WorkspaceSettings.parse(workspace.settings);
    const providerKey = settings.aiProviderKey || env.AI_PROVIDER;

    const provider = this.registry.getAi(providerKey);

    this.registry.ctxFor(caller.workspaceId, provider, caller.projectId);

    const prompt = this.prompts.load(opts.promptKey);
    const tier = opts.tier ?? prompt.tier;
    const modelOverride = (env as unknown as Record<string, string | undefined>)[`AI_MODEL_${opts.purpose}`];
    const model = modelOverride || provider.defaultModel(tier);

    const system = this.prompts.render(prompt.body, opts.variables);
    const jsonSchema = toJsonSchema(opts.schema);

    const callProvider = (messages: GenerateStructuredMessage[]) =>
      withPolicy(POLICIES.ai, provider.key, (signal) =>
        provider.generateStructured({
          model,
          system,
          messages,
          jsonSchema,
          maxTokens: env.AI_MAX_OUTPUT_TOKENS,
          signal,
          meta: { purpose: opts.purpose, promptKey: opts.promptKey, promptVersion: prompt.version },
        }),
      );

    const callProviderOrFail = async (messages: GenerateStructuredMessage[]) => {
      try {
        return await callProvider(messages);
      } catch (err) {
        const pce = err instanceof ProviderCallError ? err : ProviderCallError.fromUnknown(provider.key, err);
        await this.prisma.aiRun.create({
          data: {
            workspaceId: caller.workspaceId,
            purpose: opts.purpose,
            providerKey: provider.key,
            model,
            promptKey: opts.promptKey,
            promptVersion: prompt.version,
            inputTokens: 0,
            outputTokens: 0,
            input: { system, messages } as unknown as Prisma.InputJsonValue,
            output: undefined,
            status: "FAILED",
            error: pce.message,
            refType: opts.refType ?? null,
            refId: opts.refId ?? null,
          },
        });
        const status = pce.code === "RATE_LIMITED" ? HttpStatus.TOO_MANY_REQUESTS : pce.retryable ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.BAD_GATEWAY;
        throw new AppException(status, ErrorCodes.AI_PROVIDER_ERROR, `The "${provider.key}" AI provider call failed: ${summarizeProviderError(pce)}`, {
          providerKey: provider.key,
          providerErrorCode: pce.code,
        });
      }
    };

    let result = await callProviderOrFail(opts.messages);
    let parsed = opts.schema.safeParse(result.data);
    let status: "SUCCEEDED" | "SCHEMA_RETRY" | "FAILED" = "SUCCEEDED";
    const usage = { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens };

    if (!parsed.success) {
      status = "SCHEMA_RETRY";
      const issues = parsed.error.issues.map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
      const repairMessages: GenerateStructuredMessage[] = [
        ...opts.messages,
        {
          role: "user",
          content: `Your previous response failed schema validation with these issues:\n${issues}\nRespond again with output that matches the required schema exactly. Do not add commentary.`,
        },
      ];
      result = await callProviderOrFail(repairMessages);
      parsed = opts.schema.safeParse(result.data);
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;
      if (!parsed.success) status = "FAILED";
    }

    const aiRun = await this.prisma.aiRun.create({
      data: {
        workspaceId: caller.workspaceId,
        purpose: opts.purpose,
        providerKey: provider.key,
        model,
        promptKey: opts.promptKey,
        promptVersion: prompt.version,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,

        input: { system, messages: opts.messages } as unknown as Prisma.InputJsonValue,
        output: (parsed.success ? (parsed.data as object) : { rawText: result.rawText }) as Prisma.InputJsonValue,
        rawOutput: result.rawText,
        status,
        error: parsed.success ? null : "AI output failed schema validation after one repair attempt",
        refType: opts.refType ?? null,
        refId: opts.refId ?? null,
      },
    });

    if (!parsed.success) {
      throw new AppException(HttpStatus.BAD_GATEWAY, ErrorCodes.AI_OUTPUT_INVALID, "AI provider returned output that failed schema validation twice", {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        aiRunId: aiRun.id,
      });
    }

    return { data: parsed.data, aiRunId: aiRun.id };
  }

  extractIcp(caller: AiCallerCtx, transcript: ChatMessage[], previousDraft: IcpDraftDefinition | null) {
    return this.call<IcpExtractionOutput>(caller, {
      purpose: "ICP_EXTRACTION",
      promptKey: "icp.extract",
      variables: { previousDraftJson: JSON.stringify(previousDraft ?? null) },
      messages: transcript.map((m) => ({ role: m.role, content: m.content })),
      schema: IcpExtractionOutput,
      tier: "strong",
      refType: "icp_profile",
    });
  }

  suggestCsvMapping(caller: AiCallerCtx, headers: string[], sampleRows: Record<string, string>[]) {
    return this.call<FieldMappingSuggestion>(caller, {
      purpose: "CSV_MAPPING_SUGGEST",
      promptKey: "csv.mapping",
      variables: { headersJson: JSON.stringify(headers), sampleRowsJson: JSON.stringify(sampleRows.slice(0, 5)) },
      messages: [{ role: "user", content: "Suggest the header-to-field mapping for this CSV." }],
      schema: FieldMappingSuggestion,
      tier: "fast",
      refType: "data_source",
    });
  }

  assessCriteria(caller: AiCallerCtx, batch: AssessmentBatchRequest, refId?: string) {
    return this.call<AssessmentOutput>(caller, {
      purpose: "QUALITATIVE_ASSESS",
      promptKey: "qualify.assess",
      variables: { batchJson: JSON.stringify(batch) },
      messages: [{ role: "user", content: `Assess criterion "${batch.criterionId}" for every company in the batch.` }],
      schema: AssessmentOutput,
      tier: "fast",
      refType: "qualitative_batch",
      refId,
    });
  }

  generateEmail(caller: AiCallerCtx, request: EmailGenerationRequest, refId?: string) {
    return this.call<EmailGenerationOutput>(caller, {
      purpose: "EMAIL_GENERATE",
      promptKey: "email.generate",
      variables: { requestJson: JSON.stringify(request) },
      messages: [{ role: "user", content: "Write the outreach email for this request." }],
      schema: EmailGenerationOutput,
      tier: "strong",
      refType: "message",
      refId,
    });
  }

  qaEmail(caller: AiCallerCtx, request: EmailQaRequest, refId?: string) {
    return this.call<EmailQaOutput>(caller, {
      purpose: "EMAIL_QA",
      promptKey: "email.qa",
      variables: { requestJson: JSON.stringify(request) },
      messages: [{ role: "user", content: "QA this drafted email against the supplied facts." }],
      schema: EmailQaOutput,
      tier: "fast",
      refType: "message",
      refId,
    });
  }
}
