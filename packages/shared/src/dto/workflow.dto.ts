import { z } from "zod";

export const StartWorkflowRunDto = z.object({
  dataSourceIds: z.array(z.string().uuid()).optional(),
  refreshSources: z.boolean().default(false),

  enrich: z.boolean().default(false),
  generateEmails: z.boolean().default(false),
  maxLlmProspects: z.number().int().positive().max(10_000).optional(),
});
export type StartWorkflowRunDto = z.infer<typeof StartWorkflowRunDto>;

export type WorkflowStepKey = "INGEST" | "NORMALIZE" | "QUALIFY" | "ENRICH" | "REQUALIFY" | "GENERATE_EMAIL" | "QA" | "AWAIT_REVIEW";
export type WorkflowStepStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
export type WorkflowRunStatus = "PENDING" | "RUNNING" | "AWAITING_REVIEW" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface WorkflowStepSummary {
  id: string;
  stepKey: WorkflowStepKey;
  order: number;
  attempt: number;
  status: WorkflowStepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  output: Record<string, unknown> | null;
  error: string | null;
}

export interface WorkflowRunSummary {
  id: string;
  projectId: string;
  icpProfileId: string;
  status: WorkflowRunStatus;
  options: Record<string, unknown>;
  summary: Record<string, unknown>;
  currentStep: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  steps: WorkflowStepSummary[];
}

export interface StartWorkflowRunResponse {
  runId: string;
}
