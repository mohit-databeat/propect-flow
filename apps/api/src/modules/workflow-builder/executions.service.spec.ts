import { Prisma } from "@prisma/client";
import { WorkflowDefinition, defaultProspectingDefinition } from "@prospect/shared";
import { AppException, notFound } from "../../common/errors";
import { ExecutionsService } from "./executions.service";
import { INTERRUPTED_MESSAGE, RecoveryService } from "./engine/recovery.service";

const ws = { id: "ws1", role: "OWNER" as const };
const otherWs = { id: "ws2", role: "OWNER" as const };
const def = WorkflowDefinition.parse(defaultProspectingDefinition());
const VERSION_ID = "3f1c2a4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b";

const code = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as AppException).code;

function nodeRun(nodeId: string, status: string, over: Record<string, unknown> = {}) {
  return { id: `nr-${nodeId}-${over.attempt ?? 1}`, workflowRunId: "run1", nodeId, nodeType: "ENRICH", attempt: 1, status, input: null, outputs: null, summary: {}, logs: [], error: null, startedAt: null, finishedAt: null, createdAt: new Date(2026, 0, 1), ...over };
}

function runRow(status: string, nodes: ReturnType<typeof nodeRun>[], over: Record<string, unknown> = {}) {
  return {
    id: "run1", projectId: "proj1", icpProfileId: "icp1", workflowVersionId: VERSION_ID, status, options: {}, summary: {}, currentStep: null, error: null,
    startedAt: null, finishedAt: null, createdAt: new Date("2026-01-01"), workflowVersion: { id: VERSION_ID, workflowId: "wf1", version: 3, definition: def }, nodeRuns: nodes, ...over,
  };
}

function setup(opts: { run?: ReturnType<typeof runRow> | null; workflowStatus?: string; projectStatus?: string; version?: unknown; icp?: unknown; valid?: boolean; blocker?: string | null; claimed?: boolean } = {}) {
  const prisma = {
    workflowRun: {
      findFirst: jest.fn(async () => (opts.run === undefined ? runRow("RUNNING", []) : opts.run)),
      findMany: jest.fn(async () => []),
      create: jest.fn(async () => ({ id: "new-run" })),
    },
    workflowVersion: { findFirst: jest.fn(async () => (opts.version === undefined ? { id: VERSION_ID, workflowId: "wf1", version: 3, definition: def } : opts.version)) },
    workflowNodeRun: { create: jest.fn(async () => ({})) },
    icpProfile: { findFirst: jest.fn(async () => (opts.icp === undefined ? { id: "icp1" } : opts.icp)) },
  };
  const projects = {
    findOneOrThrow: jest.fn(async (w: { id: string }, projectId: string) => {
      if (w.id !== "ws1" || projectId !== "proj1") throw notFound("Project");
      return { id: projectId, workspaceId: w.id, status: opts.projectStatus ?? "ACTIVE" };
    }),
  };
  const workflows = {
    findOwnedOrThrow: jest.fn(async (w: { id: string }, projectId: string) => {
      if (w.id !== "ws1" || projectId !== "proj1") throw notFound("Project");
      return { id: "wf1", projectId, status: opts.workflowStatus ?? "ACTIVE" };
    }),
  };
  const validator = { validate: jest.fn(async () => ({ valid: opts.valid ?? true, issues: opts.valid === false ? [{ code: "NODE_NO_INPUT", message: "x" }] : [] })) };
  const executor = {
    schedule: jest.fn(),
    blockerFor: jest.fn(async () => opts.blocker ?? null),
    resumeNode: jest.fn(async () => opts.claimed ?? true),
  };
  const state = { transitionRun: jest.fn(async () => true), transitionNode: jest.fn(async () => true) };
  const service = new ExecutionsService(prisma as never, projects as never, workflows as never, validator as never, executor as never, state as never);
  return { prisma, projects, workflows, validator, executor, state, service };
}

