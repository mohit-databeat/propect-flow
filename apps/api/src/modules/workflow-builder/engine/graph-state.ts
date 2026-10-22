import type { WorkflowDefinition } from "@prospect/shared";
import { topologicalOrder } from "@prospect/shared";

export type NodeRunStatusValue = "QUEUED" | "RUNNING" | "WAITING" | "SUCCEEDED" | "FAILED" | "SKIPPED";

export interface NodeRunState {
  nodeId: string;
  attempt: number;
  status: NodeRunStatusValue;
  outputs: Record<string, string[]> | null;
}

export type NextAction =
  | { action: "run"; nodeId: string; input: string[] }
  | { action: "running" }
  | { action: "wait" }
  | { action: "complete" }
  | { action: "fail"; nodeId: string }
  | { action: "stuck"; nodeIds: string[] };

export function latestAttempts(rows: readonly NodeRunState[]): Map<string, NodeRunState> {
  const latest = new Map<string, NodeRunState>();
  for (const row of rows) {
    const current = latest.get(row.nodeId);
    if (!current || row.attempt > current.attempt) latest.set(row.nodeId, row);
  }
  return latest;
}

export function inputFor(definition: WorkflowDefinition, nodeId: string, latest: ReadonlyMap<string, NodeRunState>): string[] {
  const seen = new Set<string>();
  const input: string[] = [];
  for (const edge of definition.edges) {
    if (edge.target !== nodeId) continue;
    const parent = latest.get(edge.source);
    if (parent?.status !== "SUCCEEDED" && parent?.status !== "SKIPPED") continue;
    for (const id of parent?.outputs?.[edge.sourceHandle] ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      input.push(id);
    }
  }
  return input;
}

export function planNext(definition: WorkflowDefinition, rows: readonly NodeRunState[]): NextAction {
  const latest = latestAttempts(rows);
  const order = topologicalOrder(definition).order;

  const failed = order.find((id) => latest.get(id)?.status === "FAILED");
  if (failed) return { action: "fail", nodeId: failed };

  if (order.some((id) => latest.get(id)?.status === "RUNNING")) return { action: "running" };

  const parents = new Map<string, string[]>();
  for (const edge of definition.edges) parents.set(edge.target, [...(parents.get(edge.target) ?? []), edge.source]);

  const settled = (id: string) => {
    const status = latest.get(id)?.status;
    return status === "SUCCEEDED" || status === "SKIPPED";
  };

  for (const id of order) {
    if (latest.get(id)?.status !== "QUEUED") continue;
    if ((parents.get(id) ?? []).every(settled)) return { action: "run", nodeId: id, input: inputFor(definition, id, latest) };
  }

  if (order.some((id) => latest.get(id)?.status === "WAITING")) return { action: "wait" };

  const unfinished = order.filter((id) => {
    const status = latest.get(id)?.status;
    return status === undefined || status === "QUEUED";
  });
  if (unfinished.length > 0) return { action: "stuck", nodeIds: unfinished };

  return { action: "complete" };
}
