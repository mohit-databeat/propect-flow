# ICP JSON Schema

The Ideal Customer Profile (ICP) is authored in natural language through chat and stored as a structured, versioned JSON document. The Zod schemas below are the single source of truth and live in `packages/shared/src/schemas/icp.schema.ts`. The API validates before persisting; the web app imports the same schemas for the form editor and live preview.

## Two schemas: draft and activatable

| Schema | Used for | Rules |
|---|---|---|
| `IcpDraftDefinition` | `IcpProfile.definition` while `status = DRAFT`; extractor output; `PUT /icp/draft` | May have **zero criteria**, unresolved clarifications, empty summary. Structurally valid so the UI can always render it. Clarification ids unique and state-consistent. |
| `IcpDefinition` (strict) | `POST /icp/activate`; `IcpProfile.definition` while `status = ACTIVE`; workflow runs | **At least one criterion with `weight > 0`**, unique criterion ids, **no BLOCKING clarification unresolved by the user**, valid scoring policy. |

An ambiguous first message such as "target mid-size companies" therefore produces a saved draft with zero criteria and one BLOCKING clarification, without any schema failure. Activation validates the draft against the strict schema and returns a structured error listing what is missing.

## Design rules

- **Two kinds of criteria.** `DETERMINISTIC` criteria are evaluated by code against one canonical field. `QUALITATIVE` criteria are evaluated by an LLM against a declared evidence set. No LLM is ever used for a deterministic criterion.
- **Required vs soft.** `required: true` is a hard filter: a FAIL disqualifies regardless of score. `required: false` only affects the weighted score.
- **Dependencies are explicit.** Deterministic criteria depend on their `field`; qualitative criteria declare `requiredEvidenceFields`. The union drives missing-field detection and targeted enrichment.
- **UNKNOWN is a first-class outcome.** Missing data, unmapped dictionary terms, low LLM confidence and invalid LLM evidence citations all resolve to UNKNOWN, never to a guess.
- **Absence of data is not evidence of absence.** An empty list or missing field only counts as "none exist" when the observation is marked authoritative by its provider (see canonical-model.md). Otherwise UNKNOWN.
- **Clarifications are the single source of truth.** Unresolved questions and defaulted assumptions shown in the UI are derived from `draft.clarifications`. There is no separate open-questions state.
- **Clarification identity is deterministic and server-owned.** Ids are `clar:<criterionId|general>:<type>`; the LLM emits `criterionId` + `type`, never ids. Duplicates within one LLM turn are deduped server-side; uniqueness is also validated defensively. Across turns, USER answers are carried forward by id.
- **Clarification state is consistent.** `resolvedBy: USER` requires a non-empty `answer`; `resolvedBy: DEFAULT` requires a `proposedDefault`.
- **Only the resolve endpoint sets USER answers.** `PUT /icp/draft` edits criteria/scoring/personas/name/summary and preserves server-managed clarifications.
- **Activation is gated.** Activate is disabled in the UI and refused by the API while the draft fails the strict schema.
- **All percentages are integers 0–100.** Thresholds, coverage, confidence. Weights are integers 0–10. Prospect score is a nullable integer 0–100.
- **Values are normalized at save time.** Industry, technology and country values pass through the same synonym dictionaries as company data, so comparisons are key-to-key.

## Zod schema

