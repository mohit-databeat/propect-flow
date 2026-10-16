import type { CanonicalCompany, DeterministicCriterion } from "@prospect/shared";
import { evaluateDeterministic } from "./deterministic-evaluator";

const keys = {
  isKnownIndustryKey: (v: string) => v === "software_saas" || v === "fintech_payments",
  isKnownTechnologyKey: (v: string) => v === "salesforce" || v === "marketo",
  isKnownCountryCode: (v: string) => /^[A-Z]{2}$/.test(v),
};

function canonical(overrides: Partial<CanonicalCompany> = {}): CanonicalCompany {
  return {
    schemaVersion: 1,
    identity: { name: "Acme" },
    firmographics: {},
    technographics: { stack: { items: [], authoritative: false } },
    signals: { hiring: { items: [], authoritative: false }, funding: { items: [], authoritative: false }, news: { items: [], authoritative: false }, expansion: { items: [], authoritative: false } },
    provenance: {},
    ...overrides,
  };
}

const crit = <O extends DeterministicCriterion["operator"]>(overrides: Partial<DeterministicCriterion> & { operator: O }): DeterministicCriterion =>
  ({ id: "c1", label: "c1", kind: "DETERMINISTIC", weight: 5, required: false, enrichIfMissing: true, field: "firmographics.country", value: "US", ...overrides }) as DeterministicCriterion;

describe("evaluateDeterministic — scalar operators", () => {
  it("EQ passes and fails", () => {
    const c = canonical({ firmographics: { country: "US" } });
    expect(evaluateDeterministic(crit({ operator: "EQ", field: "firmographics.country", value: "US" }), c, keys).status).toBe("PASS");
    expect(evaluateDeterministic(crit({ operator: "EQ", field: "firmographics.country", value: "CA" }), c, keys).status).toBe("FAIL");
  });

  it("NEQ passes and fails", () => {
    const c = canonical({ firmographics: { country: "US" } });
    expect(evaluateDeterministic(crit({ operator: "NEQ", field: "firmographics.country", value: "CA" }), c, keys).status).toBe("PASS");
    expect(evaluateDeterministic(crit({ operator: "NEQ", field: "firmographics.country", value: "US" }), c, keys).status).toBe("FAIL");
  });

  it("IN passes and fails", () => {
    const c = canonical({ firmographics: { industry: "software_saas" } });
    expect(evaluateDeterministic(crit({ operator: "IN", field: "firmographics.industry", value: ["software_saas"] }), c, keys).status).toBe("PASS");
    expect(evaluateDeterministic(crit({ operator: "IN", field: "firmographics.industry", value: ["fintech_payments"] }), c, keys).status).toBe("FAIL");
  });

  it("NOT_IN passes and fails", () => {
    const c = canonical({ firmographics: { industry: "software_saas" } });
    expect(evaluateDeterministic(crit({ operator: "NOT_IN", field: "firmographics.industry", value: ["fintech_payments"] }), c, keys).status).toBe("PASS");
    expect(evaluateDeterministic(crit({ operator: "NOT_IN", field: "firmographics.industry", value: ["software_saas"] }), c, keys).status).toBe("FAIL");
  });

  it("GTE passes and fails", () => {
    const c = canonical({ firmographics: { revenueUsd: 10_000_000 } });
    expect(evaluateDeterministic(crit({ operator: "GTE", field: "firmographics.revenueUsd", value: 5_000_000 }), c, keys).status).toBe("PASS");
    expect(evaluateDeterministic(crit({ operator: "GTE", field: "firmographics.revenueUsd", value: 20_000_000 }), c, keys).status).toBe("FAIL");
  });

  it("LTE passes and fails", () => {
    const c = canonical({ firmographics: { employeeCount: 300 } });
    expect(evaluateDeterministic(crit({ operator: "LTE", field: "firmographics.employeeCount", value: 500 }), c, keys).status).toBe("PASS");
    expect(evaluateDeterministic(crit({ operator: "LTE", field: "firmographics.employeeCount", value: 100 }), c, keys).status).toBe("FAIL");
  });

  it("BETWEEN passes and fails on an exact employeeCount", () => {
    const c = canonical({ firmographics: { employeeCount: 300 } });
    expect(evaluateDeterministic(crit({ operator: "BETWEEN", field: "firmographics.employeeCount", value: { min: 100, max: 500 } }), c, keys).status).toBe("PASS");
    expect(evaluateDeterministic(crit({ operator: "BETWEEN", field: "firmographics.employeeCount", value: { min: 400, max: 500 } }), c, keys).status).toBe("FAIL");
  });

  it("EXISTS passes when present, UNKNOWN when missing", () => {
    expect(evaluateDeterministic(crit({ operator: "EXISTS", field: "firmographics.hqCity", value: true }), canonical({ firmographics: { hqCity: "SF" } }), keys).status).toBe("PASS");
    expect(evaluateDeterministic(crit({ operator: "EXISTS", field: "firmographics.hqCity", value: true }), canonical(), keys).status).toBe("UNKNOWN");
  });
});

describe("evaluateDeterministic — missing and unmapped data", () => {
  it("a missing scalar is UNKNOWN, not FAIL", () => {
    const result = evaluateDeterministic(crit({ operator: "EQ", field: "firmographics.country", value: "US" }), canonical(), keys);
    expect(result.status).toBe("UNKNOWN");
    expect(result.missingFields).toEqual(["firmographics.country"]);
  });

  it("an unmapped (non-dictionary) industry value is UNKNOWN, not FAIL", () => {
    const c = canonical({ firmographics: { industry: "Underwater Basket Weaving" } });
    const result = evaluateDeterministic(crit({ operator: "IN", field: "firmographics.industry", value: ["software_saas"] }), c, keys);
    expect(result.status).toBe("UNKNOWN");
  });

  it("an unmapped country value is UNKNOWN, not FAIL", () => {
    const c = canonical({ firmographics: { country: "Freedonia" } });
    const result = evaluateDeterministic(crit({ operator: "EQ", field: "firmographics.country", value: "US" }), c, keys);
    expect(result.status).toBe("UNKNOWN");
  });
});

