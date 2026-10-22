import { z } from "zod";
import type { WorkflowRunStatus } from "../dto/workflow.dto";
import { WorkflowDraftDefinition, type WorkflowDefinition, type WorkflowNodeType } from "./definition.schema";
import type { ValidationIssue } from "./validate-definition";

export const WORKFLOW_TEMPLATES = ["EMPTY", "DEFAULT_PROSPECTING"] as const;

export const CreateWorkflowDto = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    template: z.enum(WORKFLOW_TEMPLATES).default("EMPTY"),
  })
  .strict();
export type CreateWorkflowDto = z.infer<typeof CreateWorkflowDto>;

export const UpdateWorkflowDto = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    definition: WorkflowDraftDefinition.optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.description !== undefined || v.definition !== undefined, { message: "Nothing to update" });
export type UpdateWorkflowDto = z.infer<typeof UpdateWorkflowDto>;

export const ValidateWorkflowDto = z.object({ definition: z.unknown().optional() }).strict();
export type ValidateWorkflowDto = z.infer<typeof ValidateWorkflowDto>;

export const PublishWorkflowDto = z.object({ note: z.string().trim().max(200).optional() }).strict();
export type PublishWorkflowDto = z.infer<typeof PublishWorkflowDto>;

export const StartWorkflowExecutionDto = z
  .object({
    versionId: z.string().uuid(),
    maxLlmProspects: z.number().int().positive().max(10_000).optional(),
  })
  .strict();
export type StartWorkflowExecutionDto = z.infer<typeof StartWorkflowExecutionDto>;

export type WorkflowStatus = "ACTIVE" | "ARCHIVED";
export type WorkflowNodeRunStatus = "QUEUED" | "RUNNING" | "WAITING" | "SUCCEEDED" | "FAILED" | "SKIPPED";

export interface WorkflowSummaryDto {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  nodeCount: number;
  latestVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowDetailDto extends WorkflowSummaryDto {
  definition: WorkflowDraftDefinition;
}

export interface WorkflowVersionDto {
  id: string;
  workflowId: string;
  version: number;
  checksum: string;
  note: string | null;
  createdAt: string;
}

export interface PublishWorkflowResponse extends WorkflowVersionDto {
  alreadyPublished: boolean;
}

export interface WorkflowValidationResponse {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface WorkflowNodeLogEntry {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface WorkflowNodeRunDto {
  id: string;
  nodeId: string;
  nodeType: WorkflowNodeType;
  attempt: number;
  status: WorkflowNodeRunStatus;
  inputCount: number;
  outputCounts: Record<string, number>;
  summary: Record<string, unknown>;
  logs: WorkflowNodeLogEntry[];
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface WorkflowExecutionDto {
  id: string;
  projectId: string;
  workflowId: string;
  workflowVersionId: string;
  workflowVersion: number;
  status: WorkflowRunStatus;
  error: string | null;
  summary: Record<string, unknown>;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  definition: WorkflowDefinition;
  nodeRuns: WorkflowNodeRunDto[];
}

export interface WorkflowExecutionSummaryDto {
  id: string;
  workflowVersion: number;
  status: WorkflowRunStatus;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface StartWorkflowExecutionResponse {
  runId: string;
}