```ts
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

const Pct = z.number().int().min(0).max(100);   // all percentages: integers 0-100

const CriterionBase = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),          // stable slug, e.g. "industry_saas"
  label: z.string().min(1),
  weight: z.number().int().min(0).max(10).default(5),
  required: z.boolean().default(false),
  enrichIfMissing: z.boolean().default(true),
});

// ── Deterministic criteria (value typed by operator) ────────────────────
const RangeValue = z.object({ min: z.number().optional(), max: z.number().optional() })
  .refine(v => v.min !== undefined || v.max !== undefined, "min or max required");

const det = <O extends string, V extends z.ZodTypeAny>(operator: O, value: V) =>
  CriterionBase.extend({
    kind: z.literal("DETERMINISTIC"),
    field: CanonicalFieldPath,
    operator: z.literal(operator),
    value,
  });

export const DeterministicCriterion = z.discriminatedUnion("operator", [
  det("EQ",           z.union([z.string(), z.number(), z.boolean()])),
  det("NEQ",          z.union([z.string(), z.number(), z.boolean()])),
  det("IN",           z.array(z.string()).min(1)),
  det("NOT_IN",       z.array(z.string()).min(1)),
  det("GTE",          z.number()),
  det("LTE",          z.number()),
  det("BETWEEN",      RangeValue),
  det("CONTAINS_ANY", z.array(z.string()).min(1)),   // list fields
  det("CONTAINS_ALL", z.array(z.string()).min(1)),
  det("EXISTS",       z.literal(true)),
  // EXISTS / CONTAINS_* on a missing or empty value yield UNKNOWN unless the
  // observation's provenance is authoritative (provider vouches the list is complete).
]);

// ── Qualitative criteria (LLM) ──────────────────────────────────────────
export const QualitativeCriterion = CriterionBase.extend({
  kind: z.literal("QUALITATIVE"),
  operator: z.literal("LLM_ASSESS"),
  question: z.string().min(10),
  passRubric: z.string().min(10),
  failRubric: z.string().optional(),
  evidenceFields: z.array(CanonicalFieldPath).min(1),
  requiredEvidenceFields: z.array(CanonicalFieldPath).min(1),  // all must be present (non-empty or authoritative-empty), else UNKNOWN without LLM call
  minConfidence: Pct.default(60),
  recencyDays: z.number().int().positive().optional(),
}).refine(c => c.requiredEvidenceFields.every(f => c.evidenceFields.includes(f)),
  "requiredEvidenceFields must be a subset of evidenceFields");

export const IcpCriterion = z.union([DeterministicCriterion, QualitativeCriterion]);
export type IcpCriterion = z.infer<typeof IcpCriterion>;

// ── Scoring policy ──────────────────────────────────────────────────────
export const ScoringPolicy = z.object({
  qualifiedThreshold: Pct.default(70),
  needsReviewThreshold: Pct.default(40),
  minCoverage: Pct.default(60),
  unknownRequiredPolicy: z.enum(["NEEDS_REVIEW", "DISQUALIFY"]).default("NEEDS_REVIEW"),
}).refine(s => s.needsReviewThreshold < s.qualifiedThreshold,
  "needsReviewThreshold must be below qualifiedThreshold");

// ── Clarifications (single source of truth) ─────────────────────────────
export const ClarificationType = z.enum([
  "ambiguous_scope",     // "mid-size", "large", "enterprise"
  "numeric_bound",       // missing min/max
  "required_or_soft",    // hard filter vs preference
  "recency_window",      // how recent a signal must be
  "geo_scope",           // country vs region vs city
  "industry_scope",      // which industries exactly
  "technology_scope",    // which product variants count
  "unsupported_field",   // asked for something the model cannot evaluate
  "other",
]);

export const clarificationId = (c: { criterionId?: string; type: string }) =>
  `clar:${c.criterionId ?? "general"}:${c.type}`;

export const Clarification = z.object({
  id: z.string().regex(/^clar:[a-z0-9_]+:[a-z_]+$/),   // server-assigned via clarificationId()
  criterionId: z.string().optional(),
  type: ClarificationType,
  question: z.string().min(1),
  severity: z.enum(["BLOCKING", "MINOR"]),
  answer: z.string().nullable(),
  proposedDefault: z.string().optional(),
  resolvedBy: z.enum(["USER", "DEFAULT", "UNRESOLVED"]),
}).superRefine((c, ctx) => {
  if (c.id !== clarificationId(c))
    ctx.addIssue({ code: "custom", path: ["id"], message: "clarification id must equal clar:<criterionId|general>:<type>" });
  if (c.resolvedBy === "USER" && !c.answer?.trim())
    ctx.addIssue({ code: "custom", path: ["answer"], message: "user-resolved clarification requires an answer" });
  if (c.resolvedBy === "DEFAULT" && !c.proposedDefault?.trim())
    ctx.addIssue({ code: "custom", path: ["proposedDefault"], message: "default-resolved clarification requires a proposed default" });
});
export type Clarification = z.infer<typeof Clarification>;

export const TargetPersona = z.object({
  title: z.string(), seniority: z.string().optional(), department: z.string().optional(),
});

// ── Draft: permissive, always renderable ────────────────────────────────
export const IcpDraftDefinition = z.object({
  schemaVersion: z.literal(1),
  name: z.string().default("Untitled ICP"),
  summary: z.string().default(""),
  targetPersonas: z.array(TargetPersona).default([]),
  criteria: z.array(IcpCriterion).default([]),      // zero criteria allowed while drafting
  scoring: ScoringPolicy.default({}),
  clarifications: z.array(Clarification).default([]),
}).superRefine((icp, ctx) => {
  const clarIds = icp.clarifications.map(c => c.id);
  if (new Set(clarIds).size !== clarIds.length)
    ctx.addIssue({ code: "custom", path: ["clarifications"], message: "clarification ids must be unique" });
});
export type IcpDraftDefinition = z.infer<typeof IcpDraftDefinition>;

// ── Strict: required for activation and workflow runs ───────────────────
export const IcpDefinition = IcpDraftDefinition.innerType().extend({
  name: z.string().min(1),
  criteria: z.array(IcpCriterion).min(1, "at least one criterion is required"),
}).superRefine((icp, ctx) => {
  const ids = icp.criteria.map(c => c.id);
  if (new Set(ids).size !== ids.length)
    ctx.addIssue({ code: "custom", path: ["criteria"], message: "criterion ids must be unique" });
  if (!icp.criteria.some(c => c.weight > 0))
    ctx.addIssue({ code: "custom", path: ["criteria"], message: "at least one criterion must have weight > 0" });
  const clarIds = icp.clarifications.map(c => c.id);
  if (new Set(clarIds).size !== clarIds.length)
    ctx.addIssue({ code: "custom", path: ["clarifications"], message: "clarification ids must be unique" });
  const open = icp.clarifications.filter(c => c.severity === "BLOCKING" && c.resolvedBy !== "USER");
  if (open.length > 0)
    ctx.addIssue({ code: "custom", path: ["clarifications"],
      message: `unresolved blocking clarifications: ${open.map(c => c.id).join(", ")}` });
});
export type IcpDefinition = z.infer<typeof IcpDefinition>;

// ── Derived views – never stored separately ─────────────────────────────
export const unresolvedClarifications = (icp: IcpDraftDefinition) =>
  icp.clarifications.filter(c => c.resolvedBy === "UNRESOLVED");           // the user still has to answer these
export const defaultedAssumptions = (icp: IcpDraftDefinition) =>
  icp.clarifications.filter(c => c.resolvedBy === "DEFAULT");              // visible, editable assumptions
export const openBlockingClarifications = (icp: IcpDraftDefinition) =>
  icp.clarifications.filter(c => c.severity === "BLOCKING" && c.resolvedBy !== "USER");  // activation blockers

// ── Extractor output (what the LLM returns; ids/answers/resolution are NOT trusted from the LLM) ──
export const LlmClarification = z.object({
  criterionId: z.string().optional(),
  type: ClarificationType,
  question: z.string().min(1),
  severity: z.enum(["BLOCKING", "MINOR"]),
  proposedDefault: z.string().optional(),
});

export const IcpExtractionOutput = z.object({
  draft: IcpDraftDefinition.innerType().omit({ clarifications: true }),   // may contain zero criteria
  clarifications: z.array(LlmClarification),                              // proposals for this turn (deduped server-side)
  unsupported: z.array(z.object({ text: z.string(), reason: z.string() })).default([]),
  assistantMessage: z.string(),
});
export type IcpExtractionOutput = z.infer<typeof IcpExtractionOutput>;
```

