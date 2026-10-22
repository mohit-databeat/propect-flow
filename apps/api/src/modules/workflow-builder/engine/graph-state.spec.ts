import { WorkflowDefinition, defaultProspectingDefinition } from "@prospect/shared";
import { inputFor, latestAttempts, planNext, type NodeRunState, type NodeRunStatusValue } from "./graph-state";

const def = WorkflowDefinition.parse(defaultProspectingDefinition());
const ALL = def.nodes.map((n) => n.id);

function rows(overrides: Record<string, Partial<NodeRunState> & { status: NodeRunStatusValue }> = {}): NodeRunState[] {
  return ALL.map((nodeId) => ({ nodeId, attempt: 1, outputs: null, ...(overrides[nodeId] ?? { status: "QUEUED" as const }) }) as NodeRunState);
}

const done = (outputs: Record<string, string[]> = { out: [] }): Partial<NodeRunState> & { status: "SUCCEEDED" } => ({ status: "SUCCEEDED", outputs });

describe("planNext", () => {
  it("starts with the Data Source when everything is queued", () => {
    expect(planNext(def, rows())).toEqual({ action: "run", nodeId: "source", input: [] });
  });

  it("moves down the chain one node at a time", () => {
    const plan = planNext(def, rows({ source: done({ out: ["c1", "c2"] }), normalize: done({ out: ["c1", "c2"] }) }));
    expect(plan).toEqual({ action: "run", nodeId: "qualify", input: ["c1", "c2"] });
  });

  it("routes each Condition branch to its own successor", () => {
    const base = { source: done(), normalize: done(), qualify: done({ out: ["p1", "p2", "p3"] }), missing: done({ true: ["p1"], false: ["p2", "p3"] }) };
    expect(planNext(def, rows(base))).toEqual({ action: "run", nodeId: "enrich", input: ["p1"] });

    const afterEnrichBranch = { ...base, enrich: done({ out: ["p1"] }), requalify: done({ out: ["p1"] }) };
    expect(planNext(def, rows(afterEnrichBranch))).toEqual({ action: "run", nodeId: "generate", input: ["p1", "p2", "p3"] });
  });

  it("does not run a merge node until every parent has settled", () => {
    const plan = planNext(def, rows({ source: done(), normalize: done(), qualify: done(), missing: done({ true: ["p1"], false: ["p2"] }) }));
    expect(plan).toMatchObject({ action: "run", nodeId: "enrich" });
    expect((plan as { nodeId: string }).nodeId).not.toBe("generate");
  });

  it("de-duplicates items that arrive from two parents", () => {
    const base = { source: done(), normalize: done(), qualify: done(), missing: done({ true: ["p1", "p2"], false: ["p3"] }), enrich: done({ out: ["p1", "p2"] }), requalify: done({ out: ["p2", "p1"] }) };
    expect(planNext(def, rows(base))).toEqual({ action: "run", nodeId: "generate", input: ["p2", "p1", "p3"] });
  });

  it("treats a skipped parent as settled with no items", () => {
    const base = {
      source: done(),
      normalize: done(),
      qualify: done(),
      missing: done({ true: [], false: ["p3"] }),
      enrich: { status: "SKIPPED" as const },
      requalify: { status: "SKIPPED" as const },
    };
    expect(planNext(def, rows(base))).toEqual({ action: "run", nodeId: "generate", input: ["p3"] });
  });

  it("reports a running node instead of starting another", () => {
    expect(planNext(def, rows({ source: { status: "RUNNING" } }))).toEqual({ action: "running" });
  });

  it("waits when the only open node is waiting for a person", () => {
    const base = {
      source: done(), normalize: done(), qualify: done(), missing: done(), enrich: { status: "SKIPPED" as const }, requalify: { status: "SKIPPED" as const },
      generate: done(), qa: done(), approval: { status: "WAITING" as const },
    };
    expect(planNext(def, rows(base))).toEqual({ action: "wait" });
  });

  it("still runs a ready branch while another node is waiting", () => {
    const base = {
      source: done(), normalize: done(), qualify: done({ out: ["p1"] }), missing: done({ true: ["p1"], false: [] }), enrich: done({ out: ["p1"] }), requalify: done({ out: ["p1"] }),
      generate: done({ out: ["p1"] }), qa: done({ out: ["p1"] }), approval: done({ approved: ["p1"], rejected: [] }),
    };
    expect(planNext(def, rows(base))).toEqual({ action: "run", nodeId: "send", input: ["p1"] });
  });

  it("completes when every node has settled", () => {
    const base: Record<string, { status: NodeRunStatusValue; outputs?: Record<string, string[]> }> = {};
    for (const id of ALL) base[id] = { status: "SUCCEEDED", outputs: {} };
    expect(planNext(def, rows(base))).toEqual({ action: "complete" });
  });

  it("completes when the tail was skipped", () => {
    const base: Record<string, { status: NodeRunStatusValue; outputs?: Record<string, string[]> }> = {};
    for (const id of ALL) base[id] = { status: "SKIPPED" };
    base.source = { status: "SUCCEEDED", outputs: { out: [] } };
    expect(planNext(def, rows(base))).toEqual({ action: "complete" });
  });

  it("reports a failed node and nothing runs after it", () => {
    expect(planNext(def, rows({ source: done(), normalize: { status: "FAILED" } }))).toEqual({ action: "fail", nodeId: "normalize" });
  });

  it("uses only the latest attempt, so a retried node clears the failure", () => {
    const all = [
      ...rows({ source: done() }).filter((r) => r.nodeId !== "normalize"),
      { nodeId: "normalize", attempt: 1, status: "FAILED" as const, outputs: null },
      { nodeId: "normalize", attempt: 2, status: "QUEUED" as const, outputs: null },
    ];
    expect(planNext(def, all)).toEqual({ action: "run", nodeId: "normalize", input: [] });
  });

  it("flags a run whose nodes cannot make progress", () => {
    const partial = rows({ source: done() }).filter((r) => r.nodeId === "source");
    const plan = planNext(def, partial);
    expect(plan.action).toBe("stuck");
  });
});

describe("latestAttempts", () => {
  it("keeps the highest attempt per node", () => {
    const latest = latestAttempts([
      { nodeId: "a", attempt: 2, status: "QUEUED", outputs: null },
      { nodeId: "a", attempt: 1, status: "FAILED", outputs: null },
      { nodeId: "b", attempt: 1, status: "SUCCEEDED", outputs: null },
    ]);
    expect(latest.get("a")!.attempt).toBe(2);
    expect(latest.size).toBe(2);
  });
});

describe("inputFor", () => {
  it("ignores parents that failed, are still queued, or are waiting", () => {
    for (const status of ["FAILED", "QUEUED", "WAITING", "RUNNING"] as const) {
      const latest = latestAttempts(rows({ source: { status, outputs: { out: ["c1"] } } }));
      expect(inputFor(def, "normalize", latest)).toEqual([]);
    }
  });

  it("passes on what a step handed through even though it skipped itself", () => {
    const latest = latestAttempts(rows({ source: { status: "SKIPPED", outputs: { out: ["c1"] } } }));
    expect(inputFor(def, "normalize", latest)).toEqual(["c1"]);
  });

  it("reads only the output handle the edge starts from", () => {
    const latest = latestAttempts(rows({ missing: done({ true: ["t"], false: ["f"] }) }));
    expect(inputFor(def, "enrich", latest)).toEqual(["t"]);
    expect(inputFor(def, "generate", latest)).toEqual(["f"]);
  });
});
