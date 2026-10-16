import type { ProviderMeta } from "@prospect/shared";

export type AiTier = "fast" | "strong";

export interface GenerateStructuredMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateStructuredRequest {
  model: string;
  system: string;
  messages: GenerateStructuredMessage[];

  jsonSchema: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;

  meta: { purpose: string; promptKey: string; promptVersion: number };
}

export interface GenerateStructuredResult {

  data: unknown;
  rawText: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export interface AiProviderAdapter extends ProviderMeta {
  defaultModel(tier: AiTier): string;
  generateStructured(req: GenerateStructuredRequest): Promise<GenerateStructuredResult>;
}