describe("evaluateDeterministic — list groups (CONTAINS_ANY / CONTAINS_ALL / EXISTS)", () => {
  it("CONTAINS_ANY passes and fails on a non-empty authoritative list", () => {
    const c = canonical({ technographics: { stack: { items: [{ key: "salesforce", raw: "Salesforce" }], authoritative: true } } });
    expect(evaluateDeterministic(crit({ operator: "CONTAINS_ANY", field: "technographics.stack", value: ["salesforce"] }), c, keys).status).toBe("PASS");
    expect(evaluateDeterministic(crit({ operator: "CONTAINS_ANY", field: "technographics.stack", value: ["marketo"] }), c, keys).status).toBe("FAIL");
  });

  it("CONTAINS_ALL requires every target key present", () => {
    const c = canonical({ technographics: { stack: { items: [{ key: "salesforce", raw: "Salesforce" }, { key: "marketo", raw: "Marketo" }], authoritative: true } } });
    expect(evaluateDeterministic(crit({ operator: "CONTAINS_ALL", field: "technographics.stack", value: ["salesforce", "marketo"] }), c, keys).status).toBe("PASS");
    expect(evaluateDeterministic(crit({ operator: "CONTAINS_ALL", field: "technographics.stack", value: ["salesforce", "hubspot_crm"] }), c, keys).status).toBe("FAIL");
  });

  it("an empty list that is authoritative is FAIL for CONTAINS_* and EXISTS (genuine absence)", () => {
    const c = canonical({ technographics: { stack: { items: [], authoritative: true } } });
    expect(evaluateDeterministic(crit({ operator: "CONTAINS_ANY", field: "technographics.stack", value: ["salesforce"] }), c, keys).status).toBe("FAIL");
    expect(evaluateDeterministic(crit({ operator: "EXISTS", field: "technographics.stack", value: true }), c, keys).status).toBe("FAIL");
  });

  it("an empty list that is NOT authoritative is UNKNOWN, never FAIL (absence cannot be inferred)", () => {
    const c = canonical({ technographics: { stack: { items: [], authoritative: false } } });
    const containsResult = evaluateDeterministic(crit({ operator: "CONTAINS_ANY", field: "technographics.stack", value: ["salesforce"] }), c, keys);
    const existsResult = evaluateDeterministic(crit({ operator: "EXISTS", field: "technographics.stack", value: true }), c, keys);
    expect(containsResult.status).toBe("UNKNOWN");
    expect(existsResult.status).toBe("UNKNOWN");
  });

  it("CSV-sourced (never-authoritative) empty stack always reads UNKNOWN regardless of operator", () => {
    const c = canonical({ technographics: { stack: { items: [], authoritative: false } } });
    expect(evaluateDeterministic(crit({ operator: "CONTAINS_ALL", field: "technographics.stack", value: ["salesforce"] }), c, keys).status).toBe("UNKNOWN");
  });
});

describe("evaluateDeterministic — employeeCount BETWEEN fallback to employeeRange", () => {
  const icpRange = { min: 100, max: 500 };

  it("a fully-inside bucket (201-500) PASSes when the exact count is missing", () => {
    const c = canonical({ firmographics: { employeeRange: "201-500" } });
    const result = evaluateDeterministic(crit({ operator: "BETWEEN", field: "firmographics.employeeCount", value: icpRange }), c, keys);
    expect(result.status).toBe("PASS");
  });

  it("a fully-outside bucket (501-1000) FAILs", () => {
    const c = canonical({ firmographics: { employeeRange: "501-1000" } });
    const result = evaluateDeterministic(crit({ operator: "BETWEEN", field: "firmographics.employeeCount", value: icpRange }), c, keys);
    expect(result.status).toBe("FAIL");
  });

  it("a bucket straddling the lower boundary (51-200) is UNKNOWN", () => {
    const c = canonical({ firmographics: { employeeRange: "51-200" } });
    const result = evaluateDeterministic(crit({ operator: "BETWEEN", field: "firmographics.employeeCount", value: icpRange }), c, keys);
    expect(result.status).toBe("UNKNOWN");
  });

  it("UNKNOWN with neither employeeCount nor employeeRange present", () => {
    const result = evaluateDeterministic(crit({ operator: "BETWEEN", field: "firmographics.employeeCount", value: icpRange }), canonical(), keys);
    expect(result.status).toBe("UNKNOWN");
    expect(result.missingFields).toContain("firmographics.employeeCount");
  });
});

describe("evaluateDeterministic — evidence points at the winning CompanyAttribute", () => {
  it("returns the provenance attributeId for a PASS", () => {
    const c = canonical({
      firmographics: { country: "US" },
      provenance: { "firmographics.country": { attributeId: "attr-123", sourceType: "SOURCE", providerKey: "csv", confidence: 100, observedAt: new Date().toISOString(), authoritative: false } },
    });
    const result = evaluateDeterministic(crit({ operator: "EQ", field: "firmographics.country", value: "US" }), c, keys);
    expect(result.evidenceAttributeId).toBe("attr-123");
  });
});
