import { ProjectAnalyticsService } from "./project-analytics.service";

const ws = { id: "ws1", role: "OWNER" as const };

function makeProjectsStub() {
  return { findOneOrThrow: async () => ({ id: "proj1", workspaceId: "ws1" }) };
}

describe("ProjectAnalyticsService.funnel", () => {
  it("returns the seven fixed funnel stages built from real counts, in order", async () => {
    const counts = { company: 8, prospectQualified: 4, prospectNeedsReview: 2, msgTotal: 3, msgQaOk: 2, msgApproved: 1, msgSent: 1 };
    const prisma = {
      company: { count: async () => counts.company },
      prospect: {
        count: async ({ where }: { where: { status?: string } }) => (where.status === "QUALIFIED" ? counts.prospectQualified : where.status === "NEEDS_REVIEW" ? counts.prospectNeedsReview : 0),
      },
      message: {
        count: async ({ where }: { where: { qaStatus?: unknown; reviewStatus?: string; sendStatus?: unknown } }) => {
          if (where.reviewStatus === "APPROVED") return counts.msgApproved;
          if (where.sendStatus) return counts.msgSent;
          if (where.qaStatus) return counts.msgQaOk;
          return counts.msgTotal;
        },
      },
    };
    const service = new ProjectAnalyticsService(prisma as never, makeProjectsStub() as never);

    const funnel = await service.funnel(ws, "proj1");

    expect(funnel.stages.map((s) => s.key)).toEqual(["companies", "qualified", "needs_review", "emails_generated", "qa_passed_or_warned", "human_approved", "sent"]);
    expect(funnel.stages.find((s) => s.key === "companies")!.count).toBe(8);
    expect(funnel.stages.find((s) => s.key === "qualified")!.count).toBe(4);
    expect(funnel.stages.find((s) => s.key === "sent")!.count).toBe(1);
  });
});

describe("ProjectAnalyticsService.qualification", () => {
  it("buckets scores/coverage into 20-point ranges and reports a 'No data' bucket for nulls", async () => {
    const prisma = {
      prospect: {
        count: async () => 0,
        findMany: async () => [{ score: 85, coverage: 90 }, { score: 15, coverage: 10 }, { score: null, coverage: null }],
      },
    };
    const service = new ProjectAnalyticsService(prisma as never, makeProjectsStub() as never);

    const result = await service.qualification(ws, "proj1");

    expect(result.scoreDistribution).toEqual([
      { bucket: "0-19", count: 1 },
      { bucket: "20-39", count: 0 },
      { bucket: "40-59", count: 0 },
      { bucket: "60-79", count: 0 },
      { bucket: "80-100", count: 1 },
      { bucket: "No data", count: 1 },
    ]);
  });
});

describe("ProjectAnalyticsService.criteria", () => {
  it("dedupes to one verdict per (prospect, criterion), preferring POST_ENRICHMENT over INITIAL", async () => {
    const prisma = {
      qualificationResult: {
        findMany: async () => [
          { prospectId: "p1", criterionId: "c1", criterionLabel: "Industry", status: "FAIL", phase: "INITIAL" },
          { prospectId: "p1", criterionId: "c1", criterionLabel: "Industry", status: "PASS", phase: "POST_ENRICHMENT" },
          { prospectId: "p2", criterionId: "c1", criterionLabel: "Industry", status: "UNKNOWN", phase: "INITIAL" },
        ],
      },
    };
    const service = new ProjectAnalyticsService(prisma as never, makeProjectsStub() as never);

    const result = await service.criteria(ws, "proj1");

    expect(result).toEqual([{ criterionId: "c1", label: "Industry", pass: 1, fail: 0, unknown: 1 }]);
  });
});

