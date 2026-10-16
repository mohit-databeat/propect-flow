import { Injectable, Logger } from "@nestjs/common";
import { WorkspaceSettings, type EffectiveModelEntry, type SettingsResponse } from "@prospect/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { ProviderRegistryService } from "../../providers/provider-registry.service";
import { PromptLoaderService } from "../ai/prompt-loader.service";
import { env } from "../../config/env";
import type { WorkspaceContext } from "../../common/decorators/current-user.decorator";

const AI_PURPOSES: { purpose: string; promptKey: string }[] = [
  { purpose: "ICP_EXTRACTION", promptKey: "icp.extract" },
  { purpose: "QUALITATIVE_ASSESS", promptKey: "qualify.assess" },
  { purpose: "EMAIL_GENERATE", promptKey: "email.generate" },
  { purpose: "EMAIL_QA", promptKey: "email.qa" },
];

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistryService,
    private readonly prompts: PromptLoaderService,
  ) {}

  async get(ws: WorkspaceContext): Promise<SettingsResponse> {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: ws.id } });
    const settings = WorkspaceSettings.parse(workspace.settings);

    const effectiveModels: EffectiveModelEntry[] = AI_PURPOSES.map(({ purpose, promptKey }) => {
      const prompt = this.prompts.load(promptKey);
      const configuredOverride = (env as unknown as Record<string, string | undefined>)[`AI_MODEL_${purpose}`] ?? null;
      let providerDefault = "—";
      try {
        providerDefault = this.registry.getAi(settings.aiProviderKey).defaultModel(prompt.tier);
      } catch (e) {
        this.logger.warn(`Failed to resolve default model for provider=${settings.aiProviderKey} tier=${prompt.tier}: ${e instanceof Error ? e.message : e}`);
      }
      return { purpose, promptKey, configuredOverride, providerDefault, effective: configuredOverride || providerDefault };
    });

    return {
      selected: { aiProviderKey: settings.aiProviderKey, enrichmentProviderKey: settings.enrichmentProviderKey, outboundProviderKey: settings.outboundProviderKey },
      catalogue: {
        ai: this.registry.catalogueAi(),
        connectors: this.registry.catalogueConnectors(),
        enrichment: this.registry.catalogueEnrichers(),
        outbound: this.registry.catalogueOutbound(),
      },
      effectiveModels,
    };
  }
}