## Clarification reconciliation (server, every chat turn)

```
prev = previous draft.clarifications (may contain USER answers)

// 1. dedupe LLM proposals by deterministic id (first occurrence wins)
proposals = uniqueBy(llmOutput.clarifications, c => clarificationId(c))

// 2. merge
next = []
for each c in proposals:
  id = clarificationId(c)
  match = prev.find(p => p.id === id)
  if match?.resolvedBy === "USER":
      next.push({ ...c, id, answer: match.answer, resolvedBy: "USER" })      // carry the user's answer forward
  else if c.severity === "MINOR" && c.proposedDefault?.trim():
      next.push({ ...c, id, answer: null, resolvedBy: "DEFAULT" })
  else:
      next.push({ ...c, id, answer: null, resolvedBy: "UNRESOLVED" })

// 3. keep USER-resolved clarifications the LLM no longer raises (they document a decision)
for each p in prev where p.resolvedBy === "USER" and !next.some(n => n.id === p.id): next.push(p)

draft.clarifications = next
IcpDraftDefinition.parse(draft)      // defensive: unique ids + state consistency
```

The extractor prompt receives `prev` (including answers) so it can incorporate resolved information into criteria instead of re-asking. The API response for the chat page is `{ assistantMessage, draft, unresolvedClarifications, defaultedAssumptions, unsupported, activatable, blockers }`; the clarification views are computed, not stored.

