import { MAX_WORKFLOW_EDGES, MAX_WORKFLOW_NODES, type WorkflowDraftDefinition, type WorkflowNodeType } from "./definition.schema";
import { LAYOUT } from "./auto-layout";
import { NODE_CATALOG } from "./node-catalog";

export type DraftNode = WorkflowDraftDefinition["nodes"][number];
export type DraftEdge = WorkflowDraftDefinition["edges"][number];

export interface Connection {
  source: string;
  sourceHandle?: string | null;
  target: string;
}

const PREFIX: Record<WorkflowNodeType, string> = {
  DATA_SOURCE: "source",
  NORMALIZE: "normalize",
  QUALIFY: "qualify",
  CONDITION: "condition",
  ENRICH: "enrich",
  REQUALIFY: "requalify",
  GENERATE_EMAIL: "generate",
  AI_QA: "qa",
  HUMAN_APPROVAL: "approval",
  SIMULATED_SEND: "send",
};

function uniqueId(prefix: string, taken: ReadonlySet<string>): string {
  if (!taken.has(prefix)) return prefix;
  for (let n = 2; ; n++) {
    const candidate = `${prefix}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function addNode(def: WorkflowDraftDefinition, type: WorkflowNodeType, position: { x: number; y: number }): { definition: WorkflowDraftDefinition; nodeId: string } | null {
  if (def.nodes.length >= MAX_WORKFLOW_NODES) return null;
  const nodeId = uniqueId(PREFIX[type], new Set(def.nodes.map((n) => n.id)));
  const node: DraftNode = { id: nodeId, type, position: { x: Math.round(position.x), y: Math.round(position.y) }, config: structuredClone(NODE_CATALOG[type].defaultConfig) };
  return { definition: { ...def, nodes: [...def.nodes, node] }, nodeId };
}

export function removeNode(def: WorkflowDraftDefinition, nodeId: string): WorkflowDraftDefinition {
  return {
    ...def,
    nodes: def.nodes.filter((n) => n.id !== nodeId),
    edges: def.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
  };
}

export function moveNode(def: WorkflowDraftDefinition, nodeId: string, position: { x: number; y: number }): WorkflowDraftDefinition {
  return { ...def, nodes: def.nodes.map((n) => (n.id === nodeId ? { ...n, position: { x: Math.round(position.x), y: Math.round(position.y) } } : n)) };
}

export function renameNode(def: WorkflowDraftDefinition, nodeId: string, label: string): WorkflowDraftDefinition {
  const trimmed = label.trim();
  return {
    ...def,
    nodes: def.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const { label: _old, ...rest } = n;
      return trimmed ? { ...rest, label: trimmed.slice(0, 80) } : rest;
    }),
  };
}

export function setNodeConfig(def: WorkflowDraftDefinition, nodeId: string, config: Record<string, unknown>): WorkflowDraftDefinition {
  return { ...def, nodes: def.nodes.map((n) => (n.id === nodeId ? { ...n, config } : n)) };
}

export type ConnectResult = { ok: true; definition: WorkflowDraftDefinition; edgeId: string } | { ok: false; reason: string };

export function connect(def: WorkflowDraftDefinition, c: Connection): ConnectResult {
  const source = def.nodes.find((n) => n.id === c.source);
  const target = def.nodes.find((n) => n.id === c.target);
  if (!source || !target) return { ok: false, reason: "Both ends of a connection must exist" };
  if (source.id === target.id) return { ok: false, reason: "A step cannot be connected to itself" };

  const handles = NODE_CATALOG[source.type].outputHandles;
  if (handles.length === 0) return { ok: false, reason: `${NODE_CATALOG[source.type].label} has no outputs` };
  const handle = c.sourceHandle ?? handles[0]!.id;
  if (!handles.some((h) => h.id === handle)) return { ok: false, reason: `${NODE_CATALOG[source.type].label} has no "${handle}" output` };

  const targetEntry = NODE_CATALOG[target.type];
  if (targetEntry.inputKind === null) return { ok: false, reason: `${targetEntry.label} starts the workflow and cannot receive input` };
  if (NODE_CATALOG[source.type].outputKind !== targetEntry.inputKind) {
    return { ok: false, reason: `${targetEntry.label} needs ${targetEntry.inputKind} but ${NODE_CATALOG[source.type].label} produces ${NODE_CATALOG[source.type].outputKind}` };
  }
  if (def.edges.some((e) => e.source === c.source && e.sourceHandle === handle && e.target === c.target)) return { ok: false, reason: "These steps are already connected this way" };
  if (def.edges.length >= MAX_WORKFLOW_EDGES) return { ok: false, reason: "This workflow has reached the connection limit" };

  const edgeId = uniqueId(`${c.source}-${handle}-${c.target}`, new Set(def.edges.map((e) => e.id)));
  return { ok: true, definition: { ...def, edges: [...def.edges, { id: edgeId, source: c.source, sourceHandle: handle, target: c.target }] }, edgeId };
}

export function disconnect(def: WorkflowDraftDefinition, edgeId: string): WorkflowDraftDefinition {
  return { ...def, edges: def.edges.filter((e) => e.id !== edgeId) };
}

export function applyEdgeChanges(def: WorkflowDraftDefinition, removedIds: readonly string[]): WorkflowDraftDefinition {
  if (removedIds.length === 0) return def;
  const gone = new Set(removedIds);
  return { ...def, edges: def.edges.filter((e) => !gone.has(e.id)) };
}

export function nextFreePosition(def: WorkflowDraftDefinition, afterNodeId?: string | null): { x: number; y: number } {
  const step = LAYOUT.rowHeight;
  if (def.nodes.length === 0) return { x: 0, y: 0 };
  const anchor = (afterNodeId ? def.nodes.find((n) => n.id === afterNodeId) : undefined) ?? def.nodes.reduce((lowest, n) => (n.position.y > lowest.position.y ? n : lowest));
  let candidate = { x: anchor.position.x, y: anchor.position.y + step };
  while (def.nodes.some((n) => Math.abs(n.position.x - candidate.x) < LAYOUT.nodeWidth && Math.abs(n.position.y - candidate.y) < step * 0.6)) {
    candidate = { x: candidate.x + LAYOUT.nodeWidth + LAYOUT.columnGap, y: candidate.y };
  }
  return candidate;
}
