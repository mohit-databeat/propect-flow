export interface FunnelStage {
  key: string;
  label: string;
  count: number;
}
export interface ProjectFunnel {
  stages: FunnelStage[];
}

export interface QualificationBreakdown {
  total: number;
  qualified: number;
  needsReview: number;
  disqualified: number;
  pending: number;
}

export interface DistributionBucket {
  bucket: string;
  count: number;
}

export interface CriterionBreakdownEntry {
  criterionId: string;
  label: string;
  pass: number;
  fail: number;
  unknown: number;
}

export interface AiUsageEntry {
  providerKey: string;
  model: string;
  purpose: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  cacheHits: number;
}

export interface EnrichmentUsageEntry {
  providerKey: string;
  calls: number;
  fieldsRequested: number;
  fieldsSupplied: number;
  fieldsUnavailable: number;
  costUnits: number;
}

export interface EmailQaBreakdown {
  pending: number;
  pass: number;
  warn: number;
  fail: number;
}

export interface ReviewBreakdown {
  pending: number;
  approved: number;
  rejected: number;
  edited: number;
}

export interface ProjectAnalyticsOverview {
  projectId: string;
  companies: number;
  qualification: QualificationBreakdown;
  funnel: ProjectFunnel;
  scoreDistribution: DistributionBucket[];
  coverageDistribution: DistributionBucket[];
  criteria: CriterionBreakdownEntry[];
  aiUsage: AiUsageEntry[];
  enrichmentUsage: EnrichmentUsageEntry[];
  emailQa: EmailQaBreakdown;
  review: ReviewBreakdown;
  sentSimulated: number;

  approvalRate: number | null;
}
