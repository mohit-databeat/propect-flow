import { ProspectListQuery } from "@prospect/shared";
import { ProspectsService } from "./prospects.service";

const ws = { id: "ws1", role: "OWNER" as const };

function makeProjectsStub() {
  return { findOneOrThrow: async () => ({ id: "proj1", workspaceId: "ws1" }) };
}

describe("ProspectsService.list", () => {
  it("returns an empty page with runId null when the project has no workflow runs yet", async () => {
    const prisma = {
      workflowRun: { findFirst: async () => null },
      prospect: { findMany: async () => [], count: async () => 0, groupBy: async () => [] },
    };
    const service = new ProspectsService(prisma as never, makeProjectsStub() as never, {} as never, {} as never, {} as never);
    const result = await service.list(ws, "proj1", ProspectListQuery.parse({}));
    expect(result).toEqual({ items: [], page: 1, pageSize: 25, total: 0, runId: null, statusCounts: { total: 0, qualified: 0, needsReview: 0, disqualified: 0, pending: 0 } });
  });

  it("defaults to the latest workflow run when ?runId is not given", async () => {
    let capturedWhere: unknown;
    const prisma = {
      workflowRun: { findFirst: async () => ({ id: "latest-run" }) },
      prospect: {
        findMany: async ({ where }: { where: unknown }) => {
          capturedWhere = where;
          return [];
        },
        count: async () => 0,
        groupBy: async () => [],
      },
    };
    const service = new ProspectsService(prisma as never, makeProjectsStub() as never, {} as never, {} as never, {} as never);
    const result = await service.list(ws, "proj1", ProspectListQuery.parse({}));
    expect(result.runId).toBe("latest-run");
    expect((capturedWhere as { workflowRunId: string }).workflowRunId).toBe("latest-run");
  });

  it("passes an explicit ?runId straight through instead of looking up the latest run", async () => {
    const prisma = {
      workflowRun: { findFirst: async () => ({ id: "should-not-be-used" }) },
      prospect: { findMany: async () => [], count: async () => 0, groupBy: async () => [] },
    };
    const service = new ProspectsService(prisma as never, makeProjectsStub() as never, {} as never, {} as never, {} as never);
    const result = await service.list(ws, "proj1", ProspectListQuery.parse({ runId: "11111111-1111-1111-1111-111111111111" }));
    expect(result.runId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("builds a status filter", async () => {
    let capturedWhere: Record<string, unknown> = {};
    const prisma = {
      workflowRun: { findFirst: async () => ({ id: "run1" }) },
      prospect: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          capturedWhere = where;
          return [];
        },
        count: async () => 0,
        groupBy: async () => [],
      },
    };
    const service = new ProspectsService(prisma as never, makeProjectsStub() as never, {} as never, {} as never, {} as never);
    await service.list(ws, "proj1", ProspectListQuery.parse({ status: "NEEDS_REVIEW" }));
    expect(capturedWhere.status).toBe("NEEDS_REVIEW");
  });

  it("builds a criterion filter of the form '<criterionId>:<STATUS>'", async () => {
    let capturedWhere: Record<string, unknown> = {};
    const prisma = {
      workflowRun: { findFirst: async () => ({ id: "run1" }) },
      prospect: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          capturedWhere = where;
          return [];
        },
        count: async () => 0,
        groupBy: async () => [],
      },
    };
    const service = new ProspectsService(prisma as never, makeProjectsStub() as never, {} as never, {} as never, {} as never);
    await service.list(ws, "proj1", ProspectListQuery.parse({ criterion: "employees_100_500:UNKNOWN" }));
    expect(capturedWhere.results).toEqual({ some: { criterionId: "employees_100_500", status: "UNKNOWN", phase: "INITIAL" } });
  });

  it("orders by score with nulls last by default, so 'insufficient evidence' prospects sort to the end", async () => {
    let capturedOrderBy: unknown;
    const prisma = {
      workflowRun: { findFirst: async () => ({ id: "run1" }) },
      prospect: {
        findMany: async ({ orderBy }: { orderBy: unknown }) => {
          capturedOrderBy = orderBy;
          return [];
        },
        count: async () => 0,
        groupBy: async () => [],
      },
    };
    const service = new ProspectsService(prisma as never, makeProjectsStub() as never, {} as never, {} as never, {} as never);
    await service.list(ws, "proj1", ProspectListQuery.parse({}));
    expect(capturedOrderBy).toEqual({ score: { sort: "desc", nulls: "last" } });
  });

  it("scopes every query through the project (and therefore the workspace via findOneOrThrow)", async () => {
    let capturedWhere: Record<string, unknown> = {};
    const projects = { findOneOrThrow: jest.fn(async () => ({ id: "proj1", workspaceId: "ws1" })) };
    const prisma = {
      workflowRun: { findFirst: async () => ({ id: "run1" }) },
      prospect: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          capturedWhere = where;
          return [];
        },
        count: async () => 0,
        groupBy: async () => [],
      },
    };
    const service = new ProspectsService(prisma as never, projects as never, {} as never, {} as never, {} as never);
    await service.list(ws, "proj1", ProspectListQuery.parse({}));
    expect(projects.findOneOrThrow).toHaveBeenCalledWith(ws, "proj1");
    expect(capturedWhere.projectId).toBe("proj1");
  });

  it("computes statusCounts for the whole run, ignoring the current status/search/minScore filters", async () => {
    let groupByWhere: unknown;
    const prisma = {
      workflowRun: { findFirst: async () => ({ id: "run1" }) },
      prospect: {
        findMany: async () => [],
        count: async () => 0,
        groupBy: async ({ where }: { where: unknown }) => {
          groupByWhere = where;
          return [
            { status: "QUALIFIED", _count: { _all: 3 } },
            { status: "NEEDS_REVIEW", _count: { _all: 2 } },
            { status: "DISQUALIFIED", _count: { _all: 5 } },
          ];
        },
      },
    };
    const service = new ProspectsService(prisma as never, makeProjectsStub() as never, {} as never, {} as never, {} as never);

    const result = await service.list(ws, "proj1", ProspectListQuery.parse({ status: "QUALIFIED" }));

    expect(groupByWhere).toEqual({ projectId: "proj1", workflowRunId: "run1" });
    expect(result.statusCounts).toEqual({ total: 10, qualified: 3, needsReview: 2, disqualified: 5, pending: 0 });
  });
});