`PUT /icp/draft` accepts `IcpDraftDefinition` **without** `clarifications` (they are ignored if sent) and re-attaches the server-managed clarifications. `POST /icp/clarifications/:id/resolve` is the only path that sets `resolvedBy: USER` and `answer`.

## Activation flow

```
PUT /icp/draft  or  POST /icp/chat        -> validate IcpDraftDefinition -> save (status DRAFT)
POST /icp/clarifications/:id/resolve      -> set answer (non-empty), resolvedBy USER; re-run extractor if a criterion depends on it
POST /icp/activate                        -> IcpDefinition.safeParse(draft)
      ok    -> new IcpProfile version, status ACTIVE, previous ACTIVE -> ARCHIVED
      error -> 409 ICP_NOT_ACTIVATABLE { issues: [{ path, message }], openBlocking: [...] }
```

The UI derives the Activate button state from the same strict schema client-side, so users see the exact blockers before clicking.

## Worked example: the demo ICP

Natural language input:

> We sell to US-based SaaS companies with 100 to 500 employees and more than $10M revenue. They should already use Salesforce. Ideally they are hiring salespeople right now.

Structured result (valid against the strict schema):

```json
{
  "schemaVersion": 1,
  "name": "US mid-market SaaS on Salesforce",
  "summary": "United States SaaS companies with 100-500 employees and over $10M in revenue that run Salesforce, prioritising those currently hiring sales roles.",
  "targetPersonas": [
    { "title": "VP Sales", "seniority": "vp", "department": "sales" },
    { "title": "Head of Revenue Operations", "seniority": "director", "department": "sales" }
  ],
  "criteria": [
    { "id": "industry_saas", "label": "Industry is SaaS / B2B software", "kind": "DETERMINISTIC",
      "field": "firmographics.industry", "operator": "IN", "value": ["software_saas"],
      "weight": 8, "required": true, "enrichIfMissing": true },
    { "id": "country_us", "label": "Headquartered in the United States", "kind": "DETERMINISTIC",
      "field": "firmographics.country", "operator": "EQ", "value": "US",
      "weight": 8, "required": true, "enrichIfMissing": true },
    { "id": "employees_100_500", "label": "100 to 500 employees", "kind": "DETERMINISTIC",
      "field": "firmographics.employeeCount", "operator": "BETWEEN", "value": { "min": 100, "max": 500 },
      "weight": 7, "required": true, "enrichIfMissing": true },
    { "id": "revenue_gt_10m", "label": "Revenue above $10M", "kind": "DETERMINISTIC",
      "field": "firmographics.revenueUsd", "operator": "GTE", "value": 10000000,
      "weight": 6, "required": false, "enrichIfMissing": true },
    { "id": "uses_salesforce", "label": "Uses Salesforce", "kind": "DETERMINISTIC",
      "field": "technographics.stack", "operator": "CONTAINS_ANY", "value": ["salesforce"],
      "weight": 7, "required": false, "enrichIfMissing": true },
    { "id": "hiring_salespeople", "label": "Actively hiring salespeople", "kind": "QUALITATIVE", "operator": "LLM_ASSESS",
      "question": "Is this company currently hiring for sales or revenue roles (AE, SDR/BDR, sales leadership, revenue operations)?",
      "passRubric": "PASS if at least one open role in the evidence is clearly a sales or revenue role and was posted within the recency window.",
      "failRubric": "FAIL if the hiring evidence is authoritative and contains no sales or revenue roles.",
      "evidenceFields": ["signals.hiring", "signals.news", "firmographics.description"],
      "requiredEvidenceFields": ["signals.hiring"],
      "minConfidence": 60, "recencyDays": 90,
      "weight": 6, "required": false, "enrichIfMissing": true }
  ],
  "scoring": { "qualifiedThreshold": 70, "needsReviewThreshold": 40, "minCoverage": 60, "unknownRequiredPolicy": "NEEDS_REVIEW" },
  "clarifications": [
    { "id": "clar:revenue_gt_10m:required_or_soft", "criterionId": "revenue_gt_10m", "type": "required_or_soft", "severity": "MINOR",
      "question": "Is revenue above $10M a hard requirement or a preference?",
      "answer": null, "proposedDefault": "Treated as a preference (soft criterion) because revenue data is often missing.",
      "resolvedBy": "DEFAULT" },
    { "id": "clar:hiring_salespeople:recency_window", "criterionId": "hiring_salespeople", "type": "recency_window", "severity": "BLOCKING",
      "question": "How recent should sales job postings be to count?",
      "answer": "Last 90 days", "resolvedBy": "USER" }
  ]
}
```

