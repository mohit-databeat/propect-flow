import type { ConditionNodeConfig } from "@prospect/shared";

export interface ProspectFacts {
  status: string;
  score: number | null;
  coverage: number | null;
  missingFields: string[];
  requiredFails: string[];
  qaStatus: string | null;
}

function compareNumber(actual: number | null, operator: ConditionNodeConfig["operator"], expected: unknown): boolean {
  if (actual === null || typeof expected !== "number") return false;
  if (operator === "EQ") return actual === expected;
  if (operator === "GTE") return actual >= expected;
  if (operator === "LTE") return actual <= expected;
  return false;
}

function compareEnum(actual: string | null, operator: ConditionNodeConfig["operator"], expected: unknown): boolean {
  if (operator === "EQ") return actual !== null && actual === expected;
  if (operator === "NEQ") return actual !== expected;
  if (operator === "IN") return actual !== null && Array.isArray(expected) && expected.includes(actual);
  return false;
}

export function evaluateCondition(config: ConditionNodeConfig, facts: ProspectFacts): boolean {
  switch (config.field) {
    case "status":
      return compareEnum(facts.status, config.operator, config.value);
    case "qaStatus":
      return compareEnum(facts.qaStatus, config.operator, config.value);
    case "score":
      return compareNumber(facts.score, config.operator, config.value);
    case "coverage":
      return compareNumber(facts.coverage, config.operator, config.value);
    case "hasMissingFields":
      return config.operator === "IS_TRUE" ? facts.missingFields.length > 0 : facts.missingFields.length === 0;
    case "hasRequiredFail":
      return config.operator === "IS_TRUE" ? facts.requiredFails.length > 0 : facts.requiredFails.length === 0;
  }
}

export function splitByCondition(config: ConditionNodeConfig, items: readonly { id: string; facts: ProspectFacts }[]): { true: string[]; false: string[] } {
  const result: { true: string[]; false: string[] } = { true: [], false: [] };
  for (const item of items) result[evaluateCondition(config, item.facts) ? "true" : "false"].push(item.id);
  return result;
}
