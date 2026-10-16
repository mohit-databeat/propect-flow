import { QualitativeAssessorService, newAssessmentStats, type AssessBatchOptions } from "./qualitative-assessor.service";
import type { AiCallResult } from "../ai/ai.service";
import type { AssessmentOutput, CanonicalCompany, QualitativeCriterion } from "@prospect/shared";

const CRITERION: QualitativeCriterion = {
  id: "hiring_sales",
  label: "Hiring sales/revenue roles",
  kind: "QUALITATIVE",
  operator: "LLM_ASSESS",
  question: "Is this company actively hiring sales or revenue roles?",
  passRubric: "PASS if >=1 open AE/SDR/sales-leadership role posted in the last 90 days.",
  evidenceFields: ["signals.hiring"],
  requiredEvidenceFields: ["signals.hiring"],
  minConfidence: 60,
  weight: 6,
  required: false,
  enrichIfMissing: true,
};

interface HiringSignal {
  title: string;
  postedAt?: string;
}

function makeCanonical(hiring: { items: HiringSignal[]; authoritative: boolean } | undefined, attributeId = "attr-hiring"): CanonicalCompany {
  return {
    schemaVersion: 1,
    identity: { name: "Acme" },
    firmographics: {},
    technographics: { stack: { items: [], authoritative: false } },
    signals: {
      hiring: hiring ?? { items: [], authoritative: false },
      funding: { items: [], authoritative: false },
      news: { items: [], authoritative: false },
      expansion: { items: [], authoritative: false },
    },
    provenance: hiring ? { "signals.hiring": { attributeId, sourceType: "SOURCE", providerKey: "mock_apollo", confidence: 90, observedAt: new Date().toISOString(), authoritative: hiring.authoritative } } : {},
  } as CanonicalCompany;
}

function baseOpts(overrides: Partial<AssessBatchOptions> = {}): AssessBatchOptions {
  return { workspaceId: "ws1", projectId: "p1", icpProfileId: "icp1", batchSize: 10, budget: { used: 0, max: 50 }, stats: newAssessmentStats(), ...overrides };
}

function makeFakePrisma(cachedRows: { refId: string; output: unknown; id: string }[] = []) {
  const created: Record<string, unknown>[] = [];
  return {
    aiRun: {
      findFirst: async ({ where }: { where: { refId: string } }) => {
        const hit = cachedRows.find((r) => r.refId === where.refId);
        return hit ?? null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `cache-${created.length + 1}`, ...data };
        created.push(row);
        return row;
      },
    },
    __created: created,
  };
}

function makeAi(response: AssessmentOutput, aiRunId = "airun-1") {
  return { assessCriteria: jest.fn(async (_ctx: unknown, _batch: unknown, _refId?: unknown): Promise<AiCallResult<AssessmentOutput>> => ({ data: response, aiRunId })) };
}

