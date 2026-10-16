import type { WorkflowRun, WorkflowStep, WorkflowStepKey } from "@prisma/client";

export interface StepOutcome {

  summary: Record<string, unknown>;
  skipped?: boolean;
  skipReason?: string;
}

export interface WorkflowStepHandler {
  readonly key: WorkflowStepKey;
  run(run: WorkflowRun, step: WorkflowStep): Promise<StepOutcome>;
}

export const STEP_ORDER: WorkflowStepKey[] = ["INGEST", "NORMALIZE", "QUALIFY", "ENRICH", "REQUALIFY", "GENERATE_EMAIL", "QA", "AWAIT_REVIEW"];

export function nextStepKey(current: WorkflowStepKey): WorkflowStepKey | null {
  const idx = STEP_ORDER.indexOf(current);
  return idx === -1 || idx === STEP_ORDER.length - 1 ? null : STEP_ORDER[idx + 1]!;
}
