import { randomUUID } from "node:crypto";
import { WorkflowService } from "./workflow.service";
import { AppException } from "../../common/errors";

interface FakeIcpProfile {
  id: string;
  projectId: string;
  status: string;
  version: number;
}
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
  createdAt: Date;
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

function makeFakePrisma(icpProfiles: FakeIcpProfile[]) {
  const runs: FakeRun[] = [];
  const steps: FakeStep[] = [];
  return {
    icpProfile: { findFirst: async ({ where }: { where: { projectId: string; status: string } }) => icpProfiles.find((p) => p.projectId === where.projectId && p.status === where.status) ?? null },
    workflowRun: {
      create: async ({ data }: { data: Omit<FakeRun, "id" | "createdAt"> }) => {
        const row: FakeRun = { id: randomUUID(), createdAt: new Date(), ...data };
        runs.push(row);
        return row;
      },
      findMany: async ({ where }: { where: { projectId: string } }) =>
        runs
          .filter((r) => r.projectId === where.projectId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((r) => ({ ...r, steps: steps.filter((s) => s.workflowRunId === r.id).sort((a, b) => a.order - b.order) })),
      findFirst: async ({ where }: { where: { id: string; projectId: string } }) => {
        const run = runs.find((r) => r.id === where.id && r.projectId === where.projectId);
        if (!run) return null;
        return { ...run, steps: steps.filter((s) => s.workflowRunId === run.id).sort((a, b) => a.order - b.order) };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeRun> }) => {
        const row = runs.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    workflowStep: {
      createMany: async ({ data }: { data: Omit<FakeStep, "id">[] }) => {
        steps.push(...data.map((d) => ({ id: randomUUID(), ...d })));
        return { count: data.length };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeStep> & { attempt?: { increment: number } } }) => {
        const row = steps.find((s) => s.id === where.id)!;
        const { attempt, ...rest } = data;
        Object.assign(row, rest);
        if (attempt) row.attempt += attempt.increment;
        return row;
      },
      updateMany: async ({ where, data }: { where: { workflowRunId: string; status: { in: string[] } }; data: Partial<FakeStep> }) => {
        const matches = steps.filter((s) => s.workflowRunId === where.workflowRunId && where.status.in.includes(s.status));
        for (const s of matches) Object.assign(s, data);
        return { count: matches.length };
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    __runs: runs,
    __steps: (runId: string) => steps.filter((s) => s.workflowRunId === runId).sort((a, b) => a.order - b.order),
  };
}

function makeProjectsStub(status: string = "DRAFT") {
  return { findOneOrThrow: async () => ({ id: "proj1", workspaceId: "ws1", status }) };
}

class RecordingDispatcher {
  dispatched: { runId: string; stepKey: string }[] = [];
  dispatch(job: { runId: string; stepKey: string }) {
    this.dispatched.push(job);
  }
}

const ws = { id: "ws1", role: "OWNER" as const };

describe("WorkflowService.start", () => {
  it("rejects with 409 PROJECT_ARCHIVED when the project is archived — checked before the ICP", async () => {
    const prisma = makeFakePrisma([{ id: "icp-v1", projectId: "proj1", status: "ACTIVE", version: 1 }]);
    const service = new WorkflowService(prisma as never, makeProjectsStub("ARCHIVED") as never, new RecordingDispatcher() as never);

    const err = await service.start(ws, "proj1", "user1", { refreshSources: false, enrich: false, generateEmails: false }).catch((e: AppException) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe("PROJECT_ARCHIVED");
    expect((err as AppException).getStatus()).toBe(409);
  });

  it("rejects with 409 ICP_NOT_ACTIVE when the project has no active ICP", async () => {
    const prisma = makeFakePrisma([]);
    const service = new WorkflowService(prisma as never, makeProjectsStub() as never, new RecordingDispatcher() as never);

    const err = await service.start(ws, "proj1", "user1", { refreshSources: false, enrich: false, generateEmails: false }).catch((e: AppException) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe("ICP_NOT_ACTIVE");
    expect((err as AppException).getStatus()).toBe(409);
  });

  it("pins the currently ACTIVE ICP profile id onto the run and creates all 8 steps QUEUED", async () => {
    const prisma = makeFakePrisma([{ id: "icp-v1", projectId: "proj1", status: "ACTIVE", version: 1 }]);
    const dispatcher = new RecordingDispatcher();
    const service = new WorkflowService(prisma as never, makeProjectsStub() as never, dispatcher as never);

    const { runId } = await service.start(ws, "proj1", "user1", { refreshSources: false, enrich: false, generateEmails: false });

    const run = prisma.__runs.find((r) => r.id === runId)!;
    expect(run.icpProfileId).toBe("icp-v1");
    expect(prisma.__steps(runId)).toHaveLength(8);
    expect(prisma.__steps(runId).every((s) => s.status === "QUEUED")).toBe(true);
    expect(dispatcher.dispatched).toEqual([{ runId, stepKey: "INGEST" }]);
  });

  it("a later ICP activation does not alter an already-started run's pinned icpProfileId", async () => {
    const icpProfiles = [{ id: "icp-v1", projectId: "proj1", status: "ACTIVE", version: 1 }];
    const prisma = makeFakePrisma(icpProfiles);
    const service = new WorkflowService(prisma as never, makeProjectsStub() as never, new RecordingDispatcher() as never);

    const { runId } = await service.start(ws, "proj1", "user1", { refreshSources: false, enrich: false, generateEmails: false });

    icpProfiles[0]!.status = "ARCHIVED";
    icpProfiles.push({ id: "icp-v2", projectId: "proj1", status: "ACTIVE", version: 2 });

    const run = prisma.__runs.find((r) => r.id === runId)!;
    expect(run.icpProfileId).toBe("icp-v1");
  });
});

describe("WorkflowService.retry", () => {
  it("retries from the first FAILED step and requeues only that step", async () => {
    const prisma = makeFakePrisma([{ id: "icp-v1", projectId: "proj1", status: "ACTIVE", version: 1 }]);
    const dispatcher = new RecordingDispatcher();
    const service = new WorkflowService(prisma as never, makeProjectsStub() as never, dispatcher as never);
    const { runId } = await service.start(ws, "proj1", "user1", { refreshSources: false, enrich: false, generateEmails: false });

    const qualifyStep = prisma.__steps(runId).find((s) => s.stepKey === "QUALIFY")!;
    Object.assign(qualifyStep, { status: "FAILED", error: "boom", attempt: 1 });

    dispatcher.dispatched = [];
    await service.retry(ws, "proj1", runId);

    expect(qualifyStep.status).toBe("QUEUED");
    expect(qualifyStep.attempt).toBe(2);
    expect(qualifyStep.error).toBeNull();
    expect(dispatcher.dispatched).toEqual([{ runId, stepKey: "QUALIFY" }]);
  });

  it("rejects retry when there is no FAILED step", async () => {
    const prisma = makeFakePrisma([{ id: "icp-v1", projectId: "proj1", status: "ACTIVE", version: 1 }]);
    const service = new WorkflowService(prisma as never, makeProjectsStub() as never, new RecordingDispatcher() as never);
    const { runId } = await service.start(ws, "proj1", "user1", { refreshSources: false, enrich: false, generateEmails: false });

    await expect(service.retry(ws, "proj1", runId)).rejects.toBeInstanceOf(AppException);
  });
});

describe("WorkflowService.cancel", () => {
  it("marks the run CANCELLED and skips remaining QUEUED steps", async () => {
    const prisma = makeFakePrisma([{ id: "icp-v1", projectId: "proj1", status: "ACTIVE", version: 1 }]);
    const service = new WorkflowService(prisma as never, makeProjectsStub() as never, new RecordingDispatcher() as never);
    const { runId } = await service.start(ws, "proj1", "user1", { refreshSources: false, enrich: false, generateEmails: false });

    await service.cancel(ws, "proj1", runId);

    const run = prisma.__runs.find((r) => r.id === runId)!;
    expect(run.status).toBe("CANCELLED");
    expect(prisma.__steps(runId).every((s) => s.status === "SKIPPED")).toBe(true);
  });
});

describe("WorkflowService only exposes classic runs", () => {
  function makeSpyService(run: object | null) {
    const prisma = {
      workflowRun: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => run),
      },
    };
    const projects = { findOneOrThrow: async () => ({ id: "proj1", workspaceId: "ws1", status: "ACTIVE" }) };
    return { prisma, service: new WorkflowService(prisma as never, projects as never, {} as never) };
  }

  const ws = { id: "ws1", role: "OWNER" as const };

  it("lists only runs that were not started from a workflow version, so builder runs never appear as empty classic runs", async () => {
    const { service, prisma } = makeSpyService(null);
    await service.list(ws, "proj1");
    expect(prisma.workflowRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "proj1", workflowVersionId: null } }));
  });

  it("does not return, cancel or retry a builder run through the classic endpoints", async () => {
    const { service, prisma } = makeSpyService(null);
    for (const call of [() => service.get(ws, "proj1", "builder-run"), () => service.cancel(ws, "proj1", "builder-run"), () => service.retry(ws, "proj1", "builder-run")]) {
      const err = (await call().catch((e: unknown) => e)) as AppException;
      expect(err.code).toBe("NOT_FOUND");
    }
    expect(prisma.workflowRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "builder-run", projectId: "proj1", workflowVersionId: null } }));
  });
});
