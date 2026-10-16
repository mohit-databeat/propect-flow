import { randomUUID } from "node:crypto";
import type { CanonicalCompany, IcpDefinition } from "@prospect/shared";
import { QualificationService } from "./qualification.service";
import { NormalizersService } from "../normalization/normalizers";

interface FakeProspect {
  id: string;
  projectId: string;
  workflowRunId: string;
  companyId: string;
  icpProfileId: string;
  status: string;
  score: number | null;
  coverage: number | null;
  summary: unknown;
  aiReasoning: string | null;
}
interface FakeResult {
  id: string;
  prospectId: string;
  criterionId: string;
  phase: string;
  criterionLabel: string;
  status: string;
  weight: number;
  required: boolean;
  evaluator: string;
  reason: string;
  confidence: number | null;
  missingFields: string[];
}
interface FakeEvidence {
  id: string;
  qualificationResultId: string;
  companyAttributeId: string | null;
  kind: string;
  content: unknown;
  sourceRef: string | null;
}

function makeFakePrisma(
  icpProfile: { id: string; definition: IcpDefinition },
  company: { id: string; projectId: string; canonical: CanonicalCompany },
  extraCompanies: { id: string; projectId: string; canonical: CanonicalCompany }[] = [],
) {
  const prospects: FakeProspect[] = [];
  const results: FakeResult[] = [];
  const evidence: FakeEvidence[] = [];
  const allCompanies = [company, ...extraCompanies];

  return {
    icpProfile: { findUniqueOrThrow: async () => icpProfile },
    company: {
      findUniqueOrThrow: async () => company,
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => allCompanies.filter((c) => where.id.in.includes(c.id)),
    },
    prospect: {
      upsert: async ({ where, create, update }: { where: { workflowRunId_companyId: { workflowRunId: string; companyId: string } }; create: Omit<FakeProspect, "id">; update: Partial<FakeProspect> }) => {
        const key = where.workflowRunId_companyId;
        const existing = prospects.find((p) => p.workflowRunId === key.workflowRunId && p.companyId === key.companyId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row: FakeProspect = { id: randomUUID(), ...create };
        prospects.push(row);
        return row;
      },
    },
    qualificationResult: {
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { prospectId_criterionId_phase: { prospectId: string; criterionId: string; phase: string } };
        create: Omit<FakeResult, "id">;
        update: Partial<FakeResult>;
      }) => {
        const key = where.prospectId_criterionId_phase;
        const existing = results.find((r) => r.prospectId === key.prospectId && r.criterionId === key.criterionId && r.phase === key.phase);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row: FakeResult = { id: randomUUID(), ...create };
        results.push(row);
        return row;
      },
    },
    evidence: {
      deleteMany: async ({ where }: { where: { qualificationResultId: string } }) => {
        const before = evidence.length;
        for (let i = evidence.length - 1; i >= 0; i--) {
          if (evidence[i]!.qualificationResultId === where.qualificationResultId) evidence.splice(i, 1);
        }
        return { count: before - evidence.length };
      },
      create: async ({ data }: { data: Omit<FakeEvidence, "id"> }) => {
        const row: FakeEvidence = { id: randomUUID(), ...data };
        evidence.push(row);
        return row;
      },
    },
    __prospects: prospects,
    __results: results,
    __evidence: evidence,
  };
}

const BASE_ICP: IcpDefinition = {
  schemaVersion: 1,
  name: "Test ICP",
  summary: "",
  targetPersonas: [],
  clarifications: [],
  scoring: { qualifiedThreshold: 70, needsReviewThreshold: 40, minCoverage: 60, unknownRequiredPolicy: "NEEDS_REVIEW" },
  criteria: [
    { id: "country_us", label: "US", kind: "DETERMINISTIC", field: "firmographics.country", operator: "EQ", value: "US", weight: 8, required: true, enrichIfMissing: true },
    {
      id: "hiring_sales",
      label: "Hiring salespeople",
      kind: "QUALITATIVE",
      operator: "LLM_ASSESS",
      question: "Is this company hiring salespeople?",
      passRubric: "PASS if a sales role is open",
      evidenceFields: ["signals.hiring"],
      requiredEvidenceFields: ["signals.hiring"],
      minConfidence: 60,
      weight: 5,
      required: false,
      enrichIfMissing: true,
    },
  ],
};

