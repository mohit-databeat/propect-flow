import type { IcpCriterion, IcpDefinition } from "@prospect/shared";
import { computeScoring, type CriterionOutcome } from "./scoring";

const criterion = (overrides: Partial<IcpCriterion> & { id: string; weight: number; required: boolean }): IcpCriterion =>
  ({ label: overrides.id, kind: "DETERMINISTIC", field: "firmographics.country", operator: "EQ", value: "US", enrichIfMissing: true, ...overrides }) as IcpCriterion;

const icp = (scoring: Partial<IcpDefinition["scoring"]> = {}): IcpDefinition =>
  ({
    schemaVersion: 1,
    name: "Test ICP",
    summary: "",
    targetPersonas: [],
    criteria: [],
    clarifications: [],
    scoring: { qualifiedThreshold: 70, needsReviewThreshold: 40, minCoverage: 60, unknownRequiredPolicy: "NEEDS_REVIEW", ...scoring },
  }) as IcpDefinition;

describe("computeScoring — required-criterion priority", () => {
  it("any required FAIL -> DISQUALIFIED, regardless of other criteria", () => {
    const outcomes: CriterionOutcome[] = [
      { criterion: criterion({ id: "req", weight: 8, required: true }), status: "FAIL" },
      { criterion: criterion({ id: "soft", weight: 2, required: false }), status: "PASS" },
    ];
    const result = computeScoring(icp(), outcomes);
    expect(result.status).toBe("DISQUALIFIED");
    expect(result.requiredFails).toEqual(["req"]);
  });

  it("a required UNKNOWN (with default policy) -> NEEDS_REVIEW", () => {
    const outcomes: CriterionOutcome[] = [
      { criterion: criterion({ id: "req", weight: 8, required: true }), status: "UNKNOWN" },
      { criterion: criterion({ id: "soft", weight: 2, required: false }), status: "PASS" },
    ];
    const result = computeScoring(icp(), outcomes);
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.requiredUnknowns).toEqual(["req"]);
  });

  it("a required UNKNOWN with unknownRequiredPolicy=DISQUALIFY -> DISQUALIFIED", () => {
    const outcomes: CriterionOutcome[] = [{ criterion: criterion({ id: "req", weight: 8, required: true }), status: "UNKNOWN" }];
    const result = computeScoring(icp({ unknownRequiredPolicy: "DISQUALIFY" }), outcomes);
    expect(result.status).toBe("DISQUALIFIED");
  });
});

describe("computeScoring — weighted score and coverage", () => {
  it("computes score as round(100 * passWeight / knownWeight) and coverage as round(100 * knownWeight / totalWeight)", () => {
    const outcomes: CriterionOutcome[] = [
      { criterion: criterion({ id: "a", weight: 8, required: false }), status: "PASS" },
      { criterion: criterion({ id: "b", weight: 6, required: false }), status: "FAIL" },
      { criterion: criterion({ id: "c", weight: 6, required: false }), status: "UNKNOWN" },
    ];
    const result = computeScoring(icp(), outcomes);

    expect(result.knownWeight).toBe(14);
    expect(result.score).toBe(Math.round((100 * 8) / 14));
    expect(result.coverage).toBe(Math.round((100 * 14) / 20));
  });

  it("knownWeight === 0 -> score null, coverage 0, status NEEDS_REVIEW (never score 0 for no evidence)", () => {
    const outcomes: CriterionOutcome[] = [
      { criterion: criterion({ id: "a", weight: 5, required: false }), status: "UNKNOWN" },
      { criterion: criterion({ id: "b", weight: 5, required: false }), status: "UNKNOWN" },
    ];
    const result = computeScoring(icp(), outcomes);
    expect(result.score).toBeNull();
    expect(result.coverage).toBe(0);
    expect(result.status).toBe("NEEDS_REVIEW");
  });

  it("QUALIFIED requires both score >= qualifiedThreshold AND coverage >= minCoverage", () => {

    const lowCoverage: CriterionOutcome[] = [
      { criterion: criterion({ id: "a", weight: 2, required: false }), status: "PASS" },
      { criterion: criterion({ id: "b", weight: 8, required: false }), status: "UNKNOWN" },
    ];
    const result = computeScoring(icp({ qualifiedThreshold: 70, minCoverage: 60 }), lowCoverage);
    expect(result.score).toBe(100);
    expect(result.coverage).toBe(20);
    expect(result.status).not.toBe("QUALIFIED");
  });

  it("QUALIFIED when both thresholds are met", () => {
    const outcomes: CriterionOutcome[] = [
      { criterion: criterion({ id: "a", weight: 8, required: false }), status: "PASS" },
      { criterion: criterion({ id: "b", weight: 2, required: false }), status: "PASS" },
    ];
    const result = computeScoring(icp({ qualifiedThreshold: 70, minCoverage: 60 }), outcomes);
    expect(result.status).toBe("QUALIFIED");
    expect(result.score).toBe(100);
    expect(result.coverage).toBe(100);
  });

  it("score below needsReviewThreshold -> DISQUALIFIED", () => {
    const outcomes: CriterionOutcome[] = [
      { criterion: criterion({ id: "a", weight: 8, required: false }), status: "FAIL" },
      { criterion: criterion({ id: "b", weight: 2, required: false }), status: "PASS" },
    ];
    const result = computeScoring(icp({ needsReviewThreshold: 40 }), outcomes);
    expect(result.score).toBe(20);
    expect(result.status).toBe("DISQUALIFIED");
  });

  it("score between needsReviewThreshold and qualifiedThreshold -> NEEDS_REVIEW", () => {
    const outcomes: CriterionOutcome[] = [
      { criterion: criterion({ id: "a", weight: 5, required: false }), status: "PASS" },
      { criterion: criterion({ id: "b", weight: 5, required: false }), status: "FAIL" },
    ];
    const result = computeScoring(icp({ qualifiedThreshold: 70, needsReviewThreshold: 40, minCoverage: 60 }), outcomes);
    expect(result.score).toBe(50);
    expect(result.status).toBe("NEEDS_REVIEW");
  });
});
