import type { WorkflowNodeRunDto, WorkflowNodeRunStatus, WorkflowRunStatus } from "@prospect/shared";

export const nodeStatusLabel: Record<WorkflowNodeRunStatus, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  WAITING: "Waiting for review",
  SUCCEEDED: "Done",
  FAILED: "Failed",
  SKIPPED: "Skipped",
};

export const nodeStatusTone = {
  QUEUED: "neutral",
  RUNNING: "info",
  WAITING: "warning",
  SUCCEEDED: "success",
  FAILED: "danger",
  SKIPPED: "neutral",
} as const satisfies Record<WorkflowNodeRunStatus, "neutral" | "info" | "warning" | "success" | "danger">;

export const nodeStatusBorder: Record<WorkflowNodeRunStatus, string> = {
  QUEUED: "border-slate-300",
  RUNNING: "border-blue-400 ring-2 ring-blue-200",
  WAITING: "border-amber-400 ring-2 ring-amber-200",
  SUCCEEDED: "border-emerald-400",
  FAILED: "border-red-400 ring-2 ring-red-200",
  SKIPPED: "border-dashed border-slate-300 opacity-70",
};

export const runStatusLabel: Record<WorkflowRunStatus, string> = {
  PENDING: "Queued",
  RUNNING: "Running",
  AWAITING_REVIEW: "Waiting for review",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export const runStatusTone = {
  PENDING: "neutral",
  RUNNING: "info",
  AWAITING_REVIEW: "warning",
  COMPLETED: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
} as const satisfies Record<WorkflowRunStatus, "neutral" | "info" | "warning" | "success" | "danger">;

export const ACTIVE_RUN_STATUSES: ReadonlySet<WorkflowRunStatus> = new Set(["PENDING", "RUNNING", "AWAITING_REVIEW"]);

export function latestByNode(nodeRuns: readonly WorkflowNodeRunDto[]): Map<string, WorkflowNodeRunDto> {
  const latest = new Map<string, WorkflowNodeRunDto>();
  for (const run of nodeRuns) {
    const current = latest.get(run.nodeId);
    if (!current || run.attempt > current.attempt) latest.set(run.nodeId, run);
  }
  return latest;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

export function humanizeKey(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" || typeof value === "string") return String(value);
  if (Array.isArray(value)) return value.length === 0 ? "None" : value.map(formatValue).join(", ");
  return JSON.stringify(value);
}
