import { Database, Filter, GitBranch, Layers, Mail, RefreshCw, Send, ShieldCheck, Sparkles, UserCheck, type LucideIcon } from "lucide-react";
import type { NodeCategory, WorkflowNodeType } from "@prospect/shared";

export interface NodeVisual {
  icon: LucideIcon;
  chip: string;
}

export const NODE_VISUALS: Record<WorkflowNodeType, NodeVisual> = {
  DATA_SOURCE: { icon: Database, chip: "bg-violet-100 text-violet-600" },
  NORMALIZE: { icon: Layers, chip: "bg-slate-200 text-slate-600" },
  QUALIFY: { icon: Filter, chip: "bg-emerald-100 text-emerald-600" },
  CONDITION: { icon: GitBranch, chip: "bg-indigo-100 text-indigo-600" },
  ENRICH: { icon: Sparkles, chip: "bg-amber-100 text-amber-600" },
  REQUALIFY: { icon: RefreshCw, chip: "bg-teal-100 text-teal-600" },
  GENERATE_EMAIL: { icon: Mail, chip: "bg-sky-100 text-sky-600" },
  AI_QA: { icon: ShieldCheck, chip: "bg-cyan-100 text-cyan-600" },
  HUMAN_APPROVAL: { icon: UserCheck, chip: "bg-rose-100 text-rose-600" },
  SIMULATED_SEND: { icon: Send, chip: "bg-purple-100 text-purple-600" },
};

export const CATEGORY_LABEL: Record<NodeCategory, string> = {
  source: "Start",
  transform: "Prepare",
  qualification: "Qualify",
  logic: "Branch",
  enrichment: "Enrich",
  outreach: "Email",
  review: "Review",
  action: "Send",
};

export const CATEGORY_ORDER: NodeCategory[] = ["source", "transform", "qualification", "logic", "enrichment", "outreach", "review", "action"];

export const BRANCH_TONE: Record<string, { text: string; bg: string; stroke: string }> = {
  true: { text: "text-emerald-700", bg: "bg-emerald-100", stroke: "#10b981" },
  approved: { text: "text-emerald-700", bg: "bg-emerald-100", stroke: "#10b981" },
  false: { text: "text-red-700", bg: "bg-red-100", stroke: "#ef4444" },
  rejected: { text: "text-red-700", bg: "bg-red-100", stroke: "#ef4444" },
};

export const DEFAULT_EDGE_STROKE = "#94a3b8";

export const DND_MIME = "application/x-workflow-node-type";
