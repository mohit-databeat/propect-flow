import type { CanonicalCompany, DeterministicCriterion } from "@prospect/shared";

export type CriterionVerdict = "PASS" | "FAIL" | "UNKNOWN";

export interface EvalResult {
  status: CriterionVerdict;
  reason: string;

  evidenceAttributeId?: string;

  evidenceAttributeIds?: string[];
  evidenceContent?: Record<string, unknown>;

  confidence?: number;

  aiRunId?: string;

  missingFields: string[];
}

export interface KnownKeys {
  isKnownIndustryKey(value: string): boolean;
  isKnownTechnologyKey(value: string): boolean;
  isKnownCountryCode(value: string): boolean;
}

export const LIST_GROUP_FIELDS = new Set(["technographics.stack", "signals.hiring", "signals.funding", "signals.news", "signals.expansion"]);
const EMPLOYEE_RANGE_ORDER = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+"];

function bucketBounds(bucket: string): [number, number] {
  if (bucket === "10001+") return [10001, Infinity];
  const [lo, hi] = bucket.split("-").map(Number);
  return [lo!, hi!];
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, key) => (cur && typeof cur === "object" ? (cur as Record<string, unknown>)[key] : undefined), obj);
}

function unknown(reason: string, missingFields: string[] = []): EvalResult {
  return { status: "UNKNOWN", reason, missingFields };
}
function pass(reason: string, attributeId?: string, content?: Record<string, unknown>): EvalResult {
  return { status: "PASS", reason, evidenceAttributeId: attributeId, evidenceContent: content, missingFields: [] };
}
function fail(reason: string, attributeId?: string, content?: Record<string, unknown>): EvalResult {
  return { status: "FAIL", reason, evidenceAttributeId: attributeId, evidenceContent: content, missingFields: [] };
}

function fmt(v: unknown): string {
  if (typeof v === "number") return v.toLocaleString("en-US");
  return JSON.stringify(v);
}

export function evaluateDeterministic(criterion: DeterministicCriterion, canonical: CanonicalCompany, keys: KnownKeys): EvalResult {
  const field = criterion.field;
  const provenance = (canonical.provenance as Record<string, { attributeId: string; authoritative?: boolean }> | undefined)?.[field];
  const attributeId = provenance?.attributeId;

  if (LIST_GROUP_FIELDS.has(field)) {
    return evaluateListGroup(criterion, canonical, keys);
  }

  const raw = getPath(canonical, field);
  const missing = raw === undefined || raw === null || raw === "";

  if (criterion.operator === "EXISTS") {
    if (!missing) return pass(`${field} is present (${fmt(raw)})`, attributeId, { field, value: raw });
    return unknown(`missing: ${field}`, [field]);
  }

  if (missing) {
    if (field === "firmographics.employeeCount" && criterion.operator === "BETWEEN") {
      return evaluateEmployeeRangeFallback(criterion, canonical);
    }
    return unknown(`missing: ${field}`, [field]);
  }

  if (field === "firmographics.industry" && typeof raw === "string" && !keys.isKnownIndustryKey(raw)) {
    return unknown(`unmapped value for ${field}: "${raw}"`, [field]);
  }
  if (field === "firmographics.country" && typeof raw === "string" && !keys.isKnownCountryCode(raw)) {
    return unknown(`unmapped value for ${field}: "${raw}"`, [field]);
  }

  const content = { field, value: raw };

  switch (criterion.operator) {
    case "EQ":
      return raw === criterion.value
        ? pass(`${field} ${fmt(raw)} equals ${fmt(criterion.value)}`, attributeId, content)
        : fail(`${field} ${fmt(raw)} does not equal ${fmt(criterion.value)}`, attributeId, content);
    case "NEQ":
      return raw !== criterion.value
        ? pass(`${field} ${fmt(raw)} does not equal ${fmt(criterion.value)}`, attributeId, content)
        : fail(`${field} ${fmt(raw)} equals ${fmt(criterion.value)}`, attributeId, content);
    case "IN":
      return criterion.value.includes(raw as string)
        ? pass(`${field} ${fmt(raw)} is in [${criterion.value.join(", ")}]`, attributeId, content)
        : fail(`${field} ${fmt(raw)} is not in [${criterion.value.join(", ")}]`, attributeId, content);
    case "NOT_IN":
      return !criterion.value.includes(raw as string)
        ? pass(`${field} ${fmt(raw)} is not in [${criterion.value.join(", ")}]`, attributeId, content)
        : fail(`${field} ${fmt(raw)} is in [${criterion.value.join(", ")}]`, attributeId, content);
    case "GTE":
      return typeof raw === "number" && raw >= criterion.value
        ? pass(`${field} ${fmt(raw)} >= ${fmt(criterion.value)}`, attributeId, content)
        : fail(`${field} ${fmt(raw)} < ${fmt(criterion.value)}`, attributeId, content);
    case "LTE":
      return typeof raw === "number" && raw <= criterion.value
        ? pass(`${field} ${fmt(raw)} <= ${fmt(criterion.value)}`, attributeId, content)
        : fail(`${field} ${fmt(raw)} > ${fmt(criterion.value)}`, attributeId, content);
    case "BETWEEN": {
      if (typeof raw !== "number") return unknown(`missing: ${field}`, [field]);
      const { min, max } = criterion.value;
      const inRange = (min === undefined || raw >= min) && (max === undefined || raw <= max);
      return inRange
        ? pass(`${field} ${fmt(raw)} is within ${min ?? "–"}-${max ?? "–"}`, attributeId, content)
        : fail(`${field} ${fmt(raw)} is outside ${min ?? "–"}-${max ?? "–"}`, attributeId, content);
    }
    default:
      return unknown(`unsupported operator for scalar field ${field}`, []);
  }
}

