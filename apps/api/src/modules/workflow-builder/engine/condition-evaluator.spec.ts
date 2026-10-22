import type { ConditionNodeConfig } from "@prospect/shared";
import { evaluateCondition, splitByCondition, type ProspectFacts } from "./condition-evaluator";

const facts = (over: Partial<ProspectFacts> = {}): ProspectFacts => ({
  status: "QUALIFIED",
  score: 80,
  coverage: 70,
  missingFields: [],
  requiredFails: [],
  qaStatus: "PASS",
  ...over,
});

const cfg = (c: ConditionNodeConfig) => c;

describe("evaluateCondition", () => {
  it("compares status with EQ, NEQ and IN", () => {
    expect(evaluateCondition(cfg({ field: "status", operator: "EQ", value: "QUALIFIED" }), facts())).toBe(true);
    expect(evaluateCondition(cfg({ field: "status", operator: "EQ", value: "NEEDS_REVIEW" }), facts())).toBe(false);
    expect(evaluateCondition(cfg({ field: "status", operator: "NEQ", value: "DISQUALIFIED" }), facts())).toBe(true);
    expect(evaluateCondition(cfg({ field: "status", operator: "IN", value: ["QUALIFIED", "NEEDS_REVIEW"] }), facts({ status: "NEEDS_REVIEW" }))).toBe(true);
    expect(evaluateCondition(cfg({ field: "status", operator: "IN", value: ["DISQUALIFIED"] }), facts())).toBe(false);
  });

  it("compares numbers at the boundary", () => {
    expect(evaluateCondition(cfg({ field: "score", operator: "GTE", value: 80 }), facts())).toBe(true);
    expect(evaluateCondition(cfg({ field: "score", operator: "GTE", value: 81 }), facts())).toBe(false);
    expect(evaluateCondition(cfg({ field: "score", operator: "LTE", value: 80 }), facts())).toBe(true);
    expect(evaluateCondition(cfg({ field: "coverage", operator: "EQ", value: 70 }), facts())).toBe(true);
    expect(evaluateCondition(cfg({ field: "coverage", operator: "LTE", value: 69 }), facts())).toBe(false);
  });

  it("never matches a numeric rule when the value is unknown", () => {
    for (const operator of ["EQ", "GTE", "LTE"] as const) {
      expect(evaluateCondition(cfg({ field: "score", operator, value: 0 }), facts({ score: null }))).toBe(false);
    }
  });

  it("answers the missing-field and required-fail questions in both directions", () => {
    expect(evaluateCondition(cfg({ field: "hasMissingFields", operator: "IS_TRUE" }), facts({ missingFields: ["x"] }))).toBe(true);
    expect(evaluateCondition(cfg({ field: "hasMissingFields", operator: "IS_TRUE" }), facts())).toBe(false);
    expect(evaluateCondition(cfg({ field: "hasMissingFields", operator: "IS_FALSE" }), facts())).toBe(true);
    expect(evaluateCondition(cfg({ field: "hasRequiredFail", operator: "IS_TRUE" }), facts({ requiredFails: ["industry"] }))).toBe(true);
    expect(evaluateCondition(cfg({ field: "hasRequiredFail", operator: "IS_FALSE" }), facts({ requiredFails: ["industry"] }))).toBe(false);
  });

  it("handles a prospect with no email yet on the QA field", () => {
    const noMessage = facts({ qaStatus: null });
    expect(evaluateCondition(cfg({ field: "qaStatus", operator: "EQ", value: "PASS" }), noMessage)).toBe(false);
    expect(evaluateCondition(cfg({ field: "qaStatus", operator: "IN", value: ["PASS", "WARN"] }), noMessage)).toBe(false);
    expect(evaluateCondition(cfg({ field: "qaStatus", operator: "NEQ", value: "PASS" }), noMessage)).toBe(true);
  });
});

describe("splitByCondition", () => {
  it("sends every item down exactly one branch and keeps order", () => {
    const items = [
      { id: "a", facts: facts({ score: 90 }) },
      { id: "b", facts: facts({ score: 20 }) },
      { id: "c", facts: facts({ score: null }) },
      { id: "d", facts: facts({ score: 75 }) },
    ];
    const out = splitByCondition(cfg({ field: "score", operator: "GTE", value: 75 }), items);
    expect(out).toEqual({ true: ["a", "d"], false: ["b", "c"] });
    expect(out.true.length + out.false.length).toBe(items.length);
  });

  it("returns empty branches for no items", () => {
    expect(splitByCondition(cfg({ field: "status", operator: "EQ", value: "QUALIFIED" }), [])).toEqual({ true: [], false: [] });
  });
});
