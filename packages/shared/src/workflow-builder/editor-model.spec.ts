import { MAX_WORKFLOW_EDGES, MAX_WORKFLOW_NODES, type WorkflowDraftDefinition } from "./definition.schema";
import { LAYOUT } from "./auto-layout";
import { addNode, applyEdgeChanges, connect, disconnect, moveNode, nextFreePosition, removeNode, renameNode, setNodeConfig } from "./editor-model";
import { defaultProspectingDefinition, emptyWorkflowDefinition } from "./templates";
import { validateDefinition } from "./validate-definition";

const empty = (): WorkflowDraftDefinition => emptyWorkflowDefinition() as WorkflowDraftDefinition;
const full = (): WorkflowDraftDefinition => defaultProspectingDefinition() as WorkflowDraftDefinition;

describe("addNode", () => {
  it("adds a node with the catalog's default config at a rounded position", () => {
    const result = addNode(empty(), "HUMAN_APPROVAL", { x: 10.6, y: 20.2 })!;
    expect(result.nodeId).toBe("approval");
    expect(result.definition.nodes[0]).toEqual({ id: "approval", type: "HUMAN_APPROVAL", position: { x: 11, y: 20 }, config: { requireAllReviewed: true } });
  });

  it("gives repeated node types unique ids", () => {
    let def = empty();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = addNode(def, "ENRICH", { x: i, y: 0 })!;
      def = r.definition;
      ids.push(r.nodeId);
    }
    expect(ids).toEqual(["enrich", "enrich-2", "enrich-3"]);
  });

  it("does not share config objects between nodes or with the catalog", () => {
    let def = addNode(empty(), "DATA_SOURCE", { x: 0, y: 0 })!.definition;
    const first = def.nodes[0]!.config as { dataSourceIds: string[] };
    first.dataSourceIds.push("x");
    def = addNode(def, "NORMALIZE", { x: 0, y: 0 })!.definition;
    expect(addNode(empty(), "DATA_SOURCE", { x: 0, y: 0 })!.definition.nodes[0]!.config).toEqual({ dataSourceIds: [], refresh: false });
  });

  it("refuses to exceed the node limit", () => {
    let def = empty();
    for (let i = 0; i < MAX_WORKFLOW_NODES; i++) def = addNode(def, "NORMALIZE", { x: i, y: 0 })!.definition;
    expect(addNode(def, "NORMALIZE", { x: 0, y: 0 })).toBeNull();
  });

  it("does not change the original definition", () => {
    const original = empty();
    addNode(original, "QUALIFY", { x: 0, y: 0 });
    expect(original.nodes).toHaveLength(0);
  });
});

describe("removeNode", () => {
  it("removes the node and every connection touching it", () => {
    const def = removeNode(full(), "enrich");
    expect(def.nodes.find((n) => n.id === "enrich")).toBeUndefined();
    expect(def.edges.some((e) => e.source === "enrich" || e.target === "enrich")).toBe(false);
    expect(def.edges.length).toBe(full().edges.length - 2);
  });
});

describe("moveNode, renameNode, setNodeConfig", () => {
  it("moves only the named node", () => {
    const def = moveNode(full(), "qa", { x: 5.4, y: 6.6 });
    expect(def.nodes.find((n) => n.id === "qa")!.position).toEqual({ x: 5, y: 7 });
    expect(def.nodes.find((n) => n.id === "qualify")!.position).toEqual(full().nodes.find((n) => n.id === "qualify")!.position);
  });

  it("sets, trims, caps and clears a label", () => {
    let def = renameNode(full(), "qa", "  Check quality  ");
    expect(def.nodes.find((n) => n.id === "qa")!.label).toBe("Check quality");
    def = renameNode(def, "qa", "x".repeat(200));
    expect(def.nodes.find((n) => n.id === "qa")!.label).toHaveLength(80);
    def = renameNode(def, "qa", "   ");
    expect(def.nodes.find((n) => n.id === "qa")).not.toHaveProperty("label");
  });

  it("replaces the config of one node", () => {
    const def = setNodeConfig(full(), "approval", { requireAllReviewed: false });
    expect(def.nodes.find((n) => n.id === "approval")!.config).toEqual({ requireAllReviewed: false });
    expect(def.nodes.find((n) => n.id === "send")!.config).toEqual({ campaignName: "Workflow campaign" });
  });
});