describe("QualitativeAssessorService.assessForCompanies", () => {
  it("returns UNKNOWN with no AI call when a required evidence field is missing (not authoritatively empty)", async () => {
    const prisma = makeFakePrisma();
    const ai = makeAi({ results: [] });
    const service = new QualitativeAssessorService(prisma as never, ai as never);
    const opts = baseOpts();

    const out = await service.assessForCompanies(opts, CRITERION, [{ companyId: "c1", canonical: makeCanonical(undefined), resolvedHash: "h1" }]);

    expect(out.get("c1")!.status).toBe("UNKNOWN");
    expect(out.get("c1")!.reason).toMatch(/Missing required evidence/);
    expect(ai.assessCriteria).not.toHaveBeenCalled();
    expect(opts.stats!.missingEvidenceUnknown).toBe(1);
  });

  it("treats an authoritatively-empty evidence field as usable and still calls the LLM", async () => {
    const prisma = makeFakePrisma();
    const ai = makeAi({ results: [{ companyId: "c1", verdict: "FAIL", confidence: 85, reason: "no roles", evidenceRefs: ["attr-hiring"] }] });
    const service = new QualitativeAssessorService(prisma as never, ai as never);
    const opts = baseOpts();

    const out = await service.assessForCompanies(opts, CRITERION, [{ companyId: "c1", canonical: makeCanonical({ items: [], authoritative: true }), resolvedHash: "h1" }]);

    expect(ai.assessCriteria).toHaveBeenCalledTimes(1);
    expect(out.get("c1")!.status).toBe("FAIL");
  });

  it("passes through a valid PASS with evidenceRefs subset of suppliedAttributeIds", async () => {
    const prisma = makeFakePrisma();
    const ai = makeAi({ results: [{ companyId: "c1", verdict: "PASS", confidence: 88, reason: "hiring AE", evidenceRefs: ["attr-hiring"] }] });
    const service = new QualitativeAssessorService(prisma as never, ai as never);
    const canonical = makeCanonical({ items: [{ title: "Account Executive", postedAt: new Date().toISOString() }], authoritative: true });

    const out = await service.assessForCompanies(baseOpts(), CRITERION, [{ companyId: "c1", canonical, resolvedHash: "h1" }]);

    expect(out.get("c1")).toMatchObject({ status: "PASS", confidence: 88, evidenceAttributeIds: ["attr-hiring"] });
  });

  it("downgrades to UNKNOWN when the model cites an evidenceRef outside suppliedAttributeIds", async () => {
    const prisma = makeFakePrisma();
    const ai = makeAi({ results: [{ companyId: "c1", verdict: "PASS", confidence: 90, reason: "hiring", evidenceRefs: ["attr-not-supplied"] }] });
    const service = new QualitativeAssessorService(prisma as never, ai as never);
    const canonical = makeCanonical({ items: [{ title: "Account Executive" }], authoritative: true });

    const out = await service.assessForCompanies(baseOpts(), CRITERION, [{ companyId: "c1", canonical, resolvedHash: "h1" }]);

    expect(out.get("c1")!.status).toBe("UNKNOWN");
    expect(out.get("c1")!.reason).toMatch(/invalid evidence citation/);
  });

  it("downgrades to UNKNOWN when confidence is below the criterion's minConfidence", async () => {
    const prisma = makeFakePrisma();
    const ai = makeAi({ results: [{ companyId: "c1", verdict: "PASS", confidence: 40, reason: "maybe", evidenceRefs: ["attr-hiring"] }] });
    const service = new QualitativeAssessorService(prisma as never, ai as never);
    const canonical = makeCanonical({ items: [{ title: "Account Executive" }], authoritative: true });

    const out = await service.assessForCompanies(baseOpts(), CRITERION, [{ companyId: "c1", canonical, resolvedHash: "h1" }]);

    expect(out.get("c1")!.status).toBe("UNKNOWN");
    expect(out.get("c1")!.reason).toMatch(/below the required minimum/);
  });

  it("drops evidence items outside the criterion's recencyDays window before calling the model", async () => {
    const prisma = makeFakePrisma();
    const ai = makeAi({ results: [{ companyId: "c1", verdict: "FAIL", confidence: 85, reason: "no recent roles", evidenceRefs: [] }] });
    const service = new QualitativeAssessorService(prisma as never, ai as never);
    const stale = new Date(Date.now() - 200 * 86_400_000).toISOString();
    const canonical = makeCanonical({ items: [{ title: "Account Executive", postedAt: stale }], authoritative: true });
    const criterion = { ...CRITERION, recencyDays: 90 };

    await service.assessForCompanies(baseOpts(), criterion, [{ companyId: "c1", canonical, resolvedHash: "h1" }]);

    const requestArg = ai.assessCriteria.mock.calls[0]![1] as { companies: { evidence: Record<string, { items: unknown[] }> }[] };
    expect(requestArg.companies[0]!.evidence["signals.hiring"]!.items).toHaveLength(0);
  });

  it("respects the per-run LLM budget: once exhausted, further companies get UNKNOWN with no AI call", async () => {
    const prisma = makeFakePrisma();
    const ai = makeAi({ results: [{ companyId: "c1", verdict: "PASS", confidence: 90, reason: "hiring", evidenceRefs: ["attr-hiring"] }] });
    const service = new QualitativeAssessorService(prisma as never, ai as never);
    const canonical = makeCanonical({ items: [{ title: "Account Executive" }], authoritative: true });
    const opts = baseOpts({ budget: { used: 0, max: 1 } });

    const out = await service.assessForCompanies(opts, CRITERION, [
      { companyId: "c1", canonical, resolvedHash: "h1" },
      { companyId: "c2", canonical, resolvedHash: "h2" },
    ]);

    expect(out.get("c1")!.status).toBe("PASS");
    expect(out.get("c2")!.status).toBe("UNKNOWN");
    expect(out.get("c2")!.reason).toMatch(/cap reached/);
    expect(opts.stats!.capReached).toBe(1);
  });

  it("batches companies into chunks of batchSize, issuing one AiService call per chunk", async () => {
    const prisma = makeFakePrisma();
    const ai = {
      assessCriteria: jest.fn(async (_ctx: unknown, batch: { companies: { companyId: string }[] }): Promise<AiCallResult<AssessmentOutput>> => ({
        data: { results: batch.companies.map((c) => ({ companyId: c.companyId, verdict: "PASS" as const, confidence: 90, reason: "hiring", evidenceRefs: ["attr-hiring"] })) },
        aiRunId: `run-${Math.random()}`,
      })),
    };
    const service = new QualitativeAssessorService(prisma as never, ai as never);
    const canonical = makeCanonical({ items: [{ title: "Account Executive" }], authoritative: true });
    const companies = Array.from({ length: 5 }, (_, i) => ({ companyId: `c${i}`, canonical, resolvedHash: `h${i}` }));

    await service.assessForCompanies(baseOpts({ batchSize: 2 }), CRITERION, companies);

    expect(ai.assessCriteria).toHaveBeenCalledTimes(3);
  });

  it("reuses a cached assessment for the same (icpProfileId, criterionId, resolvedHash) without calling the AI provider", async () => {
    const cached = { id: "cache-hit-1", refId: "icp1:hiring_sales:hash-same", output: { status: "PASS", reason: "cached", confidence: 90, missingFields: [] } };
    const prisma = makeFakePrisma([cached]);
    const ai = makeAi({ results: [] });
    const service = new QualitativeAssessorService(prisma as never, ai as never);
    const canonical = makeCanonical({ items: [{ title: "Account Executive" }], authoritative: true });
    const opts = baseOpts();

    const out = await service.assessForCompanies(opts, CRITERION, [{ companyId: "c1", canonical, resolvedHash: "hash-same" }]);

    expect(out.get("c1")).toMatchObject({ status: "PASS", reason: "cached" });
    expect(ai.assessCriteria).not.toHaveBeenCalled();
    expect(opts.stats!.cacheHits).toBe(1);
  });

  it("misses the cache when the company's resolvedHash changes (fresh enrichment invalidates the cache)", async () => {
    const cached = { id: "cache-hit-1", refId: "icp1:hiring_sales:hash-old", output: { status: "PASS", reason: "cached", confidence: 90, missingFields: [] } };
    const prisma = makeFakePrisma([cached]);
    const ai = makeAi({ results: [{ companyId: "c1", verdict: "FAIL", confidence: 85, reason: "fresh", evidenceRefs: ["attr-hiring"] }] });
    const service = new QualitativeAssessorService(prisma as never, ai as never);
    const canonical = makeCanonical({ items: [{ title: "Account Executive" }], authoritative: true });

    const out = await service.assessForCompanies(baseOpts(), CRITERION, [{ companyId: "c1", canonical, resolvedHash: "hash-new" }]);

    expect(ai.assessCriteria).toHaveBeenCalledTimes(1);
    expect(out.get("c1")!.reason).toBe("fresh");
  });
});