describe("ProjectAnalyticsService.aiUsage", () => {
  it("scopes AiRun rows to this project by exact refType/refId match, excluding rows from other projects", async () => {
    const prisma = {
      icpProfile: { findMany: async () => [{ id: "icp-proj1" }] },
      dataSource: { findMany: async () => [] },
      prospect: { findMany: async () => [] },
      message: { findMany: async () => [] },
      company: { findMany: async () => [] },
      aiRun: {
        findMany: async () => [
          { providerKey: "gemini", model: "gemini-3.6-flash", purpose: "ICP_EXTRACTION", refType: "icp_profile", refId: "icp-proj1", inputTokens: 100, outputTokens: 50, costUsd: 0.01 },
          { providerKey: "gemini", model: "gemini-3.6-flash", purpose: "ICP_EXTRACTION", refType: "icp_profile", refId: "icp-OTHER-PROJECT", inputTokens: 999, outputTokens: 999, costUsd: 9 },
        ],
      },
    };
    const service = new ProjectAnalyticsService(prisma as never, makeProjectsStub() as never);

    const result = await service.aiUsage(ws, "proj1");

    expect(result).toEqual([{ providerKey: "gemini", model: "gemini-3.6-flash", purpose: "ICP_EXTRACTION", calls: 1, inputTokens: 100, outputTokens: 50, costUsd: 0.01, cacheHits: 0 }]);
  });

  it("reports cache-hit rows as their own 'cache' entries without inventing token/cost values", async () => {
    const prisma = {
      icpProfile: { findMany: async () => [{ id: "icp-proj1" }] },
      dataSource: { findMany: async () => [] },
      prospect: { findMany: async () => [] },
      message: { findMany: async () => [] },
      company: { findMany: async () => [] },
      aiRun: {
        findMany: async () => [
          { providerKey: "cache", model: "cache", purpose: "QUALITATIVE_ASSESS", refType: "qualitative_cache", refId: "icp-proj1:crit1:hash1", inputTokens: 0, outputTokens: 0, costUsd: null },
          { providerKey: "cache", model: "cache", purpose: "QUALITATIVE_ASSESS", refType: "qualitative_cache", refId: "icp-proj1:crit1:hash2", inputTokens: 0, outputTokens: 0, costUsd: null },
        ],
      },
    };
    const service = new ProjectAnalyticsService(prisma as never, makeProjectsStub() as never);

    const result = await service.aiUsage(ws, "proj1");

    expect(result).toEqual([{ providerKey: "cache", model: "cache", purpose: "QUALITATIVE_ASSESS", calls: 2, inputTokens: 0, outputTokens: 0, costUsd: null, cacheHits: 2 }]);
  });

  it("scopes a qualitative_batch run by whether ANY of its comma-separated company ids belongs to this project", async () => {
    const prisma = {
      icpProfile: { findMany: async () => [] },
      dataSource: { findMany: async () => [] },
      prospect: { findMany: async () => [] },
      message: { findMany: async () => [] },
      company: { findMany: async () => [{ id: "co1" }, { id: "co2" }] },
      aiRun: {
        findMany: async () => [
          { providerKey: "anthropic", model: "haiku", purpose: "QUALITATIVE_ASSESS", refType: "qualitative_batch", refId: "hiring_sales:co1,co9", inputTokens: 10, outputTokens: 5, costUsd: null },
          { providerKey: "anthropic", model: "haiku", purpose: "QUALITATIVE_ASSESS", refType: "qualitative_batch", refId: "hiring_sales:co9,co10", inputTokens: 999, outputTokens: 999, costUsd: null },
        ],
      },
    };
    const service = new ProjectAnalyticsService(prisma as never, makeProjectsStub() as never);

    const result = await service.aiUsage(ws, "proj1");

    expect(result).toEqual([{ providerKey: "anthropic", model: "haiku", purpose: "QUALITATIVE_ASSESS", calls: 1, inputTokens: 10, outputTokens: 5, costUsd: null, cacheHits: 0 }]);
  });
});

describe("ProjectAnalyticsService.enrichmentUsage", () => {
  it("aggregates field counts and cost units per provider from EnrichmentRun rows", async () => {
    const prisma = {
      enrichmentRun: {
        findMany: async () => [
          { providerKey: "mock_enrichment", requestedFields: ["a", "b"], suppliedFields: ["a"], unavailableFields: ["b"], costUnits: 1 },
          { providerKey: "mock_enrichment", requestedFields: ["c"], suppliedFields: ["c"], unavailableFields: [], costUnits: 1 },
        ],
      },
    };
    const service = new ProjectAnalyticsService(prisma as never, makeProjectsStub() as never);

    const result = await service.enrichmentUsage(ws, "proj1");

    expect(result).toEqual([{ providerKey: "mock_enrichment", calls: 2, fieldsRequested: 3, fieldsSupplied: 2, fieldsUnavailable: 1, costUnits: 2 }]);
  });
});