describe("ExecutionsService tenancy", () => {
  it.each([
    ["start", (s: ExecutionsService) => s.start(otherWs, "proj1", "wf1", "u", { versionId: VERSION_ID })],
    ["listForWorkflow", (s: ExecutionsService) => s.listForWorkflow(otherWs, "proj1", "wf1")],
    ["get", (s: ExecutionsService) => s.get(otherWs, "proj1", "run1")],
    ["cancel", (s: ExecutionsService) => s.cancel(otherWs, "proj1", "run1")],
    ["retry", (s: ExecutionsService) => s.retry(otherWs, "proj1", "run1")],
    ["resume", (s: ExecutionsService) => s.resume(otherWs, "proj1", "run1", "approval")],
  ])("%s refuses a project outside the caller's workspace and changes nothing", async (_n, call) => {
    const { service, prisma, executor, state } = setup();
    expect(await code(call(service))).toBe("NOT_FOUND");
    expect(prisma.workflowRun.create).not.toHaveBeenCalled();
    expect(prisma.workflowNodeRun.create).not.toHaveBeenCalled();
    expect(executor.schedule).not.toHaveBeenCalled();
    expect(executor.resumeNode).not.toHaveBeenCalled();
    expect(state.transitionRun).not.toHaveBeenCalled();
  });

  it("looks runs up by project and only among builder runs", async () => {
    const { service, prisma } = setup({ run: null });
    expect(await code(service.get(ws, "proj1", "classic-or-foreign-run"))).toBe("NOT_FOUND");
    expect(prisma.workflowRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "classic-or-foreign-run", projectId: "proj1", workflowVersionId: { not: null } } }));
  });
});

describe("ExecutionsService.start", () => {
  it("creates a run pinned to the named version with every node queued, then schedules it", async () => {
    const { service, prisma, executor } = setup();
    const res = await service.start(ws, "proj1", "wf1", "user1", { versionId: VERSION_ID, maxLlmProspects: 5 });

    expect(res).toEqual({ runId: "new-run" });
    const data = (prisma.workflowRun.create.mock.calls[0] as unknown as [{ data: Record<string, any> }])[0].data;
    expect(data).toMatchObject({ projectId: "proj1", icpProfileId: "icp1", workflowVersionId: VERSION_ID, status: "PENDING", triggeredById: "user1", options: { maxLlmProspects: 5 } });
    expect(data.nodeRuns.create).toHaveLength(10);
    expect(data.nodeRuns.create.every((n: Record<string, unknown>) => n.status === "QUEUED" && n.attempt === 1)).toBe(true);
    expect(executor.schedule).toHaveBeenCalledWith("new-run");
  });

  it("only accepts a version that belongs to this workflow", async () => {
    const { service, prisma } = setup({ version: null });
    expect(await code(service.start(ws, "proj1", "wf1", "u", { versionId: VERSION_ID }))).toBe("NOT_FOUND");
    expect(prisma.workflowVersion.findFirst).toHaveBeenCalledWith({ where: { id: VERSION_ID, workflowId: "wf1" } });
    expect(prisma.workflowRun.create).not.toHaveBeenCalled();
  });

  it("re-validates the version and refuses to run one that is no longer valid", async () => {
    const { service, prisma, executor } = setup({ valid: false });
    const err = (await service.start(ws, "proj1", "wf1", "u", { versionId: VERSION_ID }).catch((e: unknown) => e)) as AppException;
    expect(err.code).toBe("WORKFLOW_INVALID");
    expect(prisma.workflowRun.create).not.toHaveBeenCalled();
    expect(executor.schedule).not.toHaveBeenCalled();
  });

  it.each([
    ["an archived workflow", { workflowStatus: "ARCHIVED" }, "WORKFLOW_ARCHIVED"],
    ["an archived project", { projectStatus: "ARCHIVED" }, "PROJECT_ARCHIVED"],
    ["a project with no active ICP", { icp: null }, "ICP_NOT_ACTIVE"],
  ])("refuses %s", async (_n, opts, expected) => {
    const { service, prisma } = setup(opts as never);
    expect(await code(service.start(ws, "proj1", "wf1", "u", { versionId: VERSION_ID }))).toBe(expected);
    expect(prisma.workflowRun.create).not.toHaveBeenCalled();
  });
});

