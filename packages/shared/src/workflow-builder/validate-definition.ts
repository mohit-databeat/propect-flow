import { WorkflowDefinition, type WorkflowEdge, type WorkflowNodeType } from "./definition.schema";
import { NODE_CATALOG, outputHandleIds } from "./node-catalog";
import { parentIds, reachableFrom, topologicalOrder } from "./graph";

export type ValidationIssueCode =
  | "SCHEMA"
  | "DUPLICATE_NODE_ID"
  | "DUPLICATE_EDGE_ID"
  | "DUPLICATE_EDGE"
  | "EDGE_UNKNOWN_NODE"
  | "EDGE_SELF_LOOP"
  | "EDGE_INVALID_HANDLE"
  | "EDGE_KIND_MISMATCH"
  | "DATA_SOURCE_COUNT"
  | "DATA_SOURCE_HAS_INPUT"
  | "NODE_NO_INPUT"
  | "UNREACHABLE"
  | "BRANCH_NOT_CONNECTED"
  | "MISSING_REQUIRED_STEP"
  | "CYCLE"
  | "SEND_WITHOUT_APPROVAL"
  | "DATA_SOURCE_NOT_FOUND"
  | "CAMPAIGN_NOT_FOUND";

export interface ValidationIssue {
  code: ValidationIssueCode;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

function nodeIdAtPath(input: unknown, path: (string | number)[]): string | undefined {
  if (path[0] !== "nodes" || typeof path[1] !== "number") return undefined;
  const nodes = (input as { nodes?: unknown })?.nodes;
  if (!Array.isArray(nodes)) return undefined;
  const id = (nodes[path[1]] as { id?: unknown } | undefined)?.id;
  return typeof id === "string" ? id : undefined;
}

function edgeIdAtPath(input: unknown, path: (string | number)[]): string | undefined {
  if (path[0] !== "edges" || typeof path[1] !== "number") return undefined;
  const edges = (input as { edges?: unknown })?.edges;
  if (!Array.isArray(edges)) return undefined;
  const id = (edges[path[1]] as { id?: unknown } | undefined)?.id;
  return typeof id === "string" ? id : undefined;
}

function schemaIssues(input: unknown): ValidationIssue[] {
  const parsed = WorkflowDefinition.safeParse(input);
  if (parsed.success) return [];

  const seen = new Set<string>();
  const issues: ValidationIssue[] = [];
  for (const zi of parsed.error.issues) {
    const where = zi.path.length > 0 ? `${zi.path.join(".")}: ` : "";
    const issue: ValidationIssue = { code: "SCHEMA", message: `${where}${zi.message}` };
    const nodeId = nodeIdAtPath(input, zi.path);
    const edgeId = edgeIdAtPath(input, zi.path);
    if (nodeId) issue.nodeId = nodeId;
    if (edgeId) issue.edgeId = edgeId;
    const key = `${issue.nodeId ?? ""}|${issue.edgeId ?? ""}|${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
  }
  return issues;
}

export function validateDefinition(input: unknown): ValidationResult {
  const schema = schemaIssues(input);
  if (schema.length > 0) return { valid: false, issues: schema };

  const def = WorkflowDefinition.parse(input);
  const issues: ValidationIssue[] = [];
  const typeOf = new Map<string, WorkflowNodeType>();

  for (const node of def.nodes) {
    if (typeOf.has(node.id)) {
      issues.push({ code: "DUPLICATE_NODE_ID", nodeId: node.id, message: `Node id "${node.id}" is used more than once` });
      continue;
    }
    typeOf.set(node.id, node.type);
  }

  const edgeIds = new Set<string>();
  const edgeSignatures = new Set<string>();
  const validEdges: WorkflowEdge[] = [];

  for (const edge of def.edges) {
    if (edgeIds.has(edge.id)) {
      issues.push({ code: "DUPLICATE_EDGE_ID", edgeId: edge.id, message: `Edge id "${edge.id}" is used more than once` });
      continue;
    }
    edgeIds.add(edge.id);

    const sourceType = typeOf.get(edge.source);
    const targetType = typeOf.get(edge.target);
    if (!sourceType || !targetType) {
      issues.push({ code: "EDGE_UNKNOWN_NODE", edgeId: edge.id, message: `Edge "${edge.id}" connects to a node that does not exist` });
      continue;
    }
    if (edge.source === edge.target) {
      issues.push({ code: "EDGE_SELF_LOOP", edgeId: edge.id, nodeId: edge.source, message: "A node cannot be connected to itself" });
      continue;
    }

    const signature = `${edge.source}|${edge.sourceHandle}|${edge.target}`;
    if (edgeSignatures.has(signature)) {
      issues.push({ code: "DUPLICATE_EDGE", edgeId: edge.id, message: "These two nodes are already connected through this output" });
      continue;
    }
    edgeSignatures.add(signature);

    const handles = outputHandleIds(sourceType);
    if (!handles.includes(edge.sourceHandle)) {
      const message =
        handles.length === 0
          ? `${NODE_CATALOG[sourceType].label} has no outputs to connect from`
          : `${NODE_CATALOG[sourceType].label} has no output "${edge.sourceHandle}" (expected ${handles.join(" or ")})`;
      issues.push({ code: "EDGE_INVALID_HANDLE", edgeId: edge.id, nodeId: edge.source, message });
      continue;
    }

    const target = NODE_CATALOG[targetType];
    if (target.inputKind === null) {
      issues.push({ code: "DATA_SOURCE_HAS_INPUT", edgeId: edge.id, nodeId: edge.target, message: `${target.label} is a starting node and cannot receive input` });
      continue;
    }
    const sourceKind = NODE_CATALOG[sourceType].outputKind;
    if (sourceKind !== target.inputKind) {
      issues.push({
        code: "EDGE_KIND_MISMATCH",
        edgeId: edge.id,
        nodeId: edge.target,
        message: `${target.label} expects ${target.inputKind} but ${NODE_CATALOG[sourceType].label} produces ${sourceKind}. Add the step that converts them (for example Qualify turns companies into prospects).`,
      });
      continue;
    }

    validEdges.push(edge);
  }

  const dataSources = def.nodes.filter((n) => n.type === "DATA_SOURCE");
  if (dataSources.length !== 1) {
    issues.push({
      code: "DATA_SOURCE_COUNT",
      message: dataSources.length === 0 ? "A workflow needs exactly one Data Source node" : `A workflow can have only one Data Source node (found ${dataSources.length})`,
      ...(dataSources.length > 1 ? { nodeId: dataSources[1]!.id } : {}),
    });
  }

  const graph = { nodes: def.nodes, edges: validEdges };

  for (const node of def.nodes) {
    if (node.type === "DATA_SOURCE") continue;
    if (!validEdges.some((e) => e.target === node.id)) {
      issues.push({ code: "NODE_NO_INPUT", nodeId: node.id, message: `${NODE_CATALOG[node.type].label} has no incoming connection` });
    }
  }

  const { unresolved } = topologicalOrder(graph);
  for (const id of unresolved) {
    issues.push({ code: "CYCLE", nodeId: id, message: "This step is part of a loop, or depends on one. Workflows must flow in one direction." });
  }

  if (dataSources.length === 1) {
    const reachable = reachableFrom(graph, [dataSources[0]!.id]);
    const flagged = new Set(issues.filter((i) => i.nodeId && (i.code === "NODE_NO_INPUT" || i.code === "CYCLE")).map((i) => i.nodeId!));
    for (const node of def.nodes) {
      if (reachable.has(node.id) || flagged.has(node.id)) continue;
      if (parentIds(graph, node.id).length === 0) continue;
      issues.push({ code: "UNREACHABLE", nodeId: node.id, message: `${NODE_CATALOG[node.type].label} cannot be reached from the Data Source` });
    }
  }

  for (const node of def.nodes) {
    for (const handle of NODE_CATALOG[node.type].requiredBranches) {
      if (validEdges.some((e) => e.source === node.id && e.sourceHandle === handle)) continue;
      issues.push({
        code: "BRANCH_NOT_CONNECTED",
        nodeId: node.id,
        message: `The "${handle}" output of ${NODE_CATALOG[node.type].label} is not connected, so those prospects would silently stop here`,
      });
    }
  }

  const roots = def.nodes.filter((n) => !validEdges.some((e) => e.target === n.id)).map((n) => n.id);
  for (const node of def.nodes) {
    const required = NODE_CATALOG[node.type].requiresUpstream;
    if (!required || !validEdges.some((e) => e.target === node.id)) continue;
    const withoutRequired = reachableFrom(graph, roots, (e) => typeOf.get(e.source) === required);
    if (!withoutRequired.has(node.id)) continue;
    issues.push({
      code: "MISSING_REQUIRED_STEP",
      nodeId: node.id,
      message: `Every path to ${NODE_CATALOG[node.type].label} must pass through ${NODE_CATALOG[required].label} first`,
    });
  }

  const withoutApproval = reachableFrom(graph, roots, (e) => typeOf.get(e.source) === "HUMAN_APPROVAL" && e.sourceHandle === "approved");
  for (const node of def.nodes) {
    if (node.type !== "SIMULATED_SEND" || !withoutApproval.has(node.id)) continue;
    if (!validEdges.some((e) => e.target === node.id)) continue;
    issues.push({
      code: "SEND_WITHOUT_APPROVAL",
      nodeId: node.id,
      message: "Every path to Simulated Send must pass through the Approved output of a Human Approval step",
    });
  }

  return { valid: issues.length === 0, issues };
}
