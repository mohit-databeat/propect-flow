import { AppException } from "../../../common/errors";
import { ingestOperation } from "./ingest.operation";
import { normalizeOperation } from "./normalize.operation";
import { qualifyOperation } from "./qualify.operation";
import { enrichOperation } from "./enrich.operation";
import { requalifyOperation } from "./requalify.operation";
import { generateEmailOperation } from "./generate-email.operation";
import { qaOperation } from "./qa.operation";

const run = { id: "run1", projectId: "proj1", icpProfileId: "icp1" };

describe("ingestOperation", () => {
  it("skips without touching any source when refresh is off", async () => {
    const findMany = jest.fn();
    const out = await ingestOperation({ prisma: { dataSource: { findMany } } as never, ingestion: {} as never }, { projectId: "proj1", refresh: false });
    expect(out.skipped).toBe(true);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("only syncs sources of the given project, even when other ids are requested", async () => {
    const findMany = jest.fn(async () => [{ id: "ds1", name: "CSV", status: "READY" }]);
    const syncDataSource = jest.fn(async () => ({}));
    const out = await ingestOperation({ prisma: { dataSource: { findMany } } as never, ingestion: { syncDataSource } as never }, { projectId: "proj1", dataSourceIds: ["ds1", "foreign"], refresh: true });

    expect(findMany).toHaveBeenCalledWith({ where: { id: { in: ["ds1", "foreign"] }, projectId: "proj1" } });
    expect(syncDataSource).toHaveBeenCalledTimes(1);
    expect(out.summary).toMatchObject({ refreshed: true, synced: 1 });
  });

  it("records a failing source without stopping the others", async () => {
    const findMany = jest.fn(async () => [
      { id: "a", name: "A", status: "READY" },
      { id: "b", name: "B", status: "READY" },
    ]);
    const syncDataSource = jest.fn(async (id: string) => {
      if (id === "a") throw new Error("boom");
      return {};
    });
    const out = await ingestOperation({ prisma: { dataSource: { findMany } } as never, ingestion: { syncDataSource } as never }, { projectId: "proj1", refresh: true });
    expect(out.summary).toMatchObject({ synced: 1, errors: ["A: boom"] });
  });
});

describe("normalizeOperation", () => {
  const result = (n: number) => ({ normalizationErrors: [], possibleDuplicates: n, newCompanies: n, mergedIntoExisting: 0 });

  it("normalizes the whole project when no sources are given", async () => {
    const normalizePending = jest.fn(async () => result(2));
    const out = await normalizeOperation({ ingestion: { normalizePending } as never }, { projectId: "proj1" });
    expect(normalizePending).toHaveBeenCalledTimes(1);
    expect(normalizePending).toHaveBeenCalledWith({ projectId: "proj1" });
    expect(out.summary).toMatchObject({ newCompanies: 2, possibleDuplicates: 2 });
  });

  it("normalizes each verified source in order and sums the counts", async () => {
    const order: string[] = [];
    const normalizePending = jest.fn(async (scope: { dataSourceId?: string }) => {
      order.push(scope.dataSourceId!);
      return result(1);
    });
    const out = await normalizeOperation({ ingestion: { normalizePending } as never }, { projectId: "proj1", verifiedDataSourceIds: ["a", "b"] });
    expect(order).toEqual(["a", "b"]);
    expect(out.summary).toMatchObject({ newCompanies: 2 });
  });
});

describe("qualifyOperation", () => {
  function setup(statuses: string[], cancelAfter?: number) {
    const findMany = jest.fn(async () => statuses.map((_, i) => ({ id: `c${i}` })));
    let checks = 0;
    const prisma = {
      company: { findMany },
      workflowRun: { findUnique: async () => ({ status: cancelAfter !== undefined && checks++ >= cancelAfter ? "CANCELLED" : "RUNNING" }) },
    };
    const qualifyCompany = jest.fn(async ({ companyId }: { companyId: string }) => ({ prospectId: `p-${companyId}`, status: statuses[Number(companyId.slice(1))] }));
    return { findMany, qualifyCompany, deps: { prisma: prisma as never, qualification: { qualifyCompany } as never } };
  }

  it("evaluates every project company when no ids are given", async () => {
    const { findMany, deps } = setup(["QUALIFIED", "DISQUALIFIED", "NEEDS_REVIEW", "PENDING"]);
    const out = await qualifyOperation(deps, run);
    expect(findMany).toHaveBeenCalledWith({ where: { projectId: "proj1" }, select: { id: true } });
    expect(out.summary).toEqual({ companiesInProject: 4, evaluated: 4, qualified: 1, disqualified: 1, needsReview: 1, pending: 1 });
    expect(out.itemIds).toEqual(["p-c0", "p-c1", "p-c2", "p-c3"]);
  });

  it("restricts to the given ids but always keeps the project filter", async () => {
    const { findMany, deps } = setup(["QUALIFIED"]);
    await qualifyOperation(deps, run, ["c0", "other-project-company"]);
    expect(findMany).toHaveBeenCalledWith({ where: { projectId: "proj1", id: { in: ["c0", "other-project-company"] } }, select: { id: true } });
  });

  it("stops evaluating once the run is cancelled", async () => {
    const { qualifyCompany, deps } = setup(["QUALIFIED", "QUALIFIED", "QUALIFIED"], 1);
    const out = await qualifyOperation(deps, run);
    expect(qualifyCompany).toHaveBeenCalledTimes(1);
    expect(out.summary).toMatchObject({ evaluated: 1 });
  });
});

describe("enrichOperation", () => {
  const prospect = (id: string, companyId: string, summary: object) => ({ id, companyId, summary });

  function setup(opts: { prospects: ReturnType<typeof prospect>[]; enrichedCompanyIds?: string[] }) {
    const prospectFindMany = jest.fn(async () => opts.prospects);
    const enrichmentRunFindMany = jest.fn(async () => (opts.enrichedCompanyIds ?? []).map((companyId) => ({ companyId })));
    const prisma = {
      project: { findUniqueOrThrow: async () => ({ id: "proj1", workspaceId: "ws1" }) },
      workspace: { findUniqueOrThrow: async () => ({ settings: {} }) },
      prospect: { findMany: prospectFindMany },
      enrichmentRun: { findMany: enrichmentRunFindMany },
      workflowRun: { findUnique: async () => ({ status: "RUNNING" }) },
    };
    const enrichCompany = jest.fn(async () => ({ ran: true, requested: ["a", "b"], supplied: ["a"], unavailable: ["b"] }));
    const registry = { getEnricher: () => ({ key: "mock_enrichment" }), ctxFor: () => ({}) };
    return { prospectFindMany, enrichmentRunFindMany, enrichCompany, deps: { prisma: prisma as never, registry: registry as never, enrichment: { enrichCompany } as never } };
  }

  it("enriches only prospects with missing fields and no required failure", async () => {
    const { enrichCompany, deps } = setup({
      prospects: [
        prospect("p1", "c1", { missingFields: ["firmographics.employeeCount"] }),
        prospect("p2", "c2", { missingFields: ["firmographics.employeeCount"], requiredFails: ["industry"] }),
        prospect("p3", "c3", { missingFields: [] }),
      ],
    });
    const out = await enrichOperation(deps, run);
    expect(enrichCompany).toHaveBeenCalledTimes(1);
    expect(enrichCompany).toHaveBeenCalledWith(expect.objectContaining({ companyId: "c1", workflowRunId: "run1" }));
    expect(out.summary).toMatchObject({ considered: 3, eligible: 1, skippedHardFail: 1, enrichmentCalls: 1, fieldsFound: 1, fieldsUnavailable: 1 });
    expect(out.itemIds).toEqual(["p1", "p2", "p3"]);
  });

  it("limits the prospect query to the given ids within this run", async () => {
    const { prospectFindMany, deps } = setup({ prospects: [] });
    await enrichOperation(deps, run, ["p1", "p9"]);
    expect(prospectFindMany).toHaveBeenCalledWith({ where: { workflowRunId: "run1", id: { in: ["p1", "p9"] } } });
  });

  it("does not pay the provider again for a company already enriched in this run (safe retry)", async () => {
    const { enrichCompany, deps } = setup({
      prospects: [prospect("p1", "c1", { missingFields: ["x"] }), prospect("p2", "c2", { missingFields: ["x"] })],
      enrichedCompanyIds: ["c1"],
    });
    const out = await enrichOperation(deps, run);
    expect(enrichCompany).toHaveBeenCalledTimes(1);
    expect(enrichCompany).toHaveBeenCalledWith(expect.objectContaining({ companyId: "c2" }));
    expect(out.summary).toMatchObject({ eligible: 2, alreadyEnriched: 1, enrichmentCalls: 1 });
  });

  it("only treats SUCCEEDED and PARTIAL enrichment runs as already done", async () => {
    const { enrichmentRunFindMany, deps } = setup({ prospects: [prospect("p1", "c1", { missingFields: ["x"] })] });
    await enrichOperation(deps, run);
    expect(enrichmentRunFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workflowRunId: "run1", status: { in: ["SUCCEEDED", "PARTIAL"] } }) }));
  });

  it("skips when nothing is eligible and still passes every prospect on", async () => {
    const { enrichCompany, deps } = setup({ prospects: [prospect("p1", "c1", { missingFields: [] })] });
    const out = await enrichOperation(deps, run);
    expect(out.skipped).toBe(true);
    expect(enrichCompany).not.toHaveBeenCalled();
    expect(out.itemIds).toEqual(["p1"]);
  });
});

