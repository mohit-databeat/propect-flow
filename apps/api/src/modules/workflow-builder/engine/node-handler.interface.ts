import type { WorkflowRun } from "@prisma/client";
import type { WorkflowDefinition, WorkflowNode, WorkflowNodeType } from "@prospect/shared";
import type { LlmBudget } from "../../qualification/qualitative-assessor.service";
import type { LogLevel } from "./run-state.service";

export interface NodeContext<T extends WorkflowNodeType = WorkflowNodeType> {
  run: WorkflowRun;
  workspaceId: string;
  nodeRunId: string;
  attempt: number;
  node: Extract<WorkflowNode, { type: T }>;
  definition: WorkflowDefinition;
  input: string[];
  budget: LlmBudget;
  log(level: LogLevel, message: string): Promise<void>;
}

export type NodeResult =
  | { kind: "done"; outputs: Record<string, string[]>; summary: Record<string, unknown>; skipped?: boolean; skipReason?: string; llmUnits?: number }
  | { kind: "wait"; summary: Record<string, unknown> };

export interface NodeHandler<T extends WorkflowNodeType = WorkflowNodeType> {
  readonly type: T;
  readonly runsOnEmptyInput?: boolean;
  run(ctx: NodeContext<T>): Promise<NodeResult>;
  resumeBlocker?(ctx: NodeContext<T>): Promise<string | null>;
  resume?(ctx: NodeContext<T>): Promise<NodeResult>;
}
