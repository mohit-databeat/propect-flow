import type { WorkflowNodeType } from "./definition.schema";

export type ItemKind = "companies" | "prospects";

export type NodeCategory = "source" | "transform" | "qualification" | "logic" | "enrichment" | "outreach" | "review" | "action";

export interface OutputHandle {
  id: string;
  label: string;
}

export interface NodeCatalogEntry {
  type: WorkflowNodeType;
  label: string;
  description: string;
  category: NodeCategory;
  inputKind: ItemKind | null;
  outputKind: ItemKind | null;
  outputHandles: readonly OutputHandle[];
  defaultConfig: Record<string, unknown>;
  usesLlm: boolean;
  hasSideEffects: boolean;
  requiresUpstream: WorkflowNodeType | null;
  requiredBranches: readonly string[];
}

const OUT: readonly OutputHandle[] = [{ id: "out", label: "Output" }];

export const NODE_CATALOG: Record<WorkflowNodeType, NodeCatalogEntry> = {
  DATA_SOURCE: {
    type: "DATA_SOURCE",
    label: "Data Source",
    description: "Starts the workflow with companies from the project's data sources. Leave the selection empty to use every active source.",
    category: "source",
    inputKind: null,
    outputKind: "companies",
    outputHandles: OUT,
    defaultConfig: { dataSourceIds: [], refresh: false },
    usesLlm: false,
    hasSideEffects: false,
    requiresUpstream: null,
    requiredBranches: [],
  },
  NORMALIZE: {
    type: "NORMALIZE",
    label: "Normalize",
    description: "Maps raw source records onto the canonical company model and merges duplicates.",
    category: "transform",
    inputKind: "companies",
    outputKind: "companies",
    outputHandles: OUT,
    defaultConfig: {},
    usesLlm: false,
    hasSideEffects: false,
    requiresUpstream: null,
    requiredBranches: [],
  },
  QUALIFY: {
    type: "QUALIFY",
    label: "Qualify",
    description: "Scores each company against the project's active ICP using the deterministic criteria.",
    category: "qualification",
    inputKind: "companies",
    outputKind: "prospects",
    outputHandles: OUT,
    defaultConfig: {},
    usesLlm: false,
    hasSideEffects: false,
    requiresUpstream: null,
    requiredBranches: [],
  },
  CONDITION: {
    type: "CONDITION",
    label: "Condition",
    description: "Splits prospects into a true branch and a false branch using one rule.",
    category: "logic",
    inputKind: "prospects",
    outputKind: "prospects",
    outputHandles: [
      { id: "true", label: "True" },
      { id: "false", label: "False" },
    ],
    defaultConfig: { field: "hasMissingFields", operator: "IS_TRUE" },
    usesLlm: false,
    hasSideEffects: false,
    requiresUpstream: null,
    requiredBranches: ["true", "false"],
  },
  ENRICH: {
    type: "ENRICH",
    label: "Enrich",
    description: "Fills missing fields through the workspace's enrichment provider. Skips prospects that already failed a required criterion.",
    category: "enrichment",
    inputKind: "prospects",
    outputKind: "prospects",
    outputHandles: OUT,
    defaultConfig: {},
    usesLlm: false,
    hasSideEffects: true,
    requiresUpstream: null,
    requiredBranches: [],
  },
  REQUALIFY: {
    type: "REQUALIFY",
    label: "Requalify",
    description: "Re-scores prospects after enrichment and runs the AI assessment for qualitative criteria.",
    category: "qualification",
    inputKind: "prospects",
    outputKind: "prospects",
    outputHandles: OUT,
    defaultConfig: {},
    usesLlm: true,
    hasSideEffects: false,
    requiresUpstream: "ENRICH",
    requiredBranches: [],
  },
  GENERATE_EMAIL: {
    type: "GENERATE_EMAIL",
    label: "Generate Email",
    description: "Drafts a personalized email for each qualified prospect that has a contact with an email address.",
    category: "outreach",
    inputKind: "prospects",
    outputKind: "prospects",
    outputHandles: OUT,
    defaultConfig: {},
    usesLlm: true,
    hasSideEffects: true,
    requiresUpstream: null,
    requiredBranches: [],
  },
  AI_QA: {
    type: "AI_QA",
    label: "AI QA",
    description: "Checks each drafted email for fabrication, placeholders, wrong recipient, tone and length.",
    category: "outreach",
    inputKind: "prospects",
    outputKind: "prospects",
    outputHandles: OUT,
    defaultConfig: {},
    usesLlm: true,
    hasSideEffects: true,
    requiresUpstream: "GENERATE_EMAIL",
    requiredBranches: [],
  },
  HUMAN_APPROVAL: {
    type: "HUMAN_APPROVAL",
    label: "Human Approval",
    description: "Pauses the run until a person reviews the drafted emails. Approved emails continue; rejected or unreviewed ones leave through the other output.",
    category: "review",
    inputKind: "prospects",
    outputKind: "prospects",
    outputHandles: [
      { id: "approved", label: "Approved" },
      { id: "rejected", label: "Rejected" },
    ],
    defaultConfig: { requireAllReviewed: true },
    usesLlm: false,
    hasSideEffects: false,
    requiresUpstream: "GENERATE_EMAIL",
    requiredBranches: [],
  },
  SIMULATED_SEND: {
    type: "SIMULATED_SEND",
    label: "Simulated Send",
    description: "Adds approved emails to a campaign and sends them through the simulated outbound provider. If you choose an existing campaign, every sendable email already in it is sent as well.",
    category: "action",
    inputKind: "prospects",
    outputKind: null,
    outputHandles: [],
    defaultConfig: { campaignName: "Workflow campaign" },
    usesLlm: false,
    hasSideEffects: true,
    requiresUpstream: null,
    requiredBranches: [],
  },
};

export const NODE_CATALOG_LIST: readonly NodeCatalogEntry[] = Object.values(NODE_CATALOG);

export function outputHandleIds(type: WorkflowNodeType): string[] {
  return NODE_CATALOG[type].outputHandles.map((h) => h.id);
}
