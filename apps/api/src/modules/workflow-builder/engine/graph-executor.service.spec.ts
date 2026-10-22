import { WorkflowDefinition, defaultProspectingDefinition } from "@prospect/shared";
import { GraphExecutorService } from "./graph-executor.service";
import { RunStateService } from "./run-state.service";
import type { NodeContext, NodeHandler, NodeResult } from "./node-handler.interface";

const def = WorkflowDefinition.parse(defaultProspectingDefinition());
type Row = Record<string, any>;

function makeDb(definition = def, runOver: Row = {}) {
  const run: Row = {
    id: "run1", projectId: "proj1", icpProfileId: "icp1", workflowVersionId: "ver1", status: "PENDING", options: {}, summary: {},
    currentStep: null, error: null, startedAt: null, finishedAt: null, createdAt: new Date(), ...runOver,
  };
  const version = { id: "ver1", workflowId: "wf1", version: 1, definition };
  const nodeRuns: Row[] = definition.nodes.map((n, i) => ({
    id: `nr-${n.id}-1`, workflowRunId: "run1", nodeId: n.id, nodeType: n.type, attempt: 1, status: "QUEUED", input: null, outputs: null,
    summary: {}, logs: [], error: null, startedAt: null, finishedAt: null, createdAt: new Date(2026, 0, 1, 0, 0, i),
  }));
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([k, v]) => (v && typeof v === "object" && "in" in v ? v.in.includes(row[k]) : row[k] === v));

  const prisma = {
    workflowRun: {
      findUnique: async ({ select }: Row) => (select ? { status: run.status } : { ...run, workflowVersion: version, nodeRuns: nodeRuns.map((r) => ({ ...r })) }),
      updateMany: async ({ where, data }: Row) => {
        if (!matches(run, where)) return { count: 0 };
        Object.assign(run, data);
        return { count: 1 };
      },
    },
    workflowNodeRun: {
      findUnique: async ({ where }: Row) => {
        const r = nodeRuns.find((x) => x.id === where.id);
        return r ? { ...r } : null;
      },
      findMany: async () => nodeRuns.map((r) => ({ ...r })),
      updateMany: async ({ where, data }: Row) => {
        const r = nodeRuns.find((x) => x.id === where.id);
        if (!r || !matches(r, { status: where.status })) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      },
      update: async ({ where, data }: Row) => Object.assign(nodeRuns.find((x) => x.id === where.id)!, data),
    },
    project: { findUniqueOrThrow: async () => ({ workspaceId: "ws1" }) },
  };
  const latest = (nodeId: string) => nodeRuns.filter((r) => r.nodeId === nodeId).sort((a, b) => b.attempt - a.attempt)[0]!;
  return { run, nodeRuns, prisma, latest };
}

type Behaviour = (ctx: NodeContext) => NodeResult | Promise<NodeResult>;

function makeExecutor(db: ReturnType<typeof makeDb>, behaviours: Record<string, Behaviour>, extra: Record<string, Partial<NodeHandler>> = {}) {
  const calls: { nodeId: string; input: string[]; attempt: number; budget: { used: number; max: number } }[] = [];
  const types = ["DATA_SOURCE", "NORMALIZE", "QUALIFY", "CONDITION", "ENRICH", "REQUALIFY", "GENERATE_EMAIL", "AI_QA", "HUMAN_APPROVAL", "SIMULATED_SEND"] as const;
  const handlers = types.map((type) => ({
    type,
    ...(extra[type] ?? {}),
    run: async (ctx: NodeContext) => {
      calls.push({ nodeId: ctx.node.id, input: ctx.input, attempt: ctx.attempt, budget: { ...ctx.budget } });
      const behave = behaviours[ctx.node.id];
      if (!behave) return { kind: "done", outputs: { out: ctx.input }, summary: {} } as NodeResult;
      return behave(ctx);
    },
    ...(type === "HUMAN_APPROVAL"
      ? { resume: async () => ({ kind: "done", outputs: { approved: ["p1"], rejected: [] }, summary: { approved: 1 } }) as NodeResult }
      : {}),
  }));
  const state = new RunStateService(db.prisma as never);
  const executor = new GraphExecutorService(db.prisma as never, state, ...(handlers as [never, never, never, never, never, never, never, never, never, never]));
  return { executor, calls, state };
}

const done = (outputs: Record<string, string[]>, extra: Partial<Extract<NodeResult, { kind: "done" }>> = {}): NodeResult => ({ kind: "done", outputs, summary: {}, ...extra });
const statusOf = (db: ReturnType<typeof makeDb>) => Object.fromEntries(db.nodeRuns.map((r) => [r.nodeId, r.status]));

const FULL_FLOW: Record<string, Behaviour> = {
  source: () => done({ out: ["c1", "c2"] }),
  normalize: (ctx) => done({ out: ctx.input }),
  qualify: () => done({ out: ["p1", "p2"] }),
  missing: () => done({ true: ["p1"], false: ["p2"] }),
  enrich: (ctx) => done({ out: ctx.input }),
  requalify: (ctx) => done({ out: ctx.input }),
  generate: (ctx) => done({ out: ctx.input }),
  qa: (ctx) => done({ out: ctx.input }),
  approval: () => ({ kind: "wait", summary: { pendingReview: 2 } }),
  send: () => done({}),
};

