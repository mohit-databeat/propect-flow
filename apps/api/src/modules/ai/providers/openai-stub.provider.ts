import { Injectable } from "@nestjs/common";
import type { AiProviderAdapter, AiTier, GenerateStructuredRequest, GenerateStructuredResult } from "../ai-provider.interface";

@Injectable()
export class OpenAiStubProvider implements AiProviderAdapter {
  readonly key = "openai";
  readonly displayName = "OpenAI (not yet implemented)";
  readonly isMock = false;
  readonly available = false;
  readonly requiredCredentials = ["OPENAI_API_KEY"];

  defaultModel(_tier: AiTier): string {
    return "gpt-4.1";
  }

  generateStructured(_req: GenerateStructuredRequest): Promise<GenerateStructuredResult> {
    return Promise.reject(new Error("openai provider is a documented stub and is not implemented"));
  }
}
