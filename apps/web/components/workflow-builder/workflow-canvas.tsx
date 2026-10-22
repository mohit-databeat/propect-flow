"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, type DragEvent } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection as FlowConnection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  LAYOUT,
  NODE_CATALOG,
  NODE_CONFIG_SCHEMAS,
  WORKFLOW_NODE_TYPES,
  applyEdgeChanges,
  connect,
  moveNode,
  removeNode,
  type ValidationIssue,
  type WorkflowDraftDefinition,
  type WorkflowNodeRunStatus,
  type WorkflowNodeType,
} from "@prospect/shared";
import { BRANCH_TONE, CATEGORY_LABEL, DEFAULT_EDGE_STROKE, DND_MIME, NODE_VISUALS } from "./node-visuals";
import { nodeStatusBorder, nodeStatusLabel } from "./status";

export interface NodeDecoration {
  status?: WorkflowNodeRunStatus;
  detail?: string;
}

interface CardData extends Record<string, unknown> {
  type: WorkflowNodeType;
  title: string;
  status?: WorkflowNodeRunStatus;
  detail?: string;
  needsSetup: boolean;
  issueCount: number;
}

type CardNode = Node<CardData, "workflow">;

const HANDLE_CLASS = "!h-3 !w-3 !border-2 !border-white !bg-brand-500";

