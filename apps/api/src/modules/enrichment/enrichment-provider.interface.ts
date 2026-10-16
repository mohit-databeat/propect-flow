import type { CanonicalFieldPath, CanonicalCompany, NewAttribute, ProviderCtx, ProviderMeta } from "@prospect/shared";

export interface EnrichmentResult {

  attributes: NewAttribute[];

  unavailable: CanonicalFieldPath[];
  costUnits: number;
  raw?: unknown;
}

export interface EnrichmentProvider extends ProviderMeta {
  readonly rateLimit: { rpm: number; concurrency: number };
  supportedFields(): CanonicalFieldPath[];
  enrich(ctx: ProviderCtx, company: CanonicalCompany, fields: CanonicalFieldPath[]): Promise<EnrichmentResult>;
}