function makeCanonical(overrides: Partial<CanonicalCompany> = {}): CanonicalCompany {
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

describe("QualificationService", () => {
  it("persists evidence that points at the winning CompanyAttribute id", async () => {
    const canonical = makeCanonical({
      firmographics: { country: "US" },
      provenance: { "firmographics.country": { attributeId: "attr-1", sourceType: "SOURCE", providerKey: "mock_apollo", confidence: 100, observedAt: new Date().toISOString(), authoritative: false } },
    });
    const prisma = makeFakePrisma({ id: "icp1", definition: BASE_ICP }, { id: "company1", projectId: "proj1", canonical });
    const service = new QualificationService(prisma as never, new NormalizersService(), {} as never);

    await service.qualifyCompany({ runId: "run1", companyId: "company1", icpProfileId: "icp1", phase: "INITIAL" });

    const countryResult = prisma.__results.find((r) => r.criterionId === "country_us")!;
    const linkedEvidence = prisma.__evidence.find((e) => e.qualificationResultId === countryResult.id)!;
    expect(linkedEvidence.companyAttributeId).toBe("attr-1");
  });

  it("keeps a QUALITATIVE criterion UNKNOWN in Phase 4 with the pending-assessment reason", async () => {
    const canonical = makeCanonical({ firmographics: { country: "US" } });
    const prisma = makeFakePrisma({ id: "icp1", definition: BASE_ICP }, { id: "company1", projectId: "proj1", canonical });
    const service = new QualificationService(prisma as never, new NormalizersService(), {} as never);

    await service.qualifyCompany({ runId: "run1", companyId: "company1", icpProfileId: "icp1", phase: "INITIAL" });

    const hiringResult = prisma.__results.find((r) => r.criterionId === "hiring_sales")!;
    expect(hiringResult.status).toBe("UNKNOWN");
    expect(hiringResult.evaluator).toBe("LLM");
    expect(hiringResult.reason).toMatch(/pending POST_ENRICHMENT/i);
  });

  it("computes missingFields from UNKNOWN criteria with enrichIfMissing=true", async () => {
    const canonical = makeCanonical();
    const prisma = makeFakePrisma({ id: "icp1", definition: BASE_ICP }, { id: "company1", projectId: "proj1", canonical });
    const service = new QualificationService(prisma as never, new NormalizersService(), {} as never);

    const result = await service.qualifyCompany({ runId: "run1", companyId: "company1", icpProfileId: "icp1", phase: "INITIAL" });
    expect(result.missingFields).toEqual(expect.arrayContaining(["firmographics.country", "signals.hiring"]));
  });

  it("makes Linear-style companies (required employeeCount UNKNOWN) NEEDS_REVIEW deterministically", async () => {
    const icp: IcpDefinition = {
      ...BASE_ICP,
      criteria: [
        { id: "employees", label: "100-500 employees", kind: "DETERMINISTIC", field: "firmographics.employeeCount", operator: "BETWEEN", value: { min: 100, max: 500 }, weight: 7, required: true, enrichIfMissing: true },
      ],
    };
    const canonical = makeCanonical();
    const prisma = makeFakePrisma({ id: "icp1", definition: icp }, { id: "company1", projectId: "proj1", canonical });
    const service = new QualificationService(prisma as never, new NormalizersService(), {} as never);

    const result = await service.qualifyCompany({ runId: "run1", companyId: "company1", icpProfileId: "icp1", phase: "INITIAL" });
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.score).toBeNull();
  });

  it("re-qualifying the same run+company is idempotent: one Prospect, one result per criterion, no duplicate evidence", async () => {
    const canonical = makeCanonical({
      firmographics: { country: "US" },
      provenance: { "firmographics.country": { attributeId: "attr-1", sourceType: "SOURCE", providerKey: "mock_apollo", confidence: 100, observedAt: new Date().toISOString(), authoritative: false } },
    });
    const prisma = makeFakePrisma({ id: "icp1", definition: BASE_ICP }, { id: "company1", projectId: "proj1", canonical });
    const service = new QualificationService(prisma as never, new NormalizersService(), {} as never);

    await service.qualifyCompany({ runId: "run1", companyId: "company1", icpProfileId: "icp1", phase: "INITIAL" });
    await service.qualifyCompany({ runId: "run1", companyId: "company1", icpProfileId: "icp1", phase: "INITIAL" });

    expect(prisma.__prospects).toHaveLength(1);
    expect(prisma.__results.filter((r) => r.criterionId === "country_us")).toHaveLength(1);
    expect(prisma.__evidence.filter((e) => e.qualificationResultId === prisma.__results[0]!.id)).toHaveLength(1);
  });
});

