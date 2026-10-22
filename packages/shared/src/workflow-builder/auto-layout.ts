import type { WorkflowDraftDefinition, WorkflowNodeType } from "./definition.schema";
import { topologicalOrder } from "./graph";
import { NODE_CATALOG } from "./node-catalog";

export const LAYOUT = {
  nodeWidth: 260,
  columnGap: 70,
  rowHeight: 175,
} as const;

export interface LayoutOptions {
  originX?: number;
  originY?: number;
}

type Draft = WorkflowDraftDefinition;

function handleOffset(type: WorkflowNodeType, handleId: string | undefined): number {
  const handles = NODE_CATALOG[type].outputHandles;
  if (handles.length <= 1) return 0;
  const index = Math.max(0, handles.findIndex((h) => h.id === handleId));
  return (index - (handles.length - 1) / 2) * ((LAYOUT.nodeWidth + LAYOUT.columnGap) / 2);
}

export function autoLayout(def: Draft, options: LayoutOptions = {}): Draft {
  if (def.nodes.length === 0) return def;
  const spacing = LAYOUT.nodeWidth + LAYOUT.columnGap;
  const ids = new Set(def.nodes.map((n) => n.id));
  const edges = def.edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);
  const typeOf = new Map(def.nodes.map((n) => [n.id, n.type]));
  const arrayIndex = new Map(def.nodes.map((n, i) => [n.id, i]));

  const touched = new Set(edges.flatMap((e) => [e.source, e.target]));
  const connected = def.nodes.filter((n) => touched.has(n.id));
  const loose = def.nodes.filter((n) => !touched.has(n.id));

  const { order, unresolved } = topologicalOrder({ nodes: connected, edges });
  const sequence = [...order, ...unresolved];

  const level = new Map<string, number>();
  for (const id of sequence) {
    const parents = edges.filter((e) => e.target === id && level.has(e.source));
    level.set(id, parents.length === 0 ? 0 : Math.max(...parents.map((e) => level.get(e.source)! + 1)));
  }

  const x = new Map<string, number>();
  const maxLevel = level.size === 0 ? -1 : Math.max(...level.values());
  for (let l = 0; l <= maxLevel; l++) {
    const inLayer = sequence.filter((id) => level.get(id) === l);

    const preferred = new Map<string, number>();
    inLayer.forEach((id, i) => {
      const incoming = edges.filter((e) => e.target === id && x.has(e.source));
      if (incoming.length === 0) {
        preferred.set(id, i * spacing);
        return;
      }
      const total = incoming.reduce((sum, e) => sum + x.get(e.source)! + handleOffset(typeOf.get(e.source)!, e.sourceHandle), 0);
      preferred.set(id, total / incoming.length);
    });

    const ordered = [...inLayer].sort((a, b) => preferred.get(a)! - preferred.get(b)! || arrayIndex.get(a)! - arrayIndex.get(b)!);
    const placed: number[] = [];
    ordered.forEach((id, i) => {
      const want = preferred.get(id)!;
      placed.push(i === 0 ? want : Math.max(want, placed[i - 1]! + spacing));
    });
    const shift = ordered.reduce((sum, id, i) => sum + (preferred.get(id)! - placed[i]!), 0) / ordered.length;
    ordered.forEach((id, i) => x.set(id, placed[i]! + shift));
  }

  const minX = x.size === 0 ? 0 : Math.min(...x.values());
  const maxX = x.size === 0 ? 0 : Math.max(...x.values());
  const originX = options.originX ?? 0;
  const originY = options.originY ?? 0;
  const looseX = x.size === 0 ? 0 : maxX - minX + spacing;
  const looseIndex = new Map(loose.map((n, i) => [n.id, i]));

  return {
    ...def,
    nodes: def.nodes.map((n) => {
      if (looseIndex.has(n.id)) return { ...n, position: { x: Math.round(originX + looseX), y: Math.round(originY + looseIndex.get(n.id)! * LAYOUT.rowHeight) } };
      return { ...n, position: { x: Math.round(originX + x.get(n.id)! - minX), y: Math.round(originY + (level.get(n.id) ?? 0) * LAYOUT.rowHeight) } };
    }),
  };
}