describe("requalifyOperation", () => {
  function setup(prospects: { id: string; companyId: string; summary: object }[], status = "RUNNING") {
    const findMany = jest.fn(async () => prospects);
    const requalifyCompanies = jest.fn(async () => new Map(prospects.map((p) => [p.companyId, { status: "QUALIFIED" }])));
    const prisma = {
      project: { findUniqueOrThrow: async () => ({ workspaceId: "ws1" }) },
      prospect: { findMany },
      workflowRun: { findUnique: async () => ({ status }) },
    };
    return { findMany, requalifyCompanies, deps: { prisma: prisma as never, qualification: { requalifyCompanies } as never } };
  }

  it("requalifies only the scoped prospects' companies and uses the supplied budget", async () => {
    const budget = { used: 3, max: 10 };
    const { findMany, requalifyCompanies, deps } = setup([{ id: "p1", companyId: "c1", summary: {} }]);
    const out = await requalifyOperation(deps, run, ["p1"], budget);

    expect(findMany).toHaveBeenCalledWith({ where: { workflowRunId: "run1", id: { in: ["p1"] } } });
    expect(requalifyCompanies).toHaveBeenCalledWith(["c1"], "icp1", "run1", expect.objectContaining({ budget, projectId: "proj1", workspaceId: "ws1" }));
    expect(out.summary).toMatchObject({ considered: 1, qualified: 1 });
    expect(out.itemIds).toEqual(["p1"]);
  });

  it("skips when there are no prospects", async () => {
    const { requalifyCompanies, deps } = setup([]);
    const out = await requalifyOperation(deps, run);
    expect(out.skipped).toBe(true);
    expect(requalifyCompanies).not.toHaveBeenCalled();
  });

  it("does not start when the run was cancelled", async () => {
    const { requalifyCompanies, deps } = setup([{ id: "p1", companyId: "c1", summary: {} }], "CANCELLED");
    const out = await requalifyOperation(deps, run);
    expect(out.skipped).toBe(true);
    expect(requalifyCompanies).not.toHaveBeenCalled();
  });
});

