import { z } from "zod";

export const CanonicalFieldPath = z.enum([
  "identity.name",
  "identity.domain",
  "firmographics.industry",
  "firmographics.subIndustry",
  "firmographics.description",
  "firmographics.country",
  "firmographics.hqCity",
  "firmographics.hqState",
  "firmographics.employeeCount",
  "firmographics.employeeRange",
  "firmographics.revenueUsd",
  "firmographics.revenueRange",
  "firmographics.foundedYear",
  "firmographics.fundingStage",
  "firmographics.totalFundingUsd",
  "firmographics.lastFundingDate",
  "technographics.stack",
  "signals.hiring",
  "signals.funding",
  "signals.news",
  "signals.expansion",
]);
export type CanonicalFieldPath = z.infer<typeof CanonicalFieldPath>;

export const Pct = z.number().int().min(0).max(100);

const CriterionBase = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/, "criterion id must be a lowercase slug"),
  label: z.string().min(1),
  weight: z.number().int().min(0).max(10).default(5),
  required: z.boolean().default(false),
  enrichIfMissing: z.boolean().default(true),
});

export const RangeValue = z
  .object({ min: z.number().optional(), max: z.number().optional() })
  .refine((v) => v.min !== undefined || v.max !== undefined, "min or max required");

const det = <O extends string, V extends z.ZodTypeAny>(operator: O, value: V) =>
  CriterionBase.extend({
    kind: z.literal("DETERMINISTIC"),
    field: CanonicalFieldPath,
    operator: z.literal(operator),
    value,
  });

const ScalarValue = z.union([z.string(), z.number(), z.boolean()]);

export const DeterministicCriterion = z.discriminatedUnion("operator", [
  det("EQ", ScalarValue),
  det("NEQ", ScalarValue),
  det("IN", z.array(z.string()).min(1)),
  det("NOT_IN", z.array(z.string()).min(1)),
  det("GTE", z.number()),
  det("LTE", z.number()),
  det("BETWEEN", RangeValue),
  det("CONTAINS_ANY", z.array(z.string()).min(1)),
  det("CONTAINS_ALL", z.array(z.string()).min(1)),
  det("EXISTS", z.literal(true)),
]);
export type DeterministicCriterion = z.infer<typeof DeterministicCriterion>;
export type DeterministicOperator = DeterministicCriterion["operator"];

export const QualitativeCriterion = CriterionBase.extend({
  kind: z.literal("QUALITATIVE"),
  operator: z.literal("LLM_ASSESS"),
  question: z.string().min(10),
  passRubric: z.string().min(10),
  failRubric: z.string().optional(),
  evidenceFields: z.array(CanonicalFieldPath).min(1),
  requiredEvidenceFields: z.array(CanonicalFieldPath).min(1),
  minConfidence: Pct.default(60),
  recencyDays: z.number().int().positive().optional(),
}).refine(
  (c) => c.requiredEvidenceFields.every((f) => c.evidenceFields.includes(f)),
  "requiredEvidenceFields must be a subset of evidenceFields",
);
export type QualitativeCriterion = z.infer<typeof QualitativeCriterion>;

export const IcpCriterion = z.union([DeterministicCriterion, QualitativeCriterion]);
export type IcpCriterion = z.infer<typeof IcpCriterion>;

export const ScoringPolicy = z
  .object({
    qualifiedThreshold: Pct.default(70),
    needsReviewThreshold: Pct.default(40),
    minCoverage: Pct.default(60),
    unknownRequiredPolicy: z.enum(["NEEDS_REVIEW", "DISQUALIFY"]).default("NEEDS_REVIEW"),
  })
  .refine((s) => s.needsReviewThreshold < s.qualifiedThreshold, "needsReviewThreshold must be below qualifiedThreshold");
export type ScoringPolicy = z.infer<typeof ScoringPolicy>;

export const ClarificationType = z.enum([
  "ambiguous_scope",
  "numeric_bound",
  "required_or_soft",
  "recency_window",
  "geo_scope",
  "industry_scope",
  "technology_scope",
  "unsupported_field",
  "other",
]);
export type ClarificationType = z.infer<typeof ClarificationType>;

export const ClarificationSeverity = z.enum(["BLOCKING", "MINOR"]);
export const ClarificationResolvedBy = z.enum(["USER", "DEFAULT", "UNRESOLVED"]);

export const clarificationId = (c: { criterionId?: string | undefined; type: string }): string =>
  `clar:${c.criterionId ?? "general"}:${c.type}`;

export const Clarification = z
  .object({
    id: z.string().regex(/^clar:[a-z0-9_]+:[a-z_]+$/, "clarification id must be clar:<criterionId|general>:<type>"),
    criterionId: z.string().regex(/^[a-z0-9_]+$/).optional(),
    type: ClarificationType,
    question: z.string().min(1),
    severity: ClarificationSeverity,
    answer: z.string().nullable(),
    proposedDefault: z.string().optional(),
    resolvedBy: ClarificationResolvedBy,
  })
  .superRefine((c, ctx) => {
    if (c.id !== clarificationId(c)) {
      ctx.addIssue({ code: "custom", path: ["id"], message: "clarification id must equal clar:<criterionId|general>:<type>" });
    }
    if (c.resolvedBy === "USER" && !c.answer?.trim()) {
      ctx.addIssue({ code: "custom", path: ["answer"], message: "user-resolved clarification requires an answer" });
    }
    if (c.resolvedBy === "DEFAULT" && !c.proposedDefault?.trim()) {
      ctx.addIssue({ code: "custom", path: ["proposedDefault"], message: "default-resolved clarification requires a proposed default" });
    }
  });