describe("QualificationService.requalifyCompanies", () => {
  it("adds a POST_ENRICHMENT row alongside the existing INITIAL row — never overwrites INITIAL", async () => {
    const company = { id: "company1", projectId: "proj1", canonical: makeCanonical() };
    const prisma = makeFakePrisma({ id: "icp1", definition: BASE_ICP }, company);
    const qualitative = { assessForCompanies: jest.fn(async () => new Map([["company1", { status: "UNKNOWN" as const, reason: "n/a", missingFields: [] }]])) };
    const service = new QualificationService(prisma as never, new NormalizersService(), qualitative as never);

    await service.qualifyCompany({ runId: "run1", companyId: "company1", icpProfileId: "icp1", phase: "INITIAL" });
    expect(prisma.__results.find((r) => r.criterionId === "country_us" && r.phase === "INITIAL")!.status).toBe("UNKNOWN");

    company.canonical = makeCanonical({
      firmographics: { country: "US" },
      provenance: { "firmographics.country": { attributeId: "attr-1", sourceType: "ENRICHMENT", providerKey: "mock_enrichment", confidence: 85, observedAt: new Date().toISOString(), authoritative: false } },
    });

    await service.requalifyCompanies(["company1"], "icp1", "run1", {
      workspaceId: "ws1",
      projectId: "proj1",
      batchSize: 10,
      budget: { used: 0, max: 50 },
    });

    const initialRow = prisma.__results.find((r) => r.criterionId === "country_us" && r.phase === "INITIAL")!;
    const postRow = prisma.__results.find((r) => r.criterionId === "country_us" && r.phase === "POST_ENRICHMENT")!;
    expect(initialRow.status).toBe("UNKNOWN");
    expect(postRow.status).toBe("PASS");
    expect(prisma.__results.filter((r) => r.criterionId === "country_us")).toHaveLength(2);
  });

  it("skips the qualitative/LLM pass entirely for a company that already failed a required criterion", async () => {
    const icp: IcpDefinition = {
      ...BASE_ICP,
      criteria: [
        { id: "country_us", label: "US", kind: "DETERMINISTIC", field: "firmographics.country", operator: "EQ", value: "US", weight: 8, required: true, enrichIfMissing: true },
        BASE_ICP.criteria[1]!,
      ],
    };
    const failingCanonical = makeCanonical({ firmographics: { country: "CA" }, provenance: { "firmographics.country": { attributeId: "attr-1", sourceType: "SOURCE", providerKey: "csv", confidence: 100, observedAt: new Date().toISOString(), authoritative: false } } });
    const prisma = makeFakePrisma({ id: "icp1", definition: icp }, { id: "company1", projectId: "proj1", canonical: failingCanonical });
    const qualitative = { assessForCompanies: jest.fn(async () => new Map()) };
    const service = new QualificationService(prisma as never, new NormalizersService(), qualitative as never);

    await service.qualifyCompany({ runId: "run1", companyId: "company1", icpProfileId: "icp1", phase: "INITIAL" });
    const result = await service.requalifyCompanies(["company1"], "icp1", "run1", { workspaceId: "ws1", projectId: "proj1", batchSize: 10, budget: { used: 0, max: 50 } });

    expect(qualitative.assessForCompanies).not.toHaveBeenCalled();
    expect(result.get("company1")!.status).toBe("DISQUALIFIED");
    const hiringRow = prisma.__results.find((r) => r.criterionId === "hiring_sales" && r.phase === "POST_ENRICHMENT")!;
    expect(hiringRow.status).toBe("UNKNOWN");
    expect(hiringRow.reason).toMatch(/skipped: a required criterion failed/);
  });

  it("moves a company from UNKNOWN to QUALIFIED once enrichment fills a required field and the qualitative pass returns PASS", async () => {
    const enrichedCanonical = makeCanonical({
      firmographics: { country: "US" },
      provenance: { "firmographics.country": { attributeId: "attr-1", sourceType: "ENRICHMENT", providerKey: "mock_enrichment", confidence: 85, observedAt: new Date().toISOString(), authoritative: false } },
      signals: { hiring: { items: [{ title: "Account Executive" }], authoritative: true }, funding: { items: [], authoritative: false }, news: { items: [], authoritative: false }, expansion: { items: [], authoritative: false } },
    });
    const prisma = makeFakePrisma({ id: "icp1", definition: BASE_ICP }, { id: "company1", projectId: "proj1", canonical: enrichedCanonical });
    const qualitative = { assessForCompanies: jest.fn(async () => new Map([["company1", { status: "PASS" as const, reason: "hiring AE", confidence: 88, missingFields: [] }]])) };
    const service = new QualificationService(prisma as never, new NormalizersService(), qualitative as never);

    const result = await service.requalifyCompanies(["company1"], "icp1", "run1", { workspaceId: "ws1", projectId: "proj1", batchSize: 10, budget: { used: 0, max: 50 } });

    expect(result.get("company1")!.status).toBe("QUALIFIED");
    expect(qualitative.assessForCompanies).toHaveBeenCalledTimes(1);
  });
});
