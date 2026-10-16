import type { IcpCriterion, IcpDefinition } from "@prospect/shared";
import type { CriterionVerdict } from "./deterministic-evaluator";

export interface CriterionOutcome {
  criterion: IcpCriterion;
  status: CriterionVerdict;
}

export type ProspectStatus = "PENDING" | "QUALIFIED" | "DISQUALIFIED" | "NEEDS_REVIEW";

export interface ScoringResult {
  status: ProspectStatus;
  score: number | null;
  coverage: number;
  knownWeight: number;
  totalWeight: number;
  requiredFails: string[];
  requiredUnknowns: string[];
}

export function computeScoring(icp: IcpDefinition, outcomes: CriterionOutcome[]): ScoringResult {
  let knownWeight = 0;
  let passWeight = 0;
  let totalWeight = 0;
  const requiredFails: string[] = [];
  const requiredUnknowns: string[] = [];

  for (const { criterion, status } of outcomes) {
    totalWeight += criterion.weight;
    if (status !== "UNKNOWN") {
      knownWeight += criterion.weight;
      if (status === "PASS") passWeight += criterion.weight;
    }
    if (criterion.required && status === "FAIL") requiredFails.push(criterion.id);
    if (criterion.required && status === "UNKNOWN") requiredUnknowns.push(criterion.id);
  }

  const score = knownWeight > 0 ? Math.round((100 * passWeight) / knownWeight) : null;
  const coverage = totalWeight > 0 ? Math.round((100 * knownWeight) / totalWeight) : 0;

  if (requiredFails.length > 0) {
    return { status: "DISQUALIFIED", score, coverage, knownWeight, totalWeight, requiredFails, requiredUnknowns };
  }
  if (requiredUnknowns.length > 0) {
    const status: ProspectStatus = icp.scoring.unknownRequiredPolicy === "DISQUALIFY" ? "DISQUALIFIED" : "NEEDS_REVIEW";
    return { status, score, coverage, knownWeight, totalWeight, requiredFails, requiredUnknowns };
  }
  if (knownWeight === 0) {
    return { status: "NEEDS_REVIEW", score: null, coverage: 0, knownWeight, totalWeight, requiredFails, requiredUnknowns };
  }
  if (score! >= icp.scoring.qualifiedThreshold && coverage >= icp.scoring.minCoverage) {
    return { status: "QUALIFIED", score, coverage, knownWeight, totalWeight, requiredFails, requiredUnknowns };
  }
  if (score! < icp.scoring.needsReviewThreshold) {
    return { status: "DISQUALIFIED", score, coverage, knownWeight, totalWeight, requiredFails, requiredUnknowns };
  }
  return { status: "NEEDS_REVIEW", score, coverage, knownWeight, totalWeight, requiredFails, requiredUnknowns };
}