function WorkflowNodeCard({ data, selected }: NodeProps<CardNode>) {
  const entry = NODE_CATALOG[data.type];
  const visual = NODE_VISUALS[data.type];
  const Icon = visual.icon;
  const handles = entry.outputHandles;
  const border = data.status ? nodeStatusBorder[data.status] : data.issueCount > 0 ? "border-red-400" : "border-slate-200";
  const subtitle = data.title === entry.label ? CATEGORY_LABEL[entry.category] : entry.label;

  return (
    <div
      className={`relative w-[260px] rounded-xl border bg-white px-3 pt-2.5 shadow-md ${handles.length > 1 ? "pb-0" : "pb-2.5"} ${border} ${selected ? "ring-2 ring-brand-500" : ""} ${data.status === "RUNNING" ? "animate-pulse" : ""}`}
    >
      {entry.inputKind ? <Handle type="target" position={Position.Top} className={HANDLE_CLASS} aria-label={`${entry.label} input`} /> : null}

      <div className="flex items-center gap-2.5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${visual.chip}`}>
          <Icon size={17} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-900">{data.title}</div>
          <div className="truncate text-[11px] text-slate-500">{subtitle}</div>
        </div>
        {data.status ? <span className="shrink-0 text-[11px] font-medium text-slate-600">{nodeStatusLabel[data.status]}</span> : null}
      </div>

      {data.needsSetup ? (
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800">Needs setup</div>
      ) : data.detail ? (
        <div className="mt-2 truncate rounded-md bg-slate-50 px-2 py-1 text-[11px] text-slate-600">{data.detail}</div>
      ) : null}
      {data.issueCount > 0 ? (
        <div className="mt-1.5 text-[11px] font-medium text-red-600">
          {data.issueCount} problem{data.issueCount === 1 ? "" : "s"}
        </div>
      ) : null}

      {handles.length === 1 ? <Handle type="source" id={handles[0]!.id} position={Position.Bottom} className={HANDLE_CLASS} aria-label={`${entry.label} output`} /> : null}
      {handles.length > 1 ? (
        <>
          <div className="-mx-3 mt-2.5 grid overflow-hidden rounded-b-xl text-center text-[11px] font-semibold" style={{ gridTemplateColumns: `repeat(${handles.length}, 1fr)` }}>
            {handles.map((h) => {
              const tone = BRANCH_TONE[h.id];
              return (
                <div key={h.id} className={`py-1 ${tone?.bg ?? "bg-slate-100"} ${tone?.text ?? "text-slate-600"}`}>
                  {h.label}
                </div>
              );
            })}
          </div>
          {handles.map((h, i) => (
            <Handle
              key={h.id}
              type="source"
              id={h.id}
              position={Position.Bottom}
              className={HANDLE_CLASS}
              style={{ left: `${((i + 0.5) / handles.length) * 100}%` }}
              aria-label={`${entry.label} ${h.label} output`}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

const nodeTypes = { workflow: WorkflowNodeCard };
const NO_ISSUES: readonly ValidationIssue[] = [];

function summarize(type: WorkflowNodeType, config: Record<string, unknown>): string | undefined {
  if (type === "CONDITION") {
    const value = config.value === undefined ? "" : ` ${Array.isArray(config.value) ? config.value.join(", ") : String(config.value)}`;
    return `${String(config.field ?? "?")} ${String(config.operator ?? "?")}${value}`;
  }
  if (type === "DATA_SOURCE") {
    const ids = Array.isArray(config.dataSourceIds) ? config.dataSourceIds.length : 0;
    return ids === 0 ? "All data sources" : `${ids} data source${ids === 1 ? "" : "s"}`;
  }
  if (type === "SIMULATED_SEND") return typeof config.campaignName === "string" ? config.campaignName : config.campaignId ? "Existing campaign" : undefined;
  if (type === "HUMAN_APPROVAL") return config.requireAllReviewed === false ? "Partial review allowed" : "Every email needs a decision";
  return undefined;
}

export function nodeTitle(node: WorkflowDraftDefinition["nodes"][number]): string {
  return node.label ?? NODE_CATALOG[node.type].label;
}

export function topFitOptions(definition: WorkflowDraftDefinition, focusIds?: readonly string[]) {
  if (definition.nodes.length === 0) return { padding: 0.2, maxZoom: 1 };
  if (focusIds && focusIds.length > 0) {
    const wanted = new Set(focusIds);
    for (const e of definition.edges) {
      if (wanted.has(e.source)) wanted.add(e.target);
      if (wanted.has(e.target)) wanted.add(e.source);
    }
    return { nodes: [...wanted].map((id) => ({ id })), padding: 0.25, minZoom: 0.45, maxZoom: 0.95 };
  }
  const minY = Math.min(...definition.nodes.map((n) => n.position.y));
  const top = definition.nodes.filter((n) => n.position.y <= minY + LAYOUT.rowHeight * 3.2);
  return { nodes: top.map((n) => ({ id: n.id })), padding: 0.25, minZoom: 0.45, maxZoom: 0.95 };
}

interface Props {
  definition: WorkflowDraftDefinition;
  readOnly?: boolean;
  selectedId: string | null;
  issues?: readonly ValidationIssue[];
  decorations?: ReadonlyMap<string, NodeDecoration>;
  fitKey?: number;
  focusNodeIds?: readonly string[];
  className?: string;
  onSelect: (nodeId: string | null) => void;
  onChange?: (definition: WorkflowDraftDefinition) => void;
  onRejected?: (reason: string) => void;
  onDropNode?: (type: WorkflowNodeType, position: { x: number; y: number }) => void;
}

function CanvasInner({ definition, readOnly = false, selectedId, issues = NO_ISSUES, decorations, fitKey, focusNodeIds, className = "h-[560px]", onSelect, onChange, onRejected, onDropNode }: Props) {
  const rf = useReactFlow();

  const issueCountByNode = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of issues) if (issue.nodeId) counts.set(issue.nodeId, (counts.get(issue.nodeId) ?? 0) + 1);
    return counts;
  }, [issues]);
  const badEdges = useMemo(() => new Set(issues.flatMap((i) => (i.edgeId ? [i.edgeId] : []))), [issues]);

  const flowNodes = useMemo<CardNode[]>(
    () =>
      definition.nodes.map((n) => ({
        id: n.id,
        type: "workflow",
        position: n.position,
        selected: n.id === selectedId,
        draggable: !readOnly,
        data: {
          type: n.type,
          title: nodeTitle(n),
          status: decorations?.get(n.id)?.status,
          detail: decorations?.get(n.id)?.detail ?? summarize(n.type, n.config),
          needsSetup: !decorations && !NODE_CONFIG_SCHEMAS[n.type].safeParse(n.config).success,
          issueCount: issueCountByNode.get(n.id) ?? 0,
        },
      })),
    [definition.nodes, selectedId, readOnly, decorations, issueCountByNode],
  );

  const flowEdges = useMemo<Edge[]>(() => {
    const typeOf = new Map(definition.nodes.map((n) => [n.id, n.type]));
    return definition.edges.map((e) => {
      const sourceType = typeOf.get(e.source);
      const handles = sourceType ? NODE_CATALOG[sourceType].outputHandles : [];
      const branched = handles.length > 1;
      const tone = branched ? BRANCH_TONE[e.sourceHandle] : undefined;
      const stroke = badEdges.has(e.id) ? "#dc2626" : (tone?.stroke ?? DEFAULT_EDGE_STROKE);
      return {
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle,
        target: e.target,
        type: "smoothstep",
        label: branched ? handles.find((h) => h.id === e.sourceHandle)?.label : undefined,
        labelStyle: { fill: "#ffffff", fontWeight: 600, fontSize: 11 },
        labelBgStyle: { fill: stroke },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 8,
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
        style: { stroke, strokeWidth: 2 },
        deletable: !readOnly,
      };
    });
  }, [definition.nodes, definition.edges, badEdges, readOnly]);

  const [nodes, setNodes, onNodesChange] = useNodesState<CardNode>(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(flowEdges);

  useEffect(() => setNodes(flowNodes), [flowNodes, setNodes]);
  useEffect(() => setEdges(flowEdges), [flowEdges, setEdges]);

  const initialFit = useMemo(() => topFitOptions(definition, focusNodeIds), []);

  useEffect(() => {
    if (fitKey === undefined) return;
    const frame = requestAnimationFrame(() => void rf.fitView({ ...topFitOptions(definition), duration: 250 }));
    return () => cancelAnimationFrame(frame);
  }, [fitKey]);

  const attempt = useCallback(
    (c: { source: string; sourceHandle?: string | null; target: string }) => connect(definition, { source: c.source, sourceHandle: c.sourceHandle, target: c.target }),
    [definition],
  );

  const onConnect = useCallback(
    (c: FlowConnection) => {
      const result = attempt(c);
      if (result.ok) onChange?.(result.definition);
      else onRejected?.(result.reason);
    },
    [attempt, onChange, onRejected],
  );

  const onDelete = useCallback(
    ({ nodes: removedNodes, edges: removedEdges }: { nodes: Node[]; edges: Edge[] }) => {
      let next = definition;
      for (const n of removedNodes) next = removeNode(next, n.id);
      next = applyEdgeChanges(next, removedEdges.map((e) => e.id));
      onChange?.(next);
      if (removedNodes.some((n) => n.id === selectedId)) onSelect(null);
    },
    [definition, onChange, onSelect, selectedId],
  );

  const onDragOver = (event: DragEvent) => {
    if (readOnly || !onDropNode) return;
    if (!event.dataTransfer.types.includes(DND_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const onDrop = (event: DragEvent) => {
    if (readOnly || !onDropNode) return;
    const type = event.dataTransfer.getData(DND_MIME);
    if (!(WORKFLOW_NODE_TYPES as readonly string[]).includes(type)) return;
    event.preventDefault();
    const at = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    onDropNode(type as WorkflowNodeType, { x: at.x - 130, y: at.y - 40 });
  };

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 ${className}`}
      role="application"
      aria-label="Workflow canvas. A list view with the same controls is available below the canvas."
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-testid="workflow-canvas"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        onNodeDragStop={readOnly ? undefined : (_, node) => onChange?.(moveNode(definition, node.id, node.position))}
        onConnect={readOnly ? undefined : onConnect}
        isValidConnection={readOnly ? undefined : (c) => attempt(c).ok}
        onDelete={readOnly ? undefined : onDelete}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable
        deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
        fitView
        fitViewOptions={initialFit}
        minZoom={0.15}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="#cbd5e1" />
        <Controls showInteractive={false} fitViewOptions={{ padding: 0.15, minZoom: 0.1 }} />
      </ReactFlow>
      {definition.nodes.length === 0 && !readOnly ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="max-w-xs rounded-lg bg-white/90 px-4 py-3 text-sm text-slate-600 shadow-sm">
            Drag a step from the left onto the canvas, or click one to add it. Start with a Data Source.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function WorkflowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