describe("ExecutionsService.cancel", () => {
  it("cancels an active run and skips steps that have not started or are waiting", async () => {
    const run = runRow("AWAITING_REVIEW", [nodeRun("source", "SUCCEEDED"), nodeRun("approval", "WAITING"), nodeRun("send", "QUEUED")]);
    const { service, state } = setup({ run });
    await service.cancel(ws, "proj1", "run1");

    expect(state.transitionRun).toHaveBeenCalledWith("run1", ["PENDING", "RUNNING", "AWAITING_REVIEW"], "CANCELLED", expect.objectContaining({ currentStep: null }));
    const skipped = state.transitionNode.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(skipped.sort()).toEqual(["nr-approval-1", "nr-send-1"]);
  });

  it.each(["COMPLETED", "FAILED", "CANCELLED"])("refuses to cancel a %s run", async (status) => {
    const { service, state } = setup({ run: runRow(status, []) });
    expect(await code(service.cancel(ws, "proj1", "run1"))).toBe("WORKFLOW_RUN_NOT_ACTIVE");
    expect(state.transitionRun).not.toHaveBeenCalled();
  });

  it("reports a conflict when the run finished while cancelling", async () => {
    const { service, state } = setup({ run: runRow("RUNNING", [nodeRun("source", "RUNNING")]) });
    state.transitionRun.mockResolvedValueOnce(false);
    expect(await code(service.cancel(ws, "proj1", "run1"))).toBe("WORKFLOW_RUN_NOT_ACTIVE");
    expect(state.transitionNode).not.toHaveBeenCalled();
  });
});

describe("ExecutionsService.retry", () => {
  it("adds a new attempt for only the failed step and restarts the run", async () => {
    const run = runRow("FAILED", [nodeRun("source", "SUCCEEDED"), nodeRun("qualify", "FAILED", { attempt: 1, nodeType: "QUALIFY" })]);
    const { service, prisma, state, executor } = setup({ run });
    await service.retry(ws, "proj1", "run1");

    expect(prisma.workflowNodeRun.create).toHaveBeenCalledTimes(1);
    expect(prisma.workflowNodeRun.create).toHaveBeenCalledWith({ data: { workflowRunId: "run1", nodeId: "qualify", nodeType: "QUALIFY", attempt: 2, status: "QUEUED" } });
    expect(state.transitionRun).toHaveBeenCalledWith("run1", ["FAILED"], "PENDING", { error: null, finishedAt: null });
    expect(executor.schedule).toHaveBeenCalledWith("run1");
  });

  it("numbers the next attempt after the latest one", async () => {
    const run = runRow("FAILED", [nodeRun("qualify", "FAILED", { attempt: 1 }), nodeRun("qualify", "FAILED", { attempt: 2 })]);
    const { service, prisma } = setup({ run });
    await service.retry(ws, "proj1", "run1");
    expect(prisma.workflowNodeRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ attempt: 3 }) });
  });

  it("refuses a run that has not failed or has nothing to retry", async () => {
    expect(await code(setup({ run: runRow("RUNNING", []) }).service.retry(ws, "proj1", "run1"))).toBe("WORKFLOW_RUN_NOT_RETRYABLE");
    expect(await code(setup({ run: runRow("FAILED", [nodeRun("qualify", "SUCCEEDED")]) }).service.retry(ws, "proj1", "run1"))).toBe("WORKFLOW_RUN_NOT_RETRYABLE");
  });

  it("answers a double click with a conflict instead of a second attempt", async () => {
    const run = runRow("FAILED", [nodeRun("qualify", "FAILED")]);
    const { service, prisma, executor } = setup({ run });
    prisma.workflowNodeRun.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "t" }));
    expect(await code(service.retry(ws, "proj1", "run1"))).toBe("WORKFLOW_RUN_NOT_RETRYABLE");
    expect(executor.schedule).not.toHaveBeenCalled();
  });
});

