import { EnrichmentService } from "./enrichment.service";
import { ProviderRegistryService } from "../../providers/provider-registry.service";
import { AppException } from "../../common/errors";
import type { CanonicalCompany, CanonicalFieldPath, NewAttribute, ProviderCtx } from "@prospect/shared";
import type { EnrichmentProvider, EnrichmentResult } from "./enrichment-provider.interface";

function makeCanonical(overrides: Partial<CanonicalCompany> = {}): CanonicalCompany {
  return {
    schemaVersion: 1,
    identity: { name: "Acme", domain: "acme.com" },
    firmographics: {},
    technographics: { stack: { items: [], authoritative: false } },
    signals: { hiring: { items: [], authoritative: false }, funding: { items: [], authoritative: false }, news: { items: [], authoritative: false }, expansion: { items: [], authoritative: false } },
    provenance: {},
    ...overrides,
  };
}

function fakeProvider(overrides: Partial<EnrichmentProvider> = {}): EnrichmentProvider {
  return {
    key: "fake_enrich",
    displayName: "Fake Enrich",
    isMock: true,
    available: true,
    requiredCredentials: [],
    rateLimit: { rpm: 60, concurrency: 1 },
    supportedFields: () => ["firmographics.revenueUsd", "firmographics.employeeCount"],
    enrich: async (_ctx: ProviderCtx, _company: CanonicalCompany, fields: CanonicalFieldPath[]): Promise<EnrichmentResult> => ({
      attributes: fields.map((field): NewAttribute => ({ field, value: 100, confidence: 90, observedAt: new Date().toISOString() })),
      unavailable: [],
      costUnits: fields.length,
    }),
    ...overrides,
  };
}

function makeFakePrisma(company: { id: string; canonical: CanonicalCompany }) {
  const enrichmentRuns: Record<string, unknown>[] = [];
  return {
    company: { findUniqueOrThrow: async () => company },
    enrichmentRun: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `run-${enrichmentRuns.length + 1}`, ...data };
        enrichmentRuns.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = enrichmentRuns.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    __runs: enrichmentRuns,
  };
}

