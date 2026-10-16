import { z } from "zod";
import { CanonicalFieldPath } from "../schemas/icp.schema";
import type { MessageDto } from "./message.dto";

export const EnrichProspectDto = z.object({
  fields: z.array(CanonicalFieldPath).optional(),
});
export type EnrichProspectDto = z.infer<typeof EnrichProspectDto>;

export const ProspectListQuery = z.object({
  runId: z.string().uuid().optional(),
  status: z.enum(["PENDING", "QUALIFIED", "DISQUALIFIED", "NEEDS_REVIEW"]).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  q: z.string().max(200).optional(),

  criterion: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.string().regex(/^[a-zA-Z]+:(asc|desc)$/).default("score:desc"),
});
export type ProspectListQuery = z.infer<typeof ProspectListQuery>;

export interface ProspectListItem {
  id: string;
  companyId: string;
  companyName: string;
  domain: string | null;
  possibleDuplicate: boolean;
  status: string;
  score: number | null;
  coverage: number | null;
  requiredFails: string[];
  keyResults: { criterionId: string; label: string; status: string; required: boolean }[];
  createdAt: string;
}

export interface ProspectStatusCounts {
  total: number;
  qualified: number;
  needsReview: number;
  disqualified: number;
  pending: number;
}

export interface ProspectListResponse {
  items: ProspectListItem[];
  page: number;
  pageSize: number;
  total: number;
  runId: string | null;

  statusCounts: ProspectStatusCounts;
}

export interface EvidenceDto {
  id: string;
  kind: string;
  content: Record<string, unknown>;
  sourceRef: string | null;
  companyAttributeId: string | null;
}

export interface QualificationResultDto {
  id: string;
  criterionId: string;
  criterionLabel: string;
  phase: "INITIAL" | "POST_ENRICHMENT";
  status: "PASS" | "FAIL" | "UNKNOWN";
  weight: number;
  required: boolean;
  evaluator: "DETERMINISTIC" | "LLM";
  reason: string;
  confidence: number | null;
  missingFields: string[];
  evidence: EvidenceDto[];
}

export interface PersonDto {
  id: string;
  fullName: string;
  title: string | null;
  seniority: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  providerKey: string;
}

export interface SourceRecordDto {
  id: string;
  dataSourceId: string;
  dataSourceName: string;
  providerKey: string;
  externalId: string | null;
  rawPayload: Record<string, unknown>;
  fetchedAt: string;
}

export interface CompanyDetailDto {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  industryRaw: string | null;
  country: string | null;
  hqCity: string | null;
  hqState: string | null;
  employeeCount: number | null;
  employeeRange: string | null;
  revenueUsd: number | null;
  revenueRange: string | null;
  foundedYear: number | null;
  fundingStage: string | null;
  totalFundingUsd: number | null;
  techStack: string[];
  possibleDuplicate: boolean;
  canonical: Record<string, unknown>;
  resolvedHash: string | null;
  normalizedAt: string | null;
}

export interface EnrichmentRunDto {
  id: string;
  providerKey: string;
  requestedFields: string[];
  suppliedFields: string[];
  unavailableFields: string[];
  status: string;
  costUnits: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface QualitativeAiRunDto {
  id: string;
  criterionId: string | null;
  providerKey: string;
  model: string;
  status: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  latencyMs: number | null;
  cached: boolean;
  createdAt: string;
}

export interface ProspectDetail {
  id: string;
  projectId: string;
  workflowRunId: string;
  icpProfileId: string;
  status: string;
  score: number | null;
  coverage: number | null;
  summary: Record<string, unknown>;
  aiReasoning: string | null;
  createdAt: string;
  updatedAt: string;
  company: CompanyDetailDto;
  people: PersonDto[];
  sourceRecords: SourceRecordDto[];

  results: QualificationResultDto[];
  workflowRun: { id: string; status: string; icpProfileId: string; startedAt: string | null; finishedAt: string | null };
  enrichmentRuns: EnrichmentRunDto[];
  aiRuns: QualitativeAiRunDto[];
  messages: MessageDto[];
}

export interface AttributeHistoryEntry {
  id: string;
  value: unknown;
  sourceType: string;
  providerKey: string;
  confidence: number;
  observedAt: string;
  isCurrentWinner: boolean;
}

export interface AttributeHistoryField {
  field: string;
  currentValue: unknown;
  observations: AttributeHistoryEntry[];
}

export interface AttributeHistoryResponse {
  companyId: string;
  fields: AttributeHistoryField[];
}
