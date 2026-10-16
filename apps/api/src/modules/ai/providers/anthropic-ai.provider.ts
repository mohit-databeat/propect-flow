import { Injectable } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import { ProviderCallError } from "../../../common/provider-call.error";
import type { AiProviderAdapter, AiTier, GenerateStructuredRequest, GenerateStructuredResult } from "../ai-provider.interface";

@Injectable()
export class AnthropicAiProvider implements AiProviderAdapter {
  readonly key = "anthropic";
  readonly displayName = "Anthropic Claude";
  readonly isMock = false;
  readonly available = true;
  readonly requiredCredentials = ["ANTHROPIC_API_KEY"];

  defaultModel(tier: AiTier): string {
    return tier === "fast" ? "claude-haiku-4-5-20251001" : "claude-sonnet-5";
  }

  async generateStructured(req: GenerateStructuredRequest): Promise<GenerateStructuredResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new ProviderCallError(this.key, "NOT_CONFIGURED", "ANTHROPIC_API_KEY is not set", { retryable: false, statusCode: 424 });
    }

    const client = new Anthropic({ apiKey });

    try {
      const response = await client.messages.create(
        {
          model: req.model,
          max_tokens: req.maxTokens ?? 2048,
          temperature: req.temperature,
          system: req.system,
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          tools: [
            {
              name: "emit_result",
              description: "Return the structured result. This is the only way to respond.",
              input_schema: req.jsonSchema as Anthropic.Tool.InputSchema,
            },
          ],
          tool_choice: { type: "tool", name: "emit_result" },
        },
        { signal: req.signal },
      );

      const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
      if (!toolUse) {
        throw new ProviderCallError(this.key, "UNKNOWN", "Anthropic response did not include the expected tool_use block", { retryable: false });
      }

      return {
        data: toolUse.input,
        rawText: JSON.stringify(toolUse.input),
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
        model: response.model,
      };
    } catch (err) {
      if (err instanceof ProviderCallError) throw err;
      throw ProviderCallError.fromUnknown(this.key, err);
    }
  }
}