describe("EnrichmentService.enrichCompany", () => {
  it("requests nothing and makes no provider call when missingFields ∩ supportedFields is empty", async () => {
    const registry = new ProviderRegistryService();
    const provider = fakeProvider();
    let called = false;
    provider.enrich = async () => {
      called = true;
      return { attributes: [], unavailable: [], costUnits: 0 };
    };
    registry.registerEnricher(provider);

    const prisma = makeFakePrisma({ id: "c1", canonical: makeCanonical() });
    const attributeWriter = { append: jest.fn() };
    const ingestion = { resolveCompany: jest.fn() };
    const service = new EnrichmentService(prisma as never, registry, attributeWriter as never, ingestion as never);

    const outcome = await service.enrichCompany({
      workspaceId: "ws1",
      projectId: "p1",
      companyId: "c1",
      providerKey: "fake_enrich",
      missingFields: ["firmographics.industry"],
    });

    expect(outcome.ran).toBe(false);
    expect(outcome.skippedReason).toMatch(/no missing field is supported/);
    expect(called).toBe(false);
    expect(attributeWriter.append).not.toHaveBeenCalled();
    expect(prisma.__runs).toHaveLength(0);
  });

  it("intersects missingFields with supportedFields, writes attributes, marks unavailable fields, and re-resolves the company", async () => {
    const registry = new ProviderRegistryService();
    const provider = fakeProvider({
      supportedFields: () => ["firmographics.revenueUsd", "firmographics.employeeCount"],
      enrich: async (_ctx, _company, fields) => ({
        attributes: fields.includes("firmographics.revenueUsd") ? [{ field: "firmographics.revenueUsd", value: 250_000_000, confidence: 85, observedAt: new Date().toISOString() }] : [],
        unavailable: fields.includes("firmographics.employeeCount") ? ["firmographics.employeeCount"] : [],
        costUnits: fields.length,
      }),
    });
    registry.registerEnricher(provider);

    const prisma = makeFakePrisma({ id: "c1", canonical: makeCanonical() });
    const attributeWriter = { append: jest.fn() };
    const ingestion = { resolveCompany: jest.fn() };
    const service = new EnrichmentService(prisma as never, registry, attributeWriter as never, ingestion as never);

    const outcome = await service.enrichCompany({
      workspaceId: "ws1",
      projectId: "p1",
      companyId: "c1",
      providerKey: "fake_enrich",
      missingFields: ["firmographics.revenueUsd", "firmographics.employeeCount", "firmographics.industry"],
    });

    expect(outcome.ran).toBe(true);
    expect(outcome.requested.sort()).toEqual(["firmographics.employeeCount", "firmographics.revenueUsd"]);
    expect(outcome.supplied).toEqual(["firmographics.revenueUsd"]);
    expect(outcome.unavailable).toEqual(["firmographics.employeeCount"]);
    expect(attributeWriter.append).toHaveBeenCalledTimes(1);
    expect(ingestion.resolveCompany).toHaveBeenCalledWith("c1");
    expect(prisma.__runs).toHaveLength(1);
    expect((prisma.__runs[0] as { status: string }).status).toBe("PARTIAL");
  });

  it("throws 409 PROVIDER_UNAVAILABLE for a documented stub enrichment provider before creating any EnrichmentRun", async () => {
    const registry = new ProviderRegistryService();
    registry.registerEnricher(fakeProvider({ key: "apollo_enrich", available: false }));
    const prisma = makeFakePrisma({ id: "c1", canonical: makeCanonical() });
    const service = new EnrichmentService(prisma as never, registry, { append: jest.fn() } as never, { resolveCompany: jest.fn() } as never);

    await expect(
      service.enrichCompany({ workspaceId: "ws1", projectId: "p1", companyId: "c1", providerKey: "apollo_enrich", missingFields: ["firmographics.revenueUsd"] }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(prisma.__runs).toHaveLength(0);
  });

  it("throws 424 PROVIDER_NOT_CONFIGURED when a real provider's required credentials are missing", async () => {
    delete process.env.TEST_ENRICH_KEY;
    const registry = new ProviderRegistryService();
    registry.registerEnricher(fakeProvider({ key: "real_enrich", isMock: false, requiredCredentials: ["TEST_ENRICH_KEY"] }));
    const prisma = makeFakePrisma({ id: "c1", canonical: makeCanonical() });
    const service = new EnrichmentService(prisma as never, registry, { append: jest.fn() } as never, { resolveCompany: jest.fn() } as never);

    await expect(
      service.enrichCompany({ workspaceId: "ws1", projectId: "p1", companyId: "c1", providerKey: "real_enrich", missingFields: ["firmographics.revenueUsd"] }),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
  });

  it("soft-fails (returns, does not throw) and marks the EnrichmentRun FAILED when the provider call itself errors", async () => {
    const registry = new ProviderRegistryService();
    registry.registerEnricher(
      fakeProvider({
        enrich: async () => {
          throw new AppException(502 as never, "PROVIDER_ERROR", "network blip");
        },
      }),
    );
    const prisma = makeFakePrisma({ id: "c1", canonical: makeCanonical() });
    const service = new EnrichmentService(prisma as never, registry, { append: jest.fn() } as never, { resolveCompany: jest.fn() } as never);

    const outcome = await service.enrichCompany({ workspaceId: "ws1", projectId: "p1", companyId: "c1", providerKey: "fake_enrich", missingFields: ["firmographics.revenueUsd"] });
    expect(outcome.ran).toBe(true);
    expect(outcome.supplied).toEqual([]);
    expect((prisma.__runs[0] as { status: string }).status).toBe("FAILED");
  });
});
