import type { CanonicalFieldPath } from "../schemas/icp.schema";
import type { CanonicalPartial, CanonicalPerson } from "../schemas/canonical-company.schema";

export interface ProviderLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface ProviderCtx {
  workspaceId: string;
  projectId?: string;
  logger: ProviderLogger;

  credentials: Record<string, string | undefined>;
  signal?: AbortSignal;
}

export interface RawRecord {
  externalId?: string;
  payload: Record<string, unknown>;
}

export interface NewAttribute {
  field: CanonicalFieldPath;
  value: unknown;

  confidence: number;
  observedAt?: string;
}

export interface MappedRecord {
  canonical: CanonicalPartial;
  attributes: NewAttribute[];
  people: CanonicalPerson[];
}

export interface ProviderMeta {
  readonly key: string;
  readonly displayName: string;
  readonly isMock: boolean;
  readonly available: boolean;
  readonly requiredCredentials: string[];
}

export type ProviderKind = "connector" | "enrichment" | "ai" | "outbound";

export interface ProviderCatalogueEntry extends ProviderMeta {
  kind: ProviderKind;
  configured: boolean;
}
