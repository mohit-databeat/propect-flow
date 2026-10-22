import { canonicalJson, parentIds, reachableFrom, topologicalOrder, type GraphLike } from "./graph";
import { defaultProspectingDefinition } from "./templates";

const g = (ids: string[], edges: [string, string][]): GraphLike => ({
  nodes: ids.map((id) => ({ id })),
  edges: edges.map(([source, target], i) => ({ id: `e${i}`, source, target })),
});

describe("topologicalOrder", () => {
  it("orders a chain", () => {
    expect(topologicalOrder(g(["a", "b", "c"], [["a", "b"], ["b", "c"]])).order).toEqual(["a", "b", "c"]);
  });

  it("places a merge node after all of its parents", () => {
    const { order, unresolved } = topologicalOrder(g(["a", "b", "c", "m"], [["a", "b"], ["a", "m"], ["b", "m"], ["c", "m"]]));
    expect(unresolved).toEqual([]);
    expect(order.indexOf("m")).toBeGreaterThan(order.indexOf("b"));
    expect(order.indexOf("m")).toBeGreaterThan(order.indexOf("c"));
  });

  it("is deterministic: ties follow node array order", () => {
    const graph = g(["a", "x", "y", "z"], [["a", "z"], ["a", "x"], ["a", "y"]]);
    expect(topologicalOrder(graph).order).toEqual(["a", "x", "y", "z"]);
  });

  it("reports nodes in or behind a cycle as unresolved", () => {
    const { order, unresolved } = topologicalOrder(g(["a", "b", "c", "d"], [["a", "b"], ["b", "c"], ["c", "b"], ["c", "d"]]));
    expect(order).toEqual(["a"]);
    expect(unresolved).toEqual(["b", "c", "d"]);
  });

  it("ignores edges that mention unknown nodes", () => {
    expect(topologicalOrder(g(["a", "b"], [["a", "b"], ["a", "ghost"]])).order).toEqual(["a", "b"]);
  });

  it("orders the default template from source to send", () => {
    const { order, unresolved } = topologicalOrder(defaultProspectingDefinition());
    expect(unresolved).toEqual([]);
    expect(order[0]).toBe("source");
    expect(order[order.length - 1]).toBe("send");
    expect(order.indexOf("generate")).toBeGreaterThan(order.indexOf("requalify"));
    expect(order.indexOf("generate")).toBeGreaterThan(order.indexOf("missing"));
  });
});

describe("reachableFrom", () => {
  const graph = g(["a", "b", "c", "d"], [["a", "b"], ["b", "c"]]);

  it("walks forward only", () => {
    expect([...reachableFrom(graph, ["a"])].sort()).toEqual(["a", "b", "c"]);
    expect([...reachableFrom(graph, ["b"])].sort()).toEqual(["b", "c"]);
  });

  it("honours an edge filter", () => {
    expect([...reachableFrom(graph, ["a"], (e) => e.source === "b")].sort()).toEqual(["a", "b"]);
  });

  it("survives cycles", () => {
    expect([...reachableFrom(g(["a", "b"], [["a", "b"], ["b", "a"]]), ["a"])].sort()).toEqual(["a", "b"]);
  });

  it("ignores unknown start ids", () => {
    expect(reachableFrom(graph, ["nope"]).size).toBe(0);
  });
});

describe("parentIds", () => {
  it("returns distinct parents", () => {
    const graph = g(["a", "b", "m"], [["a", "m"], ["b", "m"], ["a", "m"]]);
    expect(parentIds(graph, "m").sort()).toEqual(["a", "b"]);
  });
});

describe("canonicalJson", () => {
  it("is independent of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: 2 } })).toBe(canonicalJson({ a: { c: 2, d: 1 }, b: 1 }));
  });

  it("keeps array order and drops undefined", () => {
    expect(canonicalJson({ a: [2, 1], b: undefined })).toBe('{"a":[2,1]}');
  });

  it("changes when content changes", () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });
});