This ICP is activatable: its only BLOCKING clarification is resolved by the user with a non-empty answer, criterion ids are unique, and several criteria have weight > 0.

## Worked example: an ambiguous first message

Input: "target mid-size companies"

Draft (valid against `IcpDraftDefinition`, not activatable):

```json
{
  "schemaVersion": 1,
  "name": "Untitled ICP",
  "summary": "",
  "targetPersonas": [],
  "criteria": [],
  "scoring": { "qualifiedThreshold": 70, "needsReviewThreshold": 40, "minCoverage": 60, "unknownRequiredPolicy": "NEEDS_REVIEW" },
  "clarifications": [
    { "id": "clar:general:ambiguous_scope", "type": "ambiguous_scope", "severity": "BLOCKING", "resolvedBy": "UNRESOLVED", "answer": null,
      "question": "What employee range do you mean by mid-size?", "proposedDefault": "100-500 employees" }
  ]
}
```

`assistantMessage`: "Got it. What employee range do you mean by mid-size? A common definition is 100–500 employees. Also, which industries and countries should I include?"

`POST /icp/activate` on this draft → `409 ICP_NOT_ACTIVATABLE` with issues "at least one criterion is required", "at least one criterion must have weight > 0" and "unresolved blocking clarifications: clar:general:ambiguous_scope".

## Chat-to-JSON behaviour

| Situation | Behaviour |
|---|---|
| A required criterion is ambiguous ("mid-size companies") | `BLOCKING` clarification. Draft saved (possibly with zero criteria); Activate disabled. |
| A numeric bound is missing ("large revenue") | `BLOCKING` with a `proposedDefault` the user can accept with one click (the resolve endpoint stores the default text as the `answer`, `resolvedBy: USER`). |
| Only a soft criterion or weight is unclear | `MINOR` with a `proposedDefault`: recorded as `DEFAULT`, shown under "assumptions", editable later. A `MINOR` proposal without a default is stored `UNRESOLVED` but never blocks activation. |
| User mentions a field the canonical model does not have | Listed in `unsupported[]` with a reason and a `MINOR` clarification of type `unsupported_field`; never silently guessed. |
| Repeat messages | Full transcript + previous clarifications are re-sent; the extractor returns a complete replacement draft; USER answers are carried forward by deterministic id. |

## Deterministic evaluation semantics

| Operator | Field type | PASS when | FAIL when | UNKNOWN when |
|---|---|---|---|---|
| EQ / NEQ | scalar | normalized equal / not equal | otherwise | field missing or unmapped term |
| IN / NOT_IN | scalar | normalized value in / not in list | otherwise | as above |
| GTE / LTE | number | compare true | compare false | missing |
| BETWEEN | number | `min <= v <= max` | outside | missing; or only an `employeeRange` bucket exists and it straddles a bound |
| CONTAINS_ANY / CONTAINS_ALL | list | condition true on items | items present and condition false; **or** items empty and observation authoritative | items empty and observation not authoritative; field missing |
| EXISTS | any | value present and non-empty | value absent **and** observation authoritative | value absent otherwise |

`BETWEEN` on `firmographics.employeeCount` falls back to `firmographics.employeeRange`: bucket `201-500` against `100-500` is PASS, bucket `501-1000` is FAIL, bucket `51-200` straddles 100 and is UNKNOWN.

Authoritative observations come only from providers that state a list is complete (see `authoritative` in canonical-model.md). CSV data is never authoritative for absence.

## Scoring (reference)

```
if any required criterion FAIL                → DISQUALIFIED
else if any required criterion UNKNOWN        → scoring.unknownRequiredPolicy (NEEDS_REVIEW | DISQUALIFY)
else:
  knownWeight = Σ weight over criteria with PASS or FAIL
  allWeight   = Σ weight over all criteria          (> 0 guaranteed by the strict schema)
  if knownWeight === 0:                              // no usable evidence at all
      score = null, coverage = 0, status = NEEDS_REVIEW
  else:
      score    = round(100 · Σ weight over PASS / knownWeight)
      coverage = round(100 · knownWeight / allWeight)
      status   = score ≥ qualifiedThreshold && coverage ≥ minCoverage ? QUALIFIED
               : score < needsReviewThreshold                          ? DISQUALIFIED
               : NEEDS_REVIEW
```

`score = null` means "insufficient evidence", never "bad fit". The UI renders it as "—" with a NEEDS_REVIEW badge.
