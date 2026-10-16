import { z } from "zod";
import { CanonicalFieldPath } from "../schemas/icp.schema";

export const DataSourceType = z.enum(["CSV", "API"]);
export type DataSourceType = z.infer<typeof DataSourceType>;

export const DataSourceStatus = z.enum(["DRAFT", "READY", "SYNCING", "SYNCED", "ERROR", "ARCHIVED"]);
export type DataSourceStatus = z.infer<typeof DataSourceStatus>;

export const CreateDataSourceDto = z.object({
  type: DataSourceType,
  providerKey: z.string().min(1),
  name: z.string().min(1).max(120),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type CreateDataSourceDto = z.infer<typeof CreateDataSourceDto>;

export const UpdateDataSourceDto = z
  .object({
    name: z.string().min(1).max(120).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => v.name !== undefined || v.config !== undefined, "nothing to update");
export type UpdateDataSourceDto = z.infer<typeof UpdateDataSourceDto>;

export const FieldMappingDto = z.record(z.string(), CanonicalFieldPath.nullable());
export type FieldMappingDto = z.infer<typeof FieldMappingDto>;

export const UpdateMappingDto = z.object({ mapping: FieldMappingDto });
export type UpdateMappingDto = z.infer<typeof UpdateMappingDto>;

export interface DataSourceSummary {
  id: string;
  projectId: string;
  type: DataSourceType;
  providerKey: string;
  name: string;
  config: Record<string, unknown>;
  status: DataSourceStatus;
  lastSyncedAt: string | null;
  recordCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CsvUploadResponse {
  dataSourceId: string;
  columns: string[];
  sampleRows: Record<string, string>[];
  suggestedMapping: FieldMappingDto;
  confidence: Record<string, number>;
  mappingSource: "heuristic" | "ai";
}

export interface SyncResult {
  fetched: number;
  created: number;
  skipped: number;
  normalizationErrors: { externalId: string | null; error: string }[];
  possibleDuplicates: number;
  newCompanies: number;
  mergedIntoExisting: number;
}

export interface SourceRecordSummary {
  id: string;
  externalId: string | null;
  rawPayload: Record<string, unknown>;
  fetchedAt: string;
  normalizedCompanyId: string | null;
  normalizationError: string | null;
}

export const FieldMappingSuggestion = z.object({
  mapping: FieldMappingDto,
  confidence: z.record(z.string(), z.number().int().min(0).max(100)),
});
export type FieldMappingSuggestion = z.infer<typeof FieldMappingSuggestion>;

export interface ConnectorCapabilitiesDto {
  supportsSearch: boolean;
  supportsPaging: boolean;
  requiresMapping: boolean;
  suppliesFields: string[];
  suppliesPeople: boolean;
}

export interface ConnectorCatalogueEntry {
  key: string;
  displayName: string;
  type: DataSourceType;
  capabilities: ConnectorCapabilitiesDto;
  isMock: boolean;
  available: boolean;
  configured: boolean;
}