describe("ExecutionsService.resume", () => {
  const waiting = () => runRow("AWAITING_REVIEW", [nodeRun("approval", "WAITING", { nodeType: "HUMAN_APPROVAL" })]);

  it("resumes the waiting step", async () => {
    const { service, executor } = setup({ run: waiting() });
    await service.resume(ws, "proj1", "run1", "approval");
    expect(executor.resumeNode).toHaveBeenCalledTimes(1);
  });

  it("returns 409 REVIEW_INCOMPLETE with the reason when emails are still undecided", async () => {
    const { service, executor } = setup({ run: waiting(), blocker: "2 email(s) still need a decision." });
    const err = (await service.resume(ws, "proj1", "run1", "approval").catch((e: unknown) => e)) as AppException;
    expect(err.code).toBe("REVIEW_INCOMPLETE");
    expect(err.message).toContain("2 email(s)");
    expect(executor.resumeNode).not.toHaveBeenCalled();
  });

  it("returns 409 when another request already resumed it", async () => {
    const { service } = setup({ run: waiting(), claimed: false });
    expect(await code(service.resume(ws, "proj1", "run1", "approval"))).toBe("WORKFLOW_NODE_NOT_WAITING");
  });

  it("refuses a step that is not waiting, or a run that is not awaiting review", async () => {
    const finished = runRow("RUNNING", [nodeRun("approval", "SUCCEEDED")]);
    expect(await code(setup({ run: finished }).service.resume(ws, "proj1", "run1", "approval"))).toBe("WORKFLOW_NODE_NOT_WAITING");
    const stale = runRow("COMPLETED", [nodeRun("approval", "WAITING")]);
    expect(await code(setup({ run: stale }).service.resume(ws, "proj1", "run1", "approval"))).toBe("WORKFLOW_NODE_NOT_WAITING");
  });

  it("404s for a step id that is not in the run", async () => {
    expect(await code(setup({ run: waiting() }).service.resume(ws, "proj1", "run1", "no-such-node"))).toBe("NOT_FOUND");
  });
});

describe("RecoveryService", () => {
  function make(runs: object[]) {
    const prisma = { workflowRun: { findMany: jest.fn(async () => runs) } };
    const state = { transitionNode: jest.fn(async () => true), transitionRun: jest.fn(async () => true) };
    const executor = { schedule: jest.fn() };
    return { prisma, state, executor, service: new RecoveryService(prisma as never, state as never, executor as never) };
  }

  it("fails a run that was mid-step when the server stopped, and says how to continue", async () => {
    const { service, state, executor } = make([{ id: "run1", nodeRuns: [nodeRun("source", "SUCCEEDED"), nodeRun("normalize", "RUNNING")] }]);
    expect(await service.recover()).toEqual({ failed: 1, rescheduled: 0 });
    expect(state.transitionNode).toHaveBeenCalledWith("nr-normalize-1", ["RUNNING"], "FAILED", expect.objectContaining({ error: INTERRUPTED_MESSAGE }), expect.anything());
    expect(state.transitionRun).toHaveBeenCalledWith("run1", ["PENDING", "RUNNING"], "FAILED", expect.objectContaining({ error: INTERRUPTED_MESSAGE }));
    expect(executor.schedule).not.toHaveBeenCalled();
  });

  it("continues a run that was between steps instead of failing it", async () => {
    const { service, state, executor } = make([{ id: "run1", nodeRuns: [nodeRun("source", "SUCCEEDED"), nodeRun("normalize", "QUEUED")] }]);
    expect(await service.recover()).toEqual({ failed: 0, rescheduled: 1 });
    expect(executor.schedule).toHaveBeenCalledWith("run1");
    expect(state.transitionRun).not.toHaveBeenCalled();
  });

  it("ignores a step whose newer attempt has already been queued", async () => {
    const { service, executor } = make([{ id: "run1", nodeRuns: [nodeRun("qualify", "RUNNING", { attempt: 1 }), nodeRun("qualify", "QUEUED", { attempt: 2 })] }]);
    expect(await service.recover()).toEqual({ failed: 0, rescheduled: 1 });
    expect(executor.schedule).toHaveBeenCalled();
  });

  it("only looks at builder runs that are pending or running, never runs waiting for review", async () => {
    const { service, prisma } = make([]);
    await service.recover();
    expect(prisma.workflowRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workflowVersionId: { not: null }, status: { in: ["PENDING", "RUNNING"] } } }));
  });

  it("does not crash application start when recovery itself fails", async () => {
    const { service, prisma } = make([]);
    prisma.workflowRun.findMany.mockRejectedValueOnce(new Error("db down"));
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