export type Clarification = z.infer<typeof Clarification>;

export const TargetPersona = z.object({
  title: z.string().min(1),
  seniority: z.string().optional(),
  department: z.string().optional(),
});
export type TargetPersona = z.infer<typeof TargetPersona>;

const uniqueClarificationIds = (icp: { clarifications: { id: string }[] }, ctx: z.RefinementCtx) => {
  const ids = icp.clarifications.map((c) => c.id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: "custom", path: ["clarifications"], message: "clarification ids must be unique" });
  }
};

const IcpDraftObject = z.object({
  schemaVersion: z.literal(1),
  name: z.string().default("Untitled ICP"),
  summary: z.string().default(""),
  targetPersonas: z.array(TargetPersona).default([]),
  criteria: z.array(IcpCriterion).default([]),
  scoring: ScoringPolicy.default({}),
  clarifications: z.array(Clarification).default([]),
});

export const IcpDraftDefinition = IcpDraftObject.superRefine(uniqueClarificationIds);
export type IcpDraftDefinition = z.infer<typeof IcpDraftDefinition>;

export const IcpDraftEditable = IcpDraftObject.omit({ clarifications: true });
export type IcpDraftEditable = z.infer<typeof IcpDraftEditable>;

export const IcpDefinition = IcpDraftObject.extend({
  name: z.string().min(1),
  criteria: z.array(IcpCriterion).min(1, "at least one criterion is required"),
}).superRefine((icp, ctx) => {
  const ids = icp.criteria.map((c) => c.id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: "custom", path: ["criteria"], message: "criterion ids must be unique" });
  }
  if (!icp.criteria.some((c) => c.weight > 0)) {
    ctx.addIssue({ code: "custom", path: ["criteria"], message: "at least one criterion must have weight > 0" });
  }
  uniqueClarificationIds(icp, ctx);
  const open = icp.clarifications.filter((c) => c.severity === "BLOCKING" && c.resolvedBy !== "USER");
  if (open.length > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["clarifications"],
      message: `unresolved blocking clarifications: ${open.map((c) => c.id).join(", ")}`,
    });
  }
});
export type IcpDefinition = z.infer<typeof IcpDefinition>;

export const unresolvedClarifications = (icp: IcpDraftDefinition): Clarification[] =>
  icp.clarifications.filter((c) => c.resolvedBy === "UNRESOLVED");
export const defaultedAssumptions = (icp: IcpDraftDefinition): Clarification[] =>
  icp.clarifications.filter((c) => c.resolvedBy === "DEFAULT");
export const openBlockingClarifications = (icp: IcpDraftDefinition): Clarification[] =>
  icp.clarifications.filter((c) => c.severity === "BLOCKING" && c.resolvedBy !== "USER");

export interface ActivationCheck {
  activatable: boolean;
  blockers: { path: string; message: string }[];
}

export const checkActivatable = (draft: unknown): ActivationCheck => {
  const result = IcpDefinition.safeParse(draft);
  if (result.success) return { activatable: true, blockers: [] };
  return {
    activatable: false,
    blockers: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
};

export const LlmClarification = z.object({
  criterionId: z.string().regex(/^[a-z0-9_]+$/).optional(),
  type: ClarificationType,
  question: z.string().min(1),
  severity: ClarificationSeverity,
  proposedDefault: z.string().optional(),
});
export type LlmClarification = z.infer<typeof LlmClarification>;

export const IcpExtractionOutput = z.object({
  draft: IcpDraftObject.omit({ clarifications: true }),
  clarifications: z.array(LlmClarification),
  unsupported: z.array(z.object({ text: z.string(), reason: z.string() })).default([]),
  assistantMessage: z.string(),
});
export type IcpExtractionOutput = z.infer<typeof IcpExtractionOutput>;

export const reconcileClarifications = (
  previous: Clarification[],
  proposals: LlmClarification[],
): Clarification[] => {
  const seen = new Set<string>();
  const next: Clarification[] = [];
  for (const p of proposals) {
    const id = clarificationId(p);
    if (seen.has(id)) continue;
    seen.add(id);
    const match = previous.find((c) => c.id === id);
    if (match && match.resolvedBy === "USER") {
      next.push({ ...p, id, answer: match.answer, resolvedBy: "USER" });
    } else if (p.severity === "MINOR" && p.proposedDefault?.trim()) {
      next.push({ ...p, id, answer: null, resolvedBy: "DEFAULT" });
    } else {
      next.push({ ...p, id, answer: null, resolvedBy: "UNRESOLVED" });
    }
  }
  for (const c of previous) {
    if (c.resolvedBy === "USER" && !seen.has(c.id)) {
      seen.add(c.id);
      next.push(c);
    }
  }
  return next;
};

export const ChatMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  at: z.string().datetime(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;