describe("connect", () => {
  const two = () => {
    let def = addNode(empty(), "DATA_SOURCE", { x: 0, y: 0 })!.definition;
    def = addNode(def, "NORMALIZE", { x: 200, y: 0 })!.definition;
    return def;
  };

  it("creates an edge and defaults to the node's only output", () => {
    const r = connect(two(), { source: "source", target: "normalize" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.definition.edges).toEqual([{ id: "source-out-normalize", source: "source", sourceHandle: "out", target: "normalize" }]);
  });

  it("uses the chosen output on a branching node", () => {
    let def = full();
    def = disconnect(def, "e7");
    const r = connect(def, { source: "missing", sourceHandle: "false", target: "generate" });
    expect(r.ok).toBe(true);
  });

  it.each([
    ["an unknown node", { source: "source", target: "nope" }, "must exist"],
    ["itself", { source: "source", target: "source" }, "itself"],
    ["a node with no outputs as the source", { source: "send", target: "qa" }, "no outputs"],
    ["an output that does not exist", { source: "source", sourceHandle: "maybe", target: "normalize" }, 'no "maybe" output'],
    ["into the Data Source", { source: "normalize", target: "source" }, "starts the workflow"],
    ["incompatible item kinds", { source: "normalize", target: "enrich" }, "needs prospects"],
  ])("rejects connecting %s", (_name, c, reason) => {
    let def = two();
    def = addNode(def, "ENRICH", { x: 400, y: 0 })!.definition;
    def = addNode(def, "SIMULATED_SEND", { x: 600, y: 0 })!.definition;
    def = addNode(def, "AI_QA", { x: 800, y: 0 })!.definition;
    const r = connect(def, c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(reason);
  });

  it("rejects the same connection twice", () => {
    const first = connect(two(), { source: "source", target: "normalize" });
    if (!first.ok) throw new Error("setup");
    const again = connect(first.definition, { source: "source", target: "normalize" });
    expect(again).toEqual({ ok: false, reason: "These steps are already connected this way" });
  });

  it("rejects connections past the limit", () => {
    let def = two();
    def = { ...def, edges: Array.from({ length: MAX_WORKFLOW_EDGES }, (_, i) => ({ id: `e${i}`, source: "x", sourceHandle: "out", target: "y" })) };
    expect(connect(def, { source: "source", target: "normalize" })).toEqual({ ok: false, reason: "This workflow has reached the connection limit" });
  });

  it("builds a valid workflow end to end using only the editor operations", () => {
    let def = empty();
    const ids: Record<string, string> = {};
    const place = (type: Parameters<typeof addNode>[1]) => {
      const r = addNode(def, type, nextFreePosition(def))!;
      def = r.definition;
      ids[type] = r.nodeId;
    };
    for (const t of ["DATA_SOURCE", "NORMALIZE", "QUALIFY"] as const) place(t);
    for (const [a, b] of [["DATA_SOURCE", "NORMALIZE"], ["NORMALIZE", "QUALIFY"]] as const) {
      const r = connect(def, { source: ids[a]!, target: ids[b]! });
      if (!r.ok) throw new Error(r.reason);
      def = r.definition;
    }
    expect(validateDefinition(def)).toEqual({ valid: true, issues: [] });
  });
});

describe("disconnect and applyEdgeChanges", () => {
  it("removes one edge", () => {
    expect(disconnect(full(), "e1").edges.some((e) => e.id === "e1")).toBe(false);
  });

  it("removes several edges and returns the same object when nothing changes", () => {
    const def = full();
    expect(applyEdgeChanges(def, [])).toBe(def);
    expect(applyEdgeChanges(def, ["e1", "e2"]).edges).toHaveLength(def.edges.length - 2);
  });
});

describe("nextFreePosition", () => {
  it("starts at the origin and then goes below the lowest node", () => {
    expect(nextFreePosition(empty())).toEqual({ x: 0, y: 0 });
    expect(nextFreePosition(moveNode(full(), "send", { x: 300, y: 3000 }))).toEqual({ x: 300, y: 3000 + LAYOUT.rowHeight });
  });

  it("goes below a chosen node, sidestepping anything already there", () => {
    let def = addNode(empty(), "DATA_SOURCE", { x: 0, y: 0 })!.definition;
    const first = nextFreePosition(def, "source");
    expect(first).toEqual({ x: 0, y: LAYOUT.rowHeight });
    def = addNode(def, "NORMALIZE", first)!.definition;
    const second = nextFreePosition(def, "source");
    expect(second.y).toBe(LAYOUT.rowHeight);
    expect(second.x).toBeGreaterThanOrEqual(LAYOUT.nodeWidth);
  });
});