describe("GraphExecutorService", () => {
  it("runs the template in order, routes items by branch, merges them, and waits at approval", async () => {
    const db = makeDb();
    const { executor, calls } = makeExecutor(db, FULL_FLOW);

    await executor.advance("run1");

    expect(calls.map((c) => c.nodeId)).toEqual(["source", "normalize", "qualify", "missing", "enrich", "requalify", "generate", "qa", "approval"]);
    expect(calls.find((c) => c.nodeId === "enrich")!.input).toEqual(["p1"]);
    expect(calls.find((c) => c.nodeId === "generate")!.input).toEqual(["p1", "p2"]);
    expect(db.run.status).toBe("AWAITING_REVIEW");
    expect(statusOf(db)).toMatchObject({ source: "SUCCEEDED", approval: "WAITING", send: "QUEUED" });
    expect(db.latest("approval").summary).toEqual({ pendingReview: 2 });
  });

  it("resumes the waiting node, continues with only the approved items, and completes", async () => {
    const db = makeDb();
    const { executor, calls } = makeExecutor(db, FULL_FLOW);
    await executor.advance("run1");

    const fresh = (await db.prisma.workflowRun.findUnique({ where: {} })) as never as Row;
    const claimed = await executor.resumeNode(fresh as never, db.latest("approval") as never);
    expect(claimed).toBe(true);
    await executor.idle("run1");

    expect(calls[calls.length - 1]).toMatchObject({ nodeId: "send", input: ["p1"] });
    expect(db.run.status).toBe("COMPLETED");
    expect(statusOf(db).approval).toBe("SUCCEEDED");
    expect(db.latest("approval").logs.map((l: Row) => l.message)).toEqual(expect.arrayContaining(["Waiting for a person to review", "Resumed after review"]));
  });

  it("refuses a second resume of the same node so approval cannot be applied twice", async () => {
    const db = makeDb();
    const { executor } = makeExecutor(db, FULL_FLOW);
    await executor.advance("run1");
    const fresh = (await db.prisma.workflowRun.findUnique({ where: {} })) as never as Row;
    const waiting = { ...db.latest("approval") };

    expect(await executor.resumeNode(fresh as never, waiting as never)).toBe(true);
    expect(await executor.resumeNode(fresh as never, waiting as never)).toBe(false);
  });

  it("skips a step that receives no items and keeps going to the end", async () => {
    const db = makeDb();
    const { executor, calls } = makeExecutor(db, { source: () => done({ out: [] }) });
    await executor.advance("run1");

    expect(calls.map((c) => c.nodeId)).toEqual(["source"]);
    expect(db.run.status).toBe("COMPLETED");
    expect(statusOf(db).normalize).toBe("SKIPPED");
    expect(db.latest("normalize").summary).toMatchObject({ skipReason: "No items reached this step" });
  });

  it("still runs a step that declares it can run with no input (Normalize)", async () => {
    const db = makeDb();
    const { executor, calls } = makeExecutor(db, { source: () => done({ out: [] }), normalize: () => done({ out: ["c9"] }) }, { NORMALIZE: { runsOnEmptyInput: true } });
    await executor.advance("run1");
    expect(calls.map((c) => c.nodeId).slice(0, 3)).toEqual(["source", "normalize", "qualify"]);
    expect(calls[2]!.input).toEqual(["c9"]);
  });

  it("passes items through a step that skips itself with nothing to do", async () => {
    const db = makeDb();
    const { executor, calls } = makeExecutor(db, { ...FULL_FLOW, enrich: (ctx) => done({ out: ctx.input }, { skipped: true, skipReason: "No eligible prospect" }) });
    await executor.advance("run1");

    expect(statusOf(db).enrich).toBe("SKIPPED");
    expect(calls.find((c) => c.nodeId === "requalify")!.input).toEqual(["p1"]);
  });

  it("marks the node and the run failed when a step throws, and runs nothing after it", async () => {
    const db = makeDb();
    const { executor, calls } = makeExecutor(db, {
      ...FULL_FLOW,
      qualify: () => {
        throw new Error("provider exploded");
      },
    });
    await executor.advance("run1");

    expect(db.run).toMatchObject({ status: "FAILED", error: "Qualify: provider exploded" });
    expect(db.latest("qualify")).toMatchObject({ status: "FAILED", error: "provider exploded" });
    expect(calls.map((c) => c.nodeId)).toEqual(["source", "normalize", "qualify"]);
    expect(statusOf(db).missing).toBe("QUEUED");
    expect(db.latest("qualify").logs.some((l: Row) => l.level === "error")).toBe(true);
  });

  it("retries only the failed step as a new attempt and never reruns finished steps", async () => {
    const db = makeDb();
    let fail = true;
    const { executor, calls } = makeExecutor(db, {
      ...FULL_FLOW,
      qualify: () => {
        if (fail) throw new Error("temporary");
        return done({ out: ["p1", "p2"] });
      },
    });
    await executor.advance("run1");
    expect(db.run.status).toBe("FAILED");

    fail = false;
    db.nodeRuns.push({ ...db.latest("qualify"), id: "nr-qualify-2", attempt: 2, status: "QUEUED", error: null, logs: [], createdAt: new Date() });
    db.run.status = "PENDING";
    db.run.error = null;
    await executor.advance("run1");

    const ran = calls.map((c) => `${c.nodeId}#${c.attempt}`);
    expect(ran.filter((r) => r.startsWith("source")).length).toBe(1);
    expect(ran.filter((r) => r.startsWith("normalize")).length).toBe(1);
    expect(ran).toContain("qualify#2");
    expect(db.run.status).toBe("AWAITING_REVIEW");
    expect(db.nodeRuns.filter((r) => r.nodeId === "qualify").map((r) => r.status)).toEqual(["FAILED", "SUCCEEDED"]);
  });

  it("does not run a step twice when the run is advanced twice at once", async () => {
    const db = makeDb();
    const { executor, calls } = makeExecutor(db, FULL_FLOW);
    executor.schedule("run1");
    executor.schedule("run1");
    await executor.idle("run1");
    const names = calls.map((c) => c.nodeId);
    expect(new Set(names).size).toBe(names.length);
    expect(db.run.status).toBe("AWAITING_REVIEW");
  });

  it("does not claim a step another worker already started", async () => {
    const db = makeDb();
    const { executor, calls } = makeExecutor(db, FULL_FLOW);
    db.latest("source").status = "RUNNING";
    await executor.advance("run1");
    expect(calls).toEqual([]);
  });

  it("does not execute a step whose claim was lost to another worker", async () => {
    const db = makeDb();
    const { executor, calls } = makeExecutor(db, FULL_FLOW);
    const original = db.prisma.workflowNodeRun.updateMany;
    db.prisma.workflowNodeRun.updateMany = async (args: Row) => {
      if (args.where.id === "nr-source-1" && args.data.status === "RUNNING") {
        db.latest("source").status = "RUNNING";
      }
      return original(args);
    };
    await executor.advance("run1");
    expect(calls).toEqual([]);
    expect(statusOf(db).normalize).toBe("QUEUED");
  });

  it("stops after the current step when the run is cancelled mid-flight", async () => {
    const db = makeDb();
    const { executor, calls } = makeExecutor(db, {
      ...FULL_FLOW,
      qualify: () => {
        db.run.status = "CANCELLED";
        return done({ out: ["p1", "p2"] });
      },
    });
    await executor.advance("run1");

    expect(calls.map((c) => c.nodeId)).toEqual(["source", "normalize", "qualify"]);
    expect(db.run.status).toBe("CANCELLED");
    expect(statusOf(db).missing).toBe("QUEUED");
  });

  it("does nothing for a run that is already finished", async () => {
    for (const status of ["COMPLETED", "FAILED", "CANCELLED"]) {
      const db = makeDb(def, { status });
      const { executor, calls } = makeExecutor(db, FULL_FLOW);
      await executor.advance("run1");
      expect(calls).toEqual([]);
    }
  });

  it("gives each step a run-wide LLM budget made from what earlier steps used", async () => {
    const db = makeDb(def, { options: { maxLlmProspects: 10 } });
    const { executor, calls } = makeExecutor(db, {
      ...FULL_FLOW,
      requalify: () => done({ out: ["p1"] }, { llmUnits: 4 }),
      generate: () => done({ out: ["p1"] }, { llmUnits: 3 }),
    });
    await executor.advance("run1");

    expect(calls.find((c) => c.nodeId === "requalify")!.budget).toEqual({ used: 0, max: 10 });
    expect(calls.find((c) => c.nodeId === "generate")!.budget).toEqual({ used: 4, max: 10 });
    expect(calls.find((c) => c.nodeId === "qa")!.budget).toEqual({ used: 7, max: 10 });
  });

  it("records a log line for every transition, with ids and counts only", async () => {
    const db = makeDb();
    const { executor } = makeExecutor(db, FULL_FLOW);
    await executor.advance("run1");
    const messages = db.latest("qualify").logs.map((l: Row) => l.message);
    expect(messages).toEqual(["Started with 2 item(s)", "Finished (out: 2)"]);
    for (const l of db.latest("qualify").logs) expect(Number.isNaN(Date.parse(l.at))).toBe(false);
  });

  it("fails the run clearly when the version has a step that can never run", async () => {
    const db = makeDb();
    db.nodeRuns.splice(db.nodeRuns.findIndex((r) => r.nodeId === "normalize"), 1);
    const { executor } = makeExecutor(db, FULL_FLOW);
    await executor.advance("run1");
    expect(db.run.status).toBe("FAILED");
    expect(db.run.error).toContain("cannot continue");
  });
});