describe("generateEmailOperation", () => {
  function setup(opts: { qualified: { id: string; companyId: string }[]; unsentCompanyIds?: string[]; generateDraft?: jest.Mock }) {
    const prospectFindMany = jest.fn(async () => opts.qualified);
    const prisma = {
      project: { findUniqueOrThrow: async () => ({ workspaceId: "ws1" }) },
      prospect: { findMany: prospectFindMany },
      message: { findMany: async () => (opts.unsentCompanyIds ?? []).map((companyId) => ({ companyId })) },
    };
    const generateDraft = opts.generateDraft ?? jest.fn(async () => ({}));
    return { prospectFindMany, generateDraft, deps: { prisma: prisma as never, messages: { generateDraft } as never } };
  }

  it("limits drafting to the given prospects and only QUALIFIED ones", async () => {
    const { prospectFindMany, deps } = setup({ qualified: [] });
    await generateEmailOperation(deps, run, { prospectIds: ["p1"], cap: 5 });
    expect(prospectFindMany).toHaveBeenCalledWith({ where: { workflowRunId: "run1", status: "QUALIFIED", id: { in: ["p1"] } } });
  });

  it("returns prospects that hold a draft, both pre-existing and new, and drops those with no recipient", async () => {
    const generateDraft = jest.fn(async (_ws: unknown, _proj: string, prospectId: string) => {
      if (prospectId === "p3") throw new AppException(400, "NO_ELIGIBLE_RECIPIENT" as never, "no recipient");
      return {};
    });
    const { deps } = setup({
      qualified: [
        { id: "p1", companyId: "c1" },
        { id: "p2", companyId: "c2" },
        { id: "p3", companyId: "c3" },
      ],
      unsentCompanyIds: ["c1"],
      generateDraft,
    });
    const out = await generateEmailOperation(deps, run, { cap: 5 });
    expect(out.itemIds).toEqual(["p1", "p2"]);
    expect(out.summary).toMatchObject({ qualified: 3, alreadyDrafted: 1, drafted: 1, noRecipient: 1, failed: 0 });
  });

  it("stops at the cap and reports how many were left", async () => {
    const { generateDraft, deps } = setup({
      qualified: [
        { id: "p1", companyId: "c1" },
        { id: "p2", companyId: "c2" },
        { id: "p3", companyId: "c3" },
      ],
    });
    const out = await generateEmailOperation(deps, run, { cap: 2 });
    expect(generateDraft).toHaveBeenCalledTimes(2);
    expect(out.summary).toMatchObject({ drafted: 2, capReached: 1 });
    expect(out.itemIds).toEqual(["p1", "p2"]);
  });

  it("counts unexpected draft failures instead of aborting the batch", async () => {
    const generateDraft = jest.fn(async (_ws: unknown, _proj: string, prospectId: string) => {
      if (prospectId === "p1") throw new Error("provider down");
      return {};
    });
    const { deps } = setup({
      qualified: [
        { id: "p1", companyId: "c1" },
        { id: "p2", companyId: "c2" },
      ],
      generateDraft,
    });
    const out = await generateEmailOperation(deps, run, { cap: 5 });
    expect(out.summary).toMatchObject({ drafted: 1, failed: 1 });
  });

  describe("drafts left over from an earlier run", () => {
    function withLeftover(opts: { adoptExisting?: boolean; draftProspectId: string | null }) {
      const update = jest.fn(async () => ({}));
      const prisma = {
        project: { findUniqueOrThrow: async () => ({ workspaceId: "ws1" }) },
        prospect: { findMany: async () => [{ id: "p-new", companyId: "c1" }] },
        message: { findMany: async () => [{ id: "m-old", companyId: "c1", prospectId: opts.draftProspectId }], update },
      };
      const generateDraft = jest.fn(async () => ({}));
      return { update, generateDraft, run: () => generateEmailOperation({ prisma: prisma as never, messages: { generateDraft } as never }, run, { cap: 5, adoptExisting: opts.adoptExisting }) };
    }

    it("leaves them linked to the old prospect by default, as the classic pipeline always did", async () => {
      const { update, generateDraft, run: go } = withLeftover({ draftProspectId: "p-old" });
      const out = await go();
      expect(update).not.toHaveBeenCalled();
      expect(generateDraft).not.toHaveBeenCalled();
      expect(out.summary).not.toHaveProperty("adopted");
    });

    it("adopts them into this run when asked, so later steps can see them, without drafting again", async () => {
      const { update, generateDraft, run: go } = withLeftover({ adoptExisting: true, draftProspectId: "p-old" });
      const out = await go();
      expect(update).toHaveBeenCalledWith({ where: { id: "m-old" }, data: { prospectId: "p-new" } });
      expect(generateDraft).not.toHaveBeenCalled();
      expect(out.summary).toMatchObject({ alreadyDrafted: 1, drafted: 0, adopted: 1 });
      expect(out.itemIds).toEqual(["p-new"]);
    });

    it("does not touch a draft that already belongs to this prospect", async () => {
      const { update, run: go } = withLeftover({ adoptExisting: true, draftProspectId: "p-new" });
      const out = await go();
      expect(update).not.toHaveBeenCalled();
      expect(out.summary).toMatchObject({ adopted: 0 });
    });
  });

  it("skips with no output when nothing is qualified", async () => {
    const { deps } = setup({ qualified: [] });
    const out = await generateEmailOperation(deps, run, { cap: 5 });
    expect(out.skipped).toBe(true);
    expect(out.itemIds).toEqual([]);
  });
});

