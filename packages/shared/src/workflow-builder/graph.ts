export interface GraphNode {
  id: string;
}

export interface GraphEdge {
  id?: string;
  source: string;
  sourceHandle?: string;
  target: string;
}

export interface GraphLike {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
}

export function incomingEdges<E extends GraphEdge>(edges: readonly E[], nodeId: string): E[] {
  return edges.filter((e) => e.target === nodeId);
}

export function outgoingEdges<E extends GraphEdge>(edges: readonly E[], nodeId: string): E[] {
  return edges.filter((e) => e.source === nodeId);
}

export function parentIds(graph: GraphLike, nodeId: string): string[] {
  return [...new Set(incomingEdges(graph.edges, nodeId).map((e) => e.source))];
}

export function topologicalOrder(graph: GraphLike): { order: string[]; unresolved: string[] } {
  const known = new Set(graph.nodes.map((n) => n.id));
  const indegree = new Map<string, number>(graph.nodes.map((n) => [n.id, 0]));
  const children = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]));

  for (const e of graph.edges) {
    if (!known.has(e.source) || !known.has(e.target)) continue;
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
    children.get(e.source)!.push(e.target);
  }

  const position = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const byPosition = (a: string, b: string) => position.get(a)! - position.get(b)!;

  const ready = graph.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  const order: string[] = [];

  while (ready.length > 0) {
    ready.sort(byPosition);
    const id = ready.shift()!;
    order.push(id);
    for (const child of children.get(id)!) {
      const remaining = indegree.get(child)! - 1;
      indegree.set(child, remaining);
      if (remaining === 0) ready.push(child);
    }
  }

  const placed = new Set(order);
  return { order, unresolved: graph.nodes.map((n) => n.id).filter((id) => !placed.has(id)) };
}

export function reachableFrom(graph: GraphLike, startIds: readonly string[], skipEdge?: (edge: GraphEdge) => boolean): Set<string> {
  const known = new Set(graph.nodes.map((n) => n.id));
  const seen = new Set<string>();
  const stack = startIds.filter((id) => known.has(id));

  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of graph.edges) {
      if (e.source !== id || !known.has(e.target) || seen.has(e.target)) continue;
      if (skipEdge?.(e)) continue;
      stack.push(e.target);
    }
  }
  return seen;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}
