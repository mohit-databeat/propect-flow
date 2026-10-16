import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { IngestionService } from "./ingestion.service";

const sha256 = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

interface FakeSourceRecord {
  id: string;
  dataSourceId: string;
  externalId: string | null;
  rawPayload: Record<string, unknown>;
  payloadHash: string;
  normalizedCompanyId: string | null;
  normalizationError: string | null;
}

function makeFakePrisma(dataSourceRow: { id: string; providerKey: string; config: unknown; projectId: string; project: { workspaceId: string } }) {
  const sourceRecords: FakeSourceRecord[] = [];
  const dataSourceUpdates: Record<string, unknown>[] = [];

  return {
    dataSource: {
      findUniqueOrThrow: async () => dataSourceRow,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        dataSourceUpdates.push(data);
        return { ...dataSourceRow, ...data };
      },
      findMany: async () => [dataSourceRow],
    },
    sourceRecord: {
      findUnique: async ({ where }: { where: { dataSourceId_payloadHash: { dataSourceId: string; payloadHash: string } } }) =>
        sourceRecords.find((r) => r.dataSourceId === where.dataSourceId_payloadHash.dataSourceId && r.payloadHash === where.dataSourceId_payloadHash.payloadHash) ?? null,
      create: async ({ data }: { data: Omit<FakeSourceRecord, "id" | "normalizedCompanyId" | "normalizationError"> }) => {
        const row: FakeSourceRecord = { id: randomUUID(), normalizedCompanyId: null, normalizationError: null, ...data };
        sourceRecords.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeSourceRecord> }) => {
        const row = sourceRecords.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      findMany: async ({ where }: { where: { dataSourceId: string; normalizedCompanyId: null } }) =>
        sourceRecords.filter((r) => r.dataSourceId === where.dataSourceId && r.normalizedCompanyId === null),
    },
    __sourceRecords: sourceRecords,
    __dataSourceUpdates: dataSourceUpdates,
  };
}

function makeStubConnector(records: { externalId: string; payload: Record<string, unknown> }[]) {
  let calls = 0;
  return {
    key: "stub",
    type: "API" as const,
    capabilities: () => ({ requiresMapping: false, supportsPaging: false, supportsSearch: false, suppliesFields: [], suppliesPeople: false }),
    fetchRecords: async () => {
      calls++;
      return { records };
    },
    mapToCanonical: (raw: { payload: Record<string, unknown> }) => ({
      canonical: { identity: { name: String(raw.payload.name), domain: String(raw.payload.domain) } },
      attributes: [{ field: "identity.name" as const, value: raw.payload.name, confidence: 100 }],
      people: [],
    }),
    get calls() {
      return calls;
    },
  };
}

describe("IngestionService — SourceRecord idempotency", () => {
  it("re-syncing the same records skips duplicates by payloadHash and creates none new", async () => {
    const dataSourceRow = { id: "ds1", providerKey: "stub", config: {}, projectId: "proj1", project: { workspaceId: "ws1" } };
    const prisma = makeFakePrisma(dataSourceRow);
    const records = [{ externalId: "a", payload: { name: "Acme", domain: "acme.com" } }];
    const connector = makeStubConnector(records);

    const registry = { getConnector: () => connector, ctxFor: () => ({ workspaceId: "ws1", credentials: {}, logger: { debug() {}, info() {}, warn() {}, error() {} } }) };
    const matcher = { findOrCreate: async () => ({ company: { id: "company1", possibleDuplicate: false }, isNew: true }) };
    const attributeWriter = { append: async () => {} };
    const personWriter = { upsert: async () => {} };
    const resolver = { resolveCompany: jest.fn(async () => {}) };
    const normalizers = {};

    const ingestion = new IngestionService(prisma as never, registry as never, matcher as never, attributeWriter as never, personWriter as never, resolver as never, normalizers as never);

    const first = await ingestion.syncDataSource("ds1");
    expect(first.fetched).toBe(1);
    expect(first.created).toBe(1);
    expect(first.skipped).toBe(0);
    expect(prisma.__sourceRecords).toHaveLength(1);

    const second = await ingestion.syncDataSource("ds1");
    expect(second.fetched).toBe(1);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);
    expect(prisma.__sourceRecords).toHaveLength(1);

    expect(prisma.__sourceRecords[0]!.payloadHash).toBe(sha256(records[0]!.payload));
  });

  it("resolves each affected company exactly once per sync, even with multiple records for the same company", async () => {
    const dataSourceRow = { id: "ds1", providerKey: "stub", config: {}, projectId: "proj1", project: { workspaceId: "ws1" } };
    const prisma = makeFakePrisma(dataSourceRow);
    const records = [
      { externalId: "a", payload: { name: "Acme", domain: "acme.com" } },
      { externalId: "b", payload: { name: "Acme Corp", domain: "acme.com" } },
    ];
    const connector = makeStubConnector(records);
    const registry = { getConnector: () => connector, ctxFor: () => ({ workspaceId: "ws1", credentials: {}, logger: { debug() {}, info() {}, warn() {}, error() {} } }) };
    const matcher = { findOrCreate: async () => ({ company: { id: "company1", possibleDuplicate: false }, isNew: true }) };
    const attributeWriter = { append: async () => {} };
    const personWriter = { upsert: async () => {} };
    const resolver = { resolveCompany: jest.fn(async () => {}) };

    const ingestion = new IngestionService(prisma as never, registry as never, matcher as never, attributeWriter as never, personWriter as never, resolver as never, {} as never);
    await ingestion.syncDataSource("ds1");

    expect(resolver.resolveCompany).toHaveBeenCalledTimes(1);
    expect(resolver.resolveCompany).toHaveBeenCalledWith("company1");
  });

  it("reports newCompanies vs mergedIntoExisting — e.g. 5 brand-new + 3 matched onto companies from another source", async () => {
    const dataSourceRow = { id: "ds1", providerKey: "stub", config: {}, projectId: "proj1", project: { workspaceId: "ws1" } };
    const prisma = makeFakePrisma(dataSourceRow);
    const domains = ["a.com", "b.com", "c.com", "d.com", "e.com", "f.com", "g.com", "h.com"];
    const records = domains.map((d, i) => ({ externalId: String(i), payload: { name: d, domain: d } }));
    const connector = makeStubConnector(records);
    const registry = { getConnector: () => connector, ctxFor: () => ({ workspaceId: "ws1", credentials: {}, logger: { debug() {}, info() {}, warn() {}, error() {} } }) };

    const alreadyKnown = new Set(["a.com", "b.com", "c.com"]);
    const matcher = {
      findOrCreate: async (_ws: string, _proj: string, identity: { domain?: string }) => ({
        company: { id: `company-${identity.domain}`, possibleDuplicate: false },
        isNew: !alreadyKnown.has(identity.domain!),
      }),
    };
    const attributeWriter = { append: async () => {} };
    const personWriter = { upsert: async () => {} };
    const resolver = { resolveCompany: async () => {} };

    const ingestion = new IngestionService(prisma as never, registry as never, matcher as never, attributeWriter as never, personWriter as never, resolver as never, {} as never);
    const result = await ingestion.syncDataSource("ds1");

    expect(result.newCompanies).toBe(5);
    expect(result.mergedIntoExisting).toBe(3);
  });
});
