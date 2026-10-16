import { randomUUID } from "node:crypto";
import { WorkflowRunnerService } from "./workflow-runner.service";
import type { WorkflowStepHandler, StepOutcome } from "./step-handler.interface";
import type { WorkflowJob } from "./job-dispatcher";

interface FakeRun {
  id: string;
  projectId: string;
  icpProfileId: string;
  status: string;
  options: unknown;
  summary: unknown;
  currentStep: string | null;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}
interface FakeStep {
  id: string;
  workflowRunId: string;
  stepKey: string;
  order: number;
  attempt: number;
  status: string;
  output: unknown;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

const STEP_KEYS = ["INGEST", "NORMALIZE", "QUALIFY", "ENRICH", "REQUALIFY", "GENERATE_EMAIL", "QA", "AWAIT_REVIEW"];

function makeFakePrisma(run: FakeRun, steps: FakeStep[]) {
  return {
    workflowRun: {
      findUnique: async () => ({ ...run }),
      findUniqueOrThrow: async () => ({ ...run }),
      update: async ({ data }: { data: Partial<FakeRun> }) => {
        Object.assign(run, data);
        return run;
      },
    },
    workflowStep: {
      findFirst: async ({ where }: { where: { workflowRunId: string; stepKey: string } }) =>
        steps.filter((s) => s.workflowRunId === where.workflowRunId && s.stepKey === where.stepKey).sort((a, b) => b.attempt - a.attempt)[0] ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeStep> }) => {
        const row = steps.find((s) => s.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
  };
}

function makeSteps(runId: string): FakeStep[] {
  return STEP_KEYS.map((stepKey, order) => ({ id: randomUUID(), workflowRunId: runId, stepKey, order, attempt: 1, status: "QUEUED", output: null, error: null, startedAt: null, finishedAt: null }));
}

function handler(key: string, impl: (run: FakeRun) => Promise<StepOutcome>): WorkflowStepHandler {
  return { key: key as never, run: impl as never };
}

class RecordingDispatcher {
  dispatched: WorkflowJob[] = [];
  dispatch(job: WorkflowJob) {
    this.dispatched.push(job);
  }
}

function buildRunner(prisma: ReturnType<typeof makeFakePrisma>, handlers: Record<string, (run: FakeRun) => Promise<StepOutcome>>, dispatcher: RecordingDispatcher) {
  const h = (key: string) => handler(key, handlers[key] ?? (async () => ({ summary: {} })));
  return new WorkflowRunnerService(
    prisma as never,
    dispatcher as never,
    h("INGEST") as never,
    h("NORMALIZE") as never,
    h("QUALIFY") as never,
    h("ENRICH") as never,
    h("REQUALIFY") as never,
    h("GENERATE_EMAIL") as never,
    h("QA") as never,
    h("AWAIT_REVIEW") as never,
  );
}

describe("WorkflowRunnerService", () => {
  it("runs a step, marks it SUCCEEDED, and dispatches the next step", async () => {
    const run: FakeRun = { id: "run1", projectId: "proj1", icpProfileId: "icp1", status: "PENDING", options: {}, summary: {}, currentStep: null, error: null, startedAt: null, finishedAt: null };
    const steps = makeSteps("run1");
    const prisma = makeFakePrisma(run, steps);
    const dispatcher = new RecordingDispatcher();
    const runner = buildRunner(prisma, { INGEST: async () => ({ summary: { ok: true } }) }, dispatcher);

    await runner.executeStep({ runId: "run1", stepKey: "INGEST" as never });

    expect(steps.find((s) => s.stepKey === "INGEST")!.status).toBe("SUCCEEDED");
    expect(dispatcher.dispatched).toEqual([{ runId: "run1", stepKey: "NORMALIZE" }]);
    expect(run.status).toBe("RUNNING");
  });

  it("is idempotent: re-executing an already-SUCCEEDED step does not re-run the handler, just advances", async () => {
    const run: FakeRun = { id: "run1", projectId: "proj1", icpProfileId: "icp1", status: "RUNNING", options: {}, summary: {}, currentStep: "INGEST", error: null, startedAt: new Date(), finishedAt: null };
    const steps = makeSteps("run1");
    steps[0]!.status = "SUCCEEDED";
    const prisma = makeFakePrisma(run, steps);
    const dispatcher = new RecordingDispatcher();
    let calls = 0;
    const runner = buildRunner(prisma, { INGEST: async () => { calls++; return { summary: {} }; } }, dispatcher);

    await runner.executeStep({ runId: "run1", stepKey: "INGEST" as never });

    expect(calls).toBe(0);
    expect(dispatcher.dispatched).toEqual([{ runId: "run1", stepKey: "NORMALIZE" }]);
  });

  it("marks a step FAILED and the run FAILED when the handler throws, without dispatching further", async () => {
    const run: FakeRun = { id: "run1", projectId: "proj1", icpProfileId: "icp1", status: "PENDING", options: {}, summary: {}, currentStep: null, error: null, startedAt: null, finishedAt: null };
    const steps = makeSteps("run1");
    const prisma = makeFakePrisma(run, steps);
    const dispatcher = new RecordingDispatcher();
    const runner = buildRunner(prisma, { QUALIFY: async () => { throw new Error("boom"); } }, dispatcher);

    await runner.executeStep({ runId: "run1", stepKey: "QUALIFY" as never });

    expect(steps.find((s) => s.stepKey === "QUALIFY")!.status).toBe("FAILED");
    expect(run.status).toBe("FAILED");
    expect(dispatcher.dispatched).toEqual([]);
  });

  it("marks a skipped step SKIPPED with its reason and still advances", async () => {
    const run: FakeRun = { id: "run1", projectId: "proj1", icpProfileId: "icp1", status: "PENDING", options: {}, summary: {}, currentStep: null, error: null, startedAt: null, finishedAt: null };
    const steps = makeSteps("run1");
    const prisma = makeFakePrisma(run, steps);
    const dispatcher = new RecordingDispatcher();
    const runner = buildRunner(prisma, { ENRICH: async () => ({ summary: {}, skipped: true, skipReason: "Phase 5" }) }, dispatcher);

    await runner.executeStep({ runId: "run1", stepKey: "ENRICH" as never });

    const enrichStep = steps.find((s) => s.stepKey === "ENRICH")!;
    expect(enrichStep.status).toBe("SKIPPED");
    expect(enrichStep.error).toBe("Phase 5");
    expect(dispatcher.dispatched).toEqual([{ runId: "run1", stepKey: "REQUALIFY" }]);
  });

  it("completing the last step (AWAIT_REVIEW) marks the run COMPLETED and dispatches nothing further", async () => {
    const run: FakeRun = { id: "run1", projectId: "proj1", icpProfileId: "icp1", status: "RUNNING", options: {}, summary: {}, currentStep: "AWAIT_REVIEW", error: null, startedAt: new Date(), finishedAt: null };
    const steps = makeSteps("run1");
    const prisma = makeFakePrisma(run, steps);
    const dispatcher = new RecordingDispatcher();
    const runner = buildRunner(prisma, {}, dispatcher);

    await runner.executeStep({ runId: "run1", stepKey: "AWAIT_REVIEW" as never });

    expect(run.status).toBe("COMPLETED");
    expect(dispatcher.dispatched).toEqual([]);
  });

  it("a CANCELLED run never executes a queued step", async () => {
    const run: FakeRun = { id: "run1", projectId: "proj1", icpProfileId: "icp1", status: "CANCELLED", options: {}, summary: {}, currentStep: null, error: null, startedAt: null, finishedAt: new Date() };
    const steps = makeSteps("run1");
    const prisma = makeFakePrisma(run, steps);
    const dispatcher = new RecordingDispatcher();
    let calls = 0;
    const runner = buildRunner(prisma, { QUALIFY: async () => { calls++; return { summary: {} }; } }, dispatcher);

    await runner.executeStep({ runId: "run1", stepKey: "QUALIFY" as never });

    expect(calls).toBe(0);
    expect(steps.find((s) => s.stepKey === "QUALIFY")!.status).toBe("QUEUED");
  });
});
