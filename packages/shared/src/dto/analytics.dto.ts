export interface AnalyticsOverview {
  projects: { total: number; active: number; draft: number; archived: number };
  companies: number;
  prospects: { total: number; qualified: number; needsReview: number; disqualified: number; pending: number };
  emails: {
    total: number;
    pendingReview: number;
    approved: number;
    rejected: number;
    edited: number;
    sent: number;
  };
  ai: { runs: number; inputTokens: number; outputTokens: number; costUsd: number };
  enrichment: { runs: number; succeeded: number; partial: number; failed: number };
  recentRuns: {
    id: string;
    projectId: string;
    projectName: string;
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
    summary: Record<string, unknown>;
  }[];
  providers: {
    ai: { key: string; available: boolean; configured: boolean };
    enrichment: { key: string; available: boolean; configured: boolean };
    outbound: { key: string; available: boolean; configured: boolean };
  };
}