describe("qaOperation", () => {
  function setup(opts: { pendingIds: string[]; draftedProspectIds: string[]; runQa?: jest.Mock }) {
    const messageFindMany = jest.fn(async ({ where }: { where: { qaStatus?: string } }) =>
      where.qaStatus === "PENDING" ? opts.pendingIds.map((id) => ({ id })) : opts.draftedProspectIds.map((prospectId) => ({ prospectId })),
    );
    const runQa = opts.runQa ?? jest.fn(async () => ({ qaStatus: "PASS" }));
    const prisma = { project: { findUniqueOrThrow: async () => ({ workspaceId: "ws1" }) }, message: { findMany: messageFindMany } };
    return { messageFindMany, runQa, deps: { prisma: prisma as never, messages: { runQa } as never } };
  }

  it("only checks messages of the scoped prospects in this run", async () => {
    const { messageFindMany, deps } = setup({ pendingIds: ["m1"], draftedProspectIds: ["p1"] });
    await qaOperation(deps, run, ["p1"]);
    expect(messageFindMany).toHaveBeenCalledWith({ where: { qaStatus: "PENDING", prospect: { workflowRunId: "run1", id: { in: ["p1"] } } }, select: { id: true } });
  });

  it("tallies verdicts, counts errors, and returns each drafted prospect once", async () => {
    const verdicts = ["PASS", "WARN", "FAIL"];
    const runQa = jest.fn(async (_ws: unknown, _proj: string, id: string) => {
      if (id === "m4") throw new Error("ai down");
      return { qaStatus: verdicts[Number(id.slice(1)) - 1] };
    });
    const { deps } = setup({ pendingIds: ["m1", "m2", "m3", "m4"], draftedProspectIds: ["p1", "p1", "p2"], runQa });
    const out = await qaOperation(deps, run);
    expect(out.summary).toEqual({ considered: 4, pass: 1, warn: 1, fail: 1, errored: 1 });
    expect(out.itemIds).toEqual(["p1", "p2"]);
  });

  it("skips when nothing is pending but still passes drafted prospects on", async () => {
    const { runQa, deps } = setup({ pendingIds: [], draftedProspectIds: ["p1"] });
    const out = await qaOperation(deps, run);
    expect(out.skipped).toBe(true);
    expect(runQa).not.toHaveBeenCalled();
    expect(out.itemIds).toEqual(["p1"]);
  });
});
