import { DataSourcesService } from "./data-sources.service";
import { AppException } from "../../common/errors";

const ws = { id: "ws1", role: "OWNER" as const };

function makePrismaStub(dataSourceRow: { id: string; projectId: string; status: string; providerKey: string; config: unknown }) {
  return {
    dataSource: {
      findFirst: async () => dataSourceRow,
    },
  };
}

describe("DataSourcesService.sync — archived sources", () => {
  it("rejects sync with 409 DATA_SOURCE_NOT_READY when the data source is archived", async () => {
    const prisma = makePrismaStub({ id: "ds1", projectId: "proj1", status: "ARCHIVED", providerKey: "mock_apollo", config: {} });
    const projects = { findOneOrThrow: async () => ({ id: "proj1", workspaceId: "ws1" }) };

    const service = new DataSourcesService(prisma as never, projects as never, {} as never, {} as never, {} as never, {} as never);

    const err = await service.sync(ws, "proj1", "ds1").catch((e: AppException) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe("DATA_SOURCE_NOT_READY");
    expect((err as AppException).getStatus()).toBe(409);
  });

  it("rejects sync with 409 DATA_SOURCE_NOT_READY when a mapping-required (CSV) source is still DRAFT", async () => {
    const prisma = makePrismaStub({ id: "ds1", projectId: "proj1", status: "DRAFT", providerKey: "csv", config: {} });
    const projects = { findOneOrThrow: async () => ({ id: "proj1", workspaceId: "ws1" }) };
    const registry = { getConnector: () => ({ capabilities: () => ({ requiresMapping: true }) }) };
    const service = new DataSourcesService(prisma as never, projects as never, registry as never, {} as never, {} as never, {} as never);

    const err = await service.sync(ws, "proj1", "ds1").catch((e: AppException) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe("DATA_SOURCE_NOT_READY");
  });
});
