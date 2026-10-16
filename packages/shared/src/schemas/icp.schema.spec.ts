import {
  IcpDraftDefinition,
  IcpDefinition,
  checkActivatable,
  reconcileClarifications,
  clarificationId,
  type Clarification,
  type LlmClarification,
} from "./icp.schema";

const baseCriterion = {
  id: "industry_saas",
  label: "Industry is SaaS",
  kind: "DETERMINISTIC" as const,
  field: "firmographics.industry" as const,
  operator: "IN" as const,
  value: ["software_saas"],
  weight: 8,
  required: true,
  enrichIfMissing: true,
};

const blocking: Clarification = {
  id: "clar:general:ambiguous_scope",
  type: "ambiguous_scope",
  question: "What employee range do you mean by mid-size?",
  severity: "BLOCKING",
  answer: null,
  proposedDefault: "100-500 employees",
  resolvedBy: "UNRESOLVED",
};

describe("IcpDraftDefinition", () => {
  it("accepts a zero-criteria draft with an unresolved blocking clarification", () => {
    const r = IcpDraftDefinition.safeParse({ schemaVersion: 1, clarifications: [blocking] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.criteria).toEqual([]);
      expect(r.data.name).toBe("Untitled ICP");
    }
  });

  it("rejects duplicate clarification ids", () => {
    const r = IcpDraftDefinition.safeParse({ schemaVersion: 1, clarifications: [blocking, blocking] });
    expect(r.success).toBe(false);
  });

  it("rejects USER-resolved clarification without an answer", () => {
    const r = IcpDraftDefinition.safeParse({
      schemaVersion: 1,
      clarifications: [{ ...blocking, resolvedBy: "USER", answer: "  " }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects DEFAULT-resolved clarification without a proposed default", () => {
    const r = IcpDraftDefinition.safeParse({
      schemaVersion: 1,
      clarifications: [{ ...blocking, severity: "MINOR", resolvedBy: "DEFAULT", proposedDefault: undefined }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a clarification whose id does not match criterionId/type", () => {
    const r = IcpDraftDefinition.safeParse({
      schemaVersion: 1,
      clarifications: [{ ...blocking, id: "clar:general:numeric_bound" }],
    });
    expect(r.success).toBe(false);
  });
});

describe("IcpDefinition (strict)", () => {
  it("rejects zero criteria", () => {

    const check = checkActivatable({ schemaVersion: 1, name: "x", criteria: [] });
    expect(check.activatable).toBe(false);
    expect(check.blockers.some((b) => b.message.includes("at least one criterion"))).toBe(true);
  });

  it("rejects when no criterion has weight > 0", () => {
    const check = checkActivatable({ schemaVersion: 1, name: "x", criteria: [{ ...baseCriterion, weight: 0 }] });
    expect(check.activatable).toBe(false);
    expect(check.blockers.some((b) => b.message.includes("weight > 0"))).toBe(true);
  });

  it("rejects open BLOCKING clarifications", () => {
    const check = checkActivatable({ schemaVersion: 1, name: "x", criteria: [baseCriterion], clarifications: [blocking] });
    expect(check.activatable).toBe(false);
    expect(check.blockers.some((b) => b.message.includes("unresolved blocking"))).toBe(true);
  });

  it("rejects duplicate criterion ids", () => {
    const r = IcpDefinition.safeParse({ schemaVersion: 1, name: "x", criteria: [baseCriterion, baseCriterion] });
    expect(r.success).toBe(false);
  });

  it("accepts a valid ICP with a USER-resolved blocking clarification", () => {
    const check = checkActivatable({
      schemaVersion: 1,
      name: "US SaaS",
      criteria: [baseCriterion],
      clarifications: [{ ...blocking, resolvedBy: "USER", answer: "100-500" }],
    });
    expect(check.activatable).toBe(true);
  });

  it("rejects an invalid scoring policy", () => {
    const r = IcpDefinition.safeParse({
      schemaVersion: 1,
      name: "x",
      criteria: [baseCriterion],
      scoring: { qualifiedThreshold: 40, needsReviewThreshold: 70 },
    });
    expect(r.success).toBe(false);
  });
});

describe("reconcileClarifications", () => {
  const proposal: LlmClarification = {
    type: "ambiguous_scope",
    question: "What employee range do you mean by mid-size?",
    severity: "BLOCKING",
    proposedDefault: "100-500 employees",
  };

  it("assigns deterministic ids and marks blocking proposals UNRESOLVED", () => {
    const out = reconcileClarifications([], [proposal]);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(clarificationId(proposal));
    expect(out[0]!.resolvedBy).toBe("UNRESOLVED");
  });

  it("dedupes proposals with the same criterionId + type", () => {
    const out = reconcileClarifications([], [proposal, { ...proposal, question: "Other wording" }]);
    expect(out).toHaveLength(1);
  });

  it("carries forward USER answers across turns", () => {
    const prev: Clarification[] = [{ ...blocking, resolvedBy: "USER", answer: "100-500" }];
    const out = reconcileClarifications(prev, [proposal]);
    expect(out[0]!.resolvedBy).toBe("USER");
    expect(out[0]!.answer).toBe("100-500");
  });

  it("marks MINOR proposals with a default as DEFAULT", () => {
    const out = reconcileClarifications([], [{ ...proposal, severity: "MINOR" }]);
    expect(out[0]!.resolvedBy).toBe("DEFAULT");
  });

  it("keeps USER-resolved clarifications the LLM no longer raises", () => {
    const prev: Clarification[] = [{ ...blocking, resolvedBy: "USER", answer: "100-500" }];
    const out = reconcileClarifications(prev, []);
    expect(out).toHaveLength(1);
    expect(out[0]!.resolvedBy).toBe("USER");
  });

  it("produces output that validates against IcpDraftDefinition", () => {
    const out = reconcileClarifications([], [proposal, { ...proposal, type: "numeric_bound", severity: "MINOR" }]);
    const r = IcpDraftDefinition.safeParse({ schemaVersion: 1, clarifications: out });
    expect(r.success).toBe(true);
  });
});
