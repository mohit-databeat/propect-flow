import type { CanonicalFieldPath } from "@prospect/shared";
import type { MappedRecord, ProviderCtx, ProviderMeta, RawRecord } from "@prospect/shared";
import type { ConnectorCapabilitiesDto, FieldMappingDto } from "@prospect/shared";

export interface ConnectorCapabilities extends ConnectorCapabilitiesDto {}

export interface FetchQuery {
  filters?: Record<string, unknown>;
  cursor?: string;
  limit: number;
}

export type FieldMapping = FieldMappingDto;

export interface DataSourceConnector extends ProviderMeta {
  readonly type: "CSV" | "API";
  capabilities(): ConnectorCapabilities;

  testConnection(ctx: ProviderCtx, config: unknown): Promise<{ ok: boolean; message?: string }>;

  fetchRecords(ctx: ProviderCtx, config: unknown, query: FetchQuery): Promise<{ records: RawRecord[]; nextCursor?: string }>;

  mapToCanonical(raw: RawRecord, mapping?: FieldMapping): MappedRecord;

  suggestMapping?(headers: string[], sampleRows: Record<string, string>[]): Promise<{ mapping: FieldMapping; confidence: Record<string, number> }>;
}

export type { CanonicalFieldPath };
