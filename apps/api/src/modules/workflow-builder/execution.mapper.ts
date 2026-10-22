import type { WorkflowNodeRun, WorkflowRun, WorkflowVersion } from "@prisma/client";
import type { WorkflowDefinition, WorkflowExecutionDto, WorkflowNodeLogEntry, WorkflowNodeRunDto, WorkflowNodeType } from "@prospect/shared";

export type ExecutionRow = WorkflowRun & { workflowVersion: WorkflowVersion; nodeRuns: WorkflowNodeRun[] };

function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function toNodeRunDto(row: WorkflowNodeRun): WorkflowNodeRunDto {
  const outputs = (row.outputs ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    nodeId: row.nodeId,
    nodeType: row.nodeType as WorkflowNodeType,
    attempt: row.attempt,
    status: row.status,
    inputCount: countOf(row.input),
    outputCounts: Object.fromEntries(Object.entries(outputs).map(([handle, ids]) => [handle, countOf(ids)])),
    summary: (row.summary ?? {}) as Record<string, unknown>,
    logs: (row.logs ?? []) as unknown as WorkflowNodeLogEntry[],
    error: row.error,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMs: row.startedAt && row.finishedAt ? row.finishedAt.getTime() - row.startedAt.getTime() : null,
  };
}

export function toExecutionDto(run: ExecutionRow): WorkflowExecutionDto {
  return {
    id: run.id,
    projectId: run.projectId,
    workflowId: run.workflowVersion.workflowId,
    workflowVersionId: run.workflowVersion.id,
    workflowVersion: run.workflowVersion.version,
    status: run.status,
    error: run.error,
    summary: (run.summary ?? {}) as Record<string, unknown>,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    definition: run.workflowVersion.definition as unknown as WorkflowDefinition,
    nodeRuns: [...run.nodeRuns].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.attempt - b.attempt).map(toNodeRunDto),
  };
}
