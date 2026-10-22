import { z } from "zod";

export const WORKFLOW_SCHEMA_VERSION = 1;
export const MAX_WORKFLOW_NODES = 50;
export const MAX_WORKFLOW_EDGES = 100;

export const WORKFLOW_NODE_TYPES = [
  "DATA_SOURCE",
  "NORMALIZE",
  "QUALIFY",
  "CONDITION",
  "ENRICH",
  "REQUALIFY",
  "GENERATE_EMAIL",
  "AI_QA",
  "HUMAN_APPROVAL",
  "SIMULATED_SEND",
] as const;
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

export const CONDITION_FIELDS = ["status", "score", "coverage", "hasMissingFields", "hasRequiredFail", "qaStatus"] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const CONDITION_OPERATORS = ["EQ", "NEQ", "IN", "GTE", "LTE", "IS_TRUE", "IS_FALSE"] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export interface ConditionFieldRule {
  operators: readonly ConditionOperator[];
  kind: "enum" | "number" | "boolean";
  values?: readonly string[];
}

export const CONDITION_FIELD_RULES: Record<ConditionField, ConditionFieldRule> = {
  status: { operators: ["EQ", "NEQ", "IN"], kind: "enum", values: ["PENDING", "QUALIFIED", "DISQUALIFIED", "NEEDS_REVIEW"] },
  qaStatus: { operators: ["EQ", "NEQ", "IN"], kind: "enum", values: ["PENDING", "PASS", "WARN", "FAIL"] },
  score: { operators: ["EQ", "GTE", "LTE"], kind: "number" },
  coverage: { operators: ["EQ", "GTE", "LTE"], kind: "number" },
  hasMissingFields: { operators: ["IS_TRUE", "IS_FALSE"], kind: "boolean" },
  hasRequiredFail: { operators: ["IS_TRUE", "IS_FALSE"], kind: "boolean" },
};

const Identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Must be 1-64 characters: letters, digits, underscore or hyphen");
const Label = z.string().trim().min(1).max(80).optional();
const Position = z
  .object({
    x: z.number().finite().min(-100_000).max(100_000),
    y: z.number().finite().min(-100_000).max(100_000),
  })
  .strict();

const EmptyConfig = z.object({}).strict();

export const DataSourceNodeConfig = z
  .object({
    dataSourceIds: z.array(z.string().uuid()).max(20).default([]),
    refresh: z.boolean().default(false),
  })
  .strict();
export type DataSourceNodeConfig = z.infer<typeof DataSourceNodeConfig>;

export const ConditionNodeConfig = z
  .object({
    field: z.enum(CONDITION_FIELDS),
    operator: z.enum(CONDITION_OPERATORS),
    value: z.union([z.string().max(64), z.number().finite(), z.array(z.string().max(64)).min(1).max(10)]).optional(),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const rule = CONDITION_FIELD_RULES[cfg.field];
    if (!rule.operators.includes(cfg.operator)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["operator"], message: `Operator ${cfg.operator} is not valid for field ${cfg.field}` });
      return;
    }
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message });

    if (rule.kind === "boolean") {
      if (cfg.value !== undefined) fail(`Field ${cfg.field} takes no value`);
      return;
    }
    if (cfg.value === undefined) {
      fail("A value is required");
      return;
    }
    if (rule.kind === "number") {
      if (typeof cfg.value !== "number" || cfg.value < 0 || cfg.value > 100) fail("Value must be a number between 0 and 100");
      return;
    }
    const allowed = rule.values ?? [];
    if (cfg.operator === "IN") {
      if (!Array.isArray(cfg.value) || cfg.value.some((v) => !allowed.includes(v))) fail(`Value must be a list drawn from: ${allowed.join(", ")}`);
      return;
    }
    if (typeof cfg.value !== "string" || !allowed.includes(cfg.value)) fail(`Value must be one of: ${allowed.join(", ")}`);
  });
export type ConditionNodeConfig = z.infer<typeof ConditionNodeConfig>;

export const HumanApprovalNodeConfig = z.object({ requireAllReviewed: z.boolean().default(true) }).strict();
export type HumanApprovalNodeConfig = z.infer<typeof HumanApprovalNodeConfig>;

export const SimulatedSendNodeConfig = z
  .object({
    campaignId: z.string().uuid().optional(),
    campaignName: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine((c) => (c.campaignId === undefined) !== (c.campaignName === undefined), {
    message: "Provide either an existing campaign or a new campaign name, not both",
  });
export type SimulatedSendNodeConfig = z.infer<typeof SimulatedSendNodeConfig>;

export const NODE_CONFIG_SCHEMAS = {
  DATA_SOURCE: DataSourceNodeConfig,
  NORMALIZE: EmptyConfig,
  QUALIFY: EmptyConfig,
  CONDITION: ConditionNodeConfig,
  ENRICH: EmptyConfig,
  REQUALIFY: EmptyConfig,
  GENERATE_EMAIL: EmptyConfig,
  AI_QA: EmptyConfig,
  HUMAN_APPROVAL: HumanApprovalNodeConfig,
  SIMULATED_SEND: SimulatedSendNodeConfig,
} as const satisfies Record<WorkflowNodeType, z.ZodTypeAny>;

const nodeOf = <T extends WorkflowNodeType, C extends z.ZodTypeAny>(type: T, config: C) =>
  z.object({ id: Identifier, type: z.literal(type), label: Label, position: Position, config }).strict();

export const WorkflowNode = z.discriminatedUnion("type", [
  nodeOf("DATA_SOURCE", DataSourceNodeConfig),
  nodeOf("NORMALIZE", EmptyConfig),
  nodeOf("QUALIFY", EmptyConfig),
  nodeOf("CONDITION", ConditionNodeConfig),
  nodeOf("ENRICH", EmptyConfig),
  nodeOf("REQUALIFY", EmptyConfig),
  nodeOf("GENERATE_EMAIL", EmptyConfig),
  nodeOf("AI_QA", EmptyConfig),
  nodeOf("HUMAN_APPROVAL", HumanApprovalNodeConfig),
  nodeOf("SIMULATED_SEND", SimulatedSendNodeConfig),
]);
export type WorkflowNode = z.infer<typeof WorkflowNode>;

export const WorkflowEdge = z
  .object({
    id: Identifier,
    source: Identifier,
    sourceHandle: z.string().min(1).max(32).default("out"),
    target: Identifier,
  })
  .strict();
export type WorkflowEdge = z.infer<typeof WorkflowEdge>;

export const WorkflowDefinition = z
  .object({
    schemaVersion: z.literal(WORKFLOW_SCHEMA_VERSION),
    nodes: z.array(WorkflowNode).max(MAX_WORKFLOW_NODES),
    edges: z.array(WorkflowEdge).max(MAX_WORKFLOW_EDGES),
  })
  .strict();
export type WorkflowDefinition = z.infer<typeof WorkflowDefinition>;
export type WorkflowDefinitionInput = z.input<typeof WorkflowDefinition>;

export const WorkflowDraftNode = z
  .object({
    id: Identifier,
    type: z.enum(WORKFLOW_NODE_TYPES),
    label: Label,
    position: Position,
    config: z.record(z.unknown()),
  })
  .strict();

export const WorkflowDraftDefinition = z
  .object({
    schemaVersion: z.literal(WORKFLOW_SCHEMA_VERSION),
    nodes: z.array(WorkflowDraftNode).max(MAX_WORKFLOW_NODES),
    edges: z.array(WorkflowEdge).max(MAX_WORKFLOW_EDGES),
  })
  .strict();
export type WorkflowDraftDefinition = z.infer<typeof WorkflowDraftDefinition>;
