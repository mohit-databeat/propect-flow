import { Injectable } from "@nestjs/common";
import { GoogleGenAI } from "@google/genai";
import { ProviderCallError } from "../../../common/provider-call.error";
import type { AiProviderAdapter, AiTier, GenerateStructuredRequest, GenerateStructuredResult } from "../ai-provider.interface";

@Injectable()
export class GeminiAiProvider implements AiProviderAdapter {
  readonly key = "gemini";
  readonly displayName = "Google Gemini";
  readonly isMock = false;
  readonly available = true;
  readonly requiredCredentials = ["GEMINI_API_KEY"];

  defaultModel(_tier: AiTier): string {

    return "gemini-3.6-flash";
  }

  async generateStructured(req: GenerateStructuredRequest): Promise<GenerateStructuredResult> {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new ProviderCallError(this.key, "NOT_CONFIGURED", "GEMINI_API_KEY is not set", { retryable: false, statusCode: 424 });
    }

    const client = new GoogleGenAI({ apiKey });

    try {
      const response = await client.models.generateContent({
        model: req.model,
        contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        config: {
          systemInstruction: req.system,
          temperature: req.temperature,
          maxOutputTokens: req.maxTokens ?? 2048,

          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: "application/json",
          responseJsonSchema: toGeminiJsonSchema(req.jsonSchema),
          abortSignal: req.signal,
        },
      });

      const text = response.text;
      if (!text) {
        throw new ProviderCallError(this.key, "UNKNOWN", "Gemini response did not include any text content", { retryable: false });
      }

      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new ProviderCallError(this.key, "VALIDATION", "Gemini response was not valid JSON despite responseMimeType=application/json", { retryable: false });
      }

      return {
        data,
        rawText: text,
        usage: { inputTokens: response.usageMetadata?.promptTokenCount ?? 0, outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0 },
        model: response.modelVersion ?? req.model,
      };
    } catch (err) {
      if (err instanceof ProviderCallError) throw err;
      throw ProviderCallError.fromUnknown(this.key, err);
    }
  }
}

export function toGeminiJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _drop, definitions, ...rest } = schema;
  const renamed: Record<string, unknown> = { ...rest };
  if (definitions) renamed.$defs = definitions;
  return JSON.parse(JSON.stringify(renamed).replaceAll("#/definitions/", "#/$defs/")) as Record<string, unknown>;
}