function evaluateEmployeeRangeFallback(criterion: DeterministicCriterion & { operator: "BETWEEN" }, canonical: CanonicalCompany): EvalResult {
  const bucket = getPath(canonical, "firmographics.employeeRange") as string | undefined;
  if (!bucket || !EMPLOYEE_RANGE_ORDER.includes(bucket)) {
    return unknown("missing: firmographics.employeeCount", ["firmographics.employeeCount"]);
  }
  const provenance = (canonical.provenance as Record<string, { attributeId: string }> | undefined)?.["firmographics.employeeRange"];
  const [bLo, bHi] = bucketBounds(bucket);
  const { min, max } = criterion.value;
  const lo = min ?? -Infinity;
  const hi = max ?? Infinity;
  const content = { field: "firmographics.employeeRange", value: bucket };

  if (bLo >= lo && bHi <= hi) {
    return pass(`employeeCount is unknown but employeeRange "${bucket}" is fully within ${min ?? "–"}-${max ?? "–"}`, provenance?.attributeId, content);
  }
  if (bHi < lo || bLo > hi) {
    return fail(`employeeCount is unknown but employeeRange "${bucket}" is fully outside ${min ?? "–"}-${max ?? "–"}`, provenance?.attributeId, content);
  }
  return unknown(`employeeRange "${bucket}" straddles the ${min ?? "–"}-${max ?? "–"} boundary — cannot determine PASS or FAIL without the exact count`, [
    "firmographics.employeeCount",
  ]);
}

interface ListGroupSnapshot {
  items: Record<string, unknown>[];
  authoritative: boolean;
}

function listKeys(items: Record<string, unknown>[]): string[] {
  return items.map((i) => String(i.key ?? i.title ?? i.headline ?? ""));
}

function evaluateListGroup(criterion: DeterministicCriterion, canonical: CanonicalCompany, keys: KnownKeys): EvalResult {
  const field = criterion.field;
  const group = getPath(canonical, field) as ListGroupSnapshot | undefined;
  const items = group?.items ?? [];
  const authoritative = group?.authoritative ?? false;
  const provenance = (canonical.provenance as Record<string, { attributeId: string }> | undefined)?.[field];
  const attributeId = provenance?.attributeId;
  const content = { field, items, authoritative };

  if (criterion.operator === "EXISTS") {
    if (items.length > 0) return pass(`${field} has ${items.length} item(s)`, attributeId, content);
    if (authoritative) return fail(`${field} is authoritatively empty`, attributeId, content);
    return unknown(`missing: ${field} (not authoritative — absence cannot be inferred)`, [field]);
  }

  if (criterion.operator !== "CONTAINS_ANY" && criterion.operator !== "CONTAINS_ALL") {
    return unknown(`operator ${criterion.operator} is not valid for list field ${field}`, []);
  }

  if (items.length === 0) {
    if (authoritative) return fail(`${field} is authoritatively empty — cannot contain [${criterion.value.join(", ")}]`, attributeId, content);
    return unknown(`missing: ${field} (not authoritative — absence cannot be inferred)`, [field]);
  }

  const presentKeys = listKeys(items);

  const comparableKeys = field === "technographics.stack" ? presentKeys.filter((k) => keys.isKnownTechnologyKey(k)) : presentKeys;

  if (criterion.operator === "CONTAINS_ANY") {
    const matched = criterion.value.some((v) => comparableKeys.includes(v));
    return matched
      ? pass(`${field} contains one of [${criterion.value.join(", ")}]`, attributeId, content)
      : fail(`${field} [${presentKeys.join(", ")}] contains none of [${criterion.value.join(", ")}]`, attributeId, content);
  }

  const matchedAll = criterion.value.every((v) => comparableKeys.includes(v));
  return matchedAll
    ? pass(`${field} contains all of [${criterion.value.join(", ")}]`, attributeId, content)
    : fail(`${field} [${presentKeys.join(", ")}] is missing one or more of [${criterion.value.join(", ")}]`, attributeId, content);
}
