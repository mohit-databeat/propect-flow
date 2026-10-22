import type { WorkflowDraftDefinition } from "./definition.schema";
import { LAYOUT, autoLayout } from "./auto-layout";
import { topologicalOrder } from "./graph";
import { defaultProspectingDefinition } from "./templates";

const draft = (nodes: { id: string; type: string }[], edges: [string, string, string?][]): WorkflowDraftDefinition => ({
  schemaVersion: 1,
  nodes: nodes.map((n) => ({ id: n.id, type: n.type as never, position: { x: 999, y: 999 }, config: {} })),
  edges: edges.map(([source, target, sourceHandle], i) => ({ id: `e${i}`, source, sourceHandle: sourceHandle ?? "out", target })),
});

const pos = (def: WorkflowDraftDefinition, id: string) => def.nodes.find((n) => n.id === id)!.position;

describe("autoLayout", () => {
  it("returns an empty workflow unchanged", () => {
    const empty = draft([], []);
    expect(autoLayout(empty)).toBe(empty);
  });

  it("stacks a chain top to bottom in one column", () => {
    const out = autoLayout(draft([{ id: "a", type: "DATA_SOURCE" }, { id: "b", type: "NORMALIZE" }, { id: "c", type: "QUALIFY" }], [["a", "b"], ["b", "c"]]));
    expect(pos(out, "a")).toEqual({ x: 0, y: 0 });
    expect(pos(out, "b")).toEqual({ x: 0, y: LAYOUT.rowHeight });
    expect(pos(out, "c")).toEqual({ x: 0, y: LAYOUT.rowHeight * 2 });
  });

  it("puts the True branch left of the False branch and centres the parent above them", () => {
    const out = autoLayout(
      draft(
        [{ id: "q", type: "QUALIFY" }, { id: "cond", type: "CONDITION" }, { id: "no", type: "GENERATE_EMAIL" }, { id: "yes", type: "ENRICH" }],
        [["q", "cond"], ["cond", "no", "false"], ["cond", "yes", "true"]],
      ),
    );
    expect(pos(out, "yes").x).toBeLessThan(pos(out, "no").x);
    expect(pos(out, "yes").y).toBe(pos(out, "no").y);
    expect(pos(out, "cond").x).toBeCloseTo((pos(out, "yes").x + pos(out, "no").x) / 2, 0);
    expect(pos(out, "q").x).toBe(pos(out, "cond").x);
  });

  it("keeps side-by-side nodes at least a card width apart", () => {
    const out = autoLayout(
      draft([{ id: "src", type: "DATA_SOURCE" }, ...["a", "b", "c", "d"].map((id) => ({ id, type: "NORMALIZE" }))], ["a", "b", "c", "d"].map((id) => ["src", id] as [string, string])),
    );
    const xs = ["a", "b", "c", "d"].map((id) => pos(out, id).x).sort((m, n) => m - n);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(LAYOUT.nodeWidth);
  });

  it("places a merge node below its lowest parent", () => {
    const out = autoLayout(draft(
      [{ id: "a", type: "DATA_SOURCE" }, { id: "b", type: "NORMALIZE" }, { id: "c", type: "QUALIFY" }, { id: "m", type: "ENRICH" }],
      [["a", "b"], ["b", "c"], ["a", "m"], ["c", "m"]],
    ));
    expect(pos(out, "m").y).toBe(pos(out, "c").y + LAYOUT.rowHeight);
  });

  it("lays out the default template vertically with the branches side by side and the merge below them", () => {
    const out = autoLayout(defaultProspectingDefinition() as WorkflowDraftDefinition);
    expect(pos(out, "source").y).toBe(0);
    expect(pos(out, "enrich").x).toBeLessThan(pos(out, "generate").x + 1);
    const ys = out.nodes.map((n) => n.position.y);
    expect(Math.max(...ys)).toBeLessThan(LAYOUT.rowHeight * 12);
    expect(pos(out, "generate").y).toBeGreaterThan(pos(out, "requalify").y);
    expect(Math.min(...out.nodes.map((n) => n.position.x))).toBe(0);
  });

  it("copes with disconnected nodes and cycles without throwing or losing nodes", () => {
    const cyc = draft([{ id: "a", type: "ENRICH" }, { id: "b", type: "REQUALIFY" }, { id: "lonely", type: "AI_QA" }], [["a", "b"], ["b", "a"]]);
    const out = autoLayout(cyc);
    expect(out.nodes).toHaveLength(3);
    for (const n of out.nodes) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
  });

  it("stacks nodes that are not connected to anything in one column instead of one wide row", () => {
    const out = autoLayout(draft(["a", "b", "c", "d"].map((id) => ({ id, type: "NORMALIZE" })), []));
    expect(out.nodes.map((n) => n.position)).toEqual([0, 1, 2, 3].map((i) => ({ x: 0, y: i * LAYOUT.rowHeight })));
  });

  it("puts unconnected nodes in their own column beside the connected flow", () => {
    const out = autoLayout(draft([{ id: "a", type: "DATA_SOURCE" }, { id: "b", type: "NORMALIZE" }, { id: "x", type: "AI_QA" }, { id: "y", type: "ENRICH" }], [["a", "b"]]));
    expect(pos(out, "a")).toEqual({ x: 0, y: 0 });
    expect(pos(out, "x").x).toBeGreaterThanOrEqual(LAYOUT.nodeWidth);
    expect(pos(out, "x").x).toBe(pos(out, "y").x);
    expect(pos(out, "y").y).toBe(pos(out, "x").y + LAYOUT.rowHeight);
  });

  it("changes only positions, never ids, order, configuration or connections", () => {
    const before = defaultProspectingDefinition() as WorkflowDraftDefinition;
    const after = autoLayout(before);
    expect(after.nodes.map((n) => ({ id: n.id, type: n.type, config: n.config, label: n.label }))).toEqual(before.nodes.map((n) => ({ id: n.id, type: n.type, config: n.config, label: n.label })));
    expect(after.edges).toEqual(before.edges);
  });

  it("does not affect execution order, which comes from connections and never from positions", () => {
    const before = defaultProspectingDefinition() as WorkflowDraftDefinition;
    const scrambled: WorkflowDraftDefinition = { ...before, nodes: before.nodes.map((n, i) => ({ ...n, position: { x: (i * 7919) % 1000, y: (i * 104729) % 1000 } })) };
    const orderOf = (d: WorkflowDraftDefinition) => topologicalOrder(d).order;
    expect(orderOf(autoLayout(scrambled))).toEqual(orderOf(before));
    expect(orderOf(scrambled)).toEqual(orderOf(before));
  });

  it("is stable when applied twice", () => {
    const once = autoLayout(defaultProspectingDefinition() as WorkflowDraftDefinition);
    expect(autoLayout(once)).toEqual(once);
  });

  it("honours an origin offset", () => {
    const out = autoLayout(draft([{ id: "a", type: "DATA_SOURCE" }], []), { originX: 100, originY: 40 });
    expect(pos(out, "a")).toEqual({ x: 100, y: 40 });
  });
});
