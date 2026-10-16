import { randomUUID } from "node:crypto";
import { ResolverService } from "./resolver.service";

interface FakeAttr {
  id: string;
  companyId: string;
  field: string;
  value: unknown;
  sourceType: "SOURCE" | "ENRICHMENT" | "MANUAL" | "NORMALIZER" | "AI";
  providerKey: string;
  confidence: number;
  observedAt: Date;
}

function makeFakePrisma(companyId: string, attrs: Omit<FakeAttr, "id">[]) {
  const attributes: FakeAttr[] = attrs.map((a) => ({ id: randomUUID(), ...a }));
  const updates: Record<string, unknown>[] = [];
  return {
    company: {
      findUniqueOrThrow: async () => ({ id: companyId, workspaceId: "ws1", name: "Acme" }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return { id: companyId, ...data };
      },
    },
    workspace: {
      findUniqueOrThrow: async () => ({ id: "ws1", settings: {} }),
    },
    companyAttribute: {
      findMany: async () => attributes,
    },
    __updates: updates,
  };
}

const at = (h: number) => new Date(Date.UTC(2026, 0, 1, h));

describe("ResolverService — scalar precedence & tiebreaking", () => {
  it("prefers MANUAL over SOURCE regardless of confidence or recency", async () => {
    const prisma = makeFakePrisma("c1", [
      { companyId: "c1", field: "firmographics.country", value: "US", sourceType: "SOURCE", providerKey: "mock_apollo", confidence: 100, observedAt: at(10) },
      { companyId: "c1", field: "firmographics.country", value: "CA", sourceType: "MANUAL", providerKey: "user", confidence: 50, observedAt: at(1) },
    ]);
    const resolver = new ResolverService(prisma as never);
    await resolver.resolveCompany("c1");
    expect(prisma.__updates[0]!.country).toBe("CA");
  });

  it("within the same sourceType, higher confidence wins", async () => {
    const prisma = makeFakePrisma("c1", [
      { companyId: "c1", field: "firmographics.employeeCount", value: 100, sourceType: "SOURCE", providerKey: "csv", confidence: 60, observedAt: at(5) },
      { companyId: "c1", field: "firmographics.employeeCount", value: 480, sourceType: "SOURCE", providerKey: "mock_apollo", confidence: 90, observedAt: at(1) },
    ]);
    const resolver = new ResolverService(prisma as never);
    await resolver.resolveCompany("c1");
    expect(prisma.__updates[0]!.employeeCount).toBe(480);
  });

  it("with equal sourceType and confidence, the most recent observation wins", async () => {
    const prisma = makeFakePrisma("c1", [
      { companyId: "c1", field: "firmographics.revenueUsd", value: 10_000_000, sourceType: "ENRICHMENT", providerKey: "mock_enrichment", confidence: 85, observedAt: at(1) },
      { companyId: "c1", field: "firmographics.revenueUsd", value: 25_000_000, sourceType: "ENRICHMENT", providerKey: "mock_enrichment", confidence: 85, observedAt: at(9) },
    ]);
    const resolver = new ResolverService(prisma as never);
    await resolver.resolveCompany("c1");
    expect(Number(prisma.__updates[0]!.revenueUsd)).toBe(25_000_000);
  });

  it("derives employeeRange and revenueRange from the resolved scalars", async () => {
    const prisma = makeFakePrisma("c1", [
      { companyId: "c1", field: "firmographics.employeeCount", value: 480, sourceType: "SOURCE", providerKey: "mock_apollo", confidence: 90, observedAt: at(1) },
      { companyId: "c1", field: "firmographics.revenueUsd", value: 250_000_000, sourceType: "ENRICHMENT", providerKey: "mock_enrichment", confidence: 85, observedAt: at(1) },
    ]);
    const resolver = new ResolverService(prisma as never);
    await resolver.resolveCompany("c1");
    expect(prisma.__updates[0]!.employeeRange).toBe("201-500");
    expect(prisma.__updates[0]!.revenueRange).toBe("100M-500M");
  });
});

describe("ResolverService — list group resolution", () => {
  it("uses the top-ranked authoritative observation's items exactly, ignoring lower-ranked ones", async () => {
    const prisma = makeFakePrisma("c1", [
      {
        companyId: "c1",
        field: "technographics.stack",
        value: { items: [{ key: "hubspot_crm", raw: "HubSpot CRM" }], authoritative: true },
        sourceType: "SOURCE",
        providerKey: "mock_apollo",
        confidence: 90,
        observedAt: at(5),
      },
      {
        companyId: "c1",
        field: "technographics.stack",
        value: { items: [{ key: "salesforce", raw: "Salesforce" }, { key: "gong", raw: "Gong" }], authoritative: false },
        sourceType: "SOURCE",
        providerKey: "csv",
        confidence: 60,
        observedAt: at(1),
      },
    ]);
    const resolver = new ResolverService(prisma as never);
    await resolver.resolveCompany("c1");
    expect(prisma.__updates[0]!.techStack).toEqual(["hubspot_crm"]);
  });

  it("unions and dedupes non-authoritative observations when no observation is authoritative", async () => {
    const prisma = makeFakePrisma("c1", [
      {
        companyId: "c1",
        field: "technographics.stack",
        value: { items: [{ key: "salesforce", raw: "Salesforce" }], authoritative: false },
        sourceType: "SOURCE",
        providerKey: "mock_apollo",
        confidence: 90,
        observedAt: at(5),
      },
      {
        companyId: "c1",
        field: "technographics.stack",
        value: { items: [{ key: "salesforce", raw: "Salesforce CRM" }, { key: "marketo", raw: "Marketo" }], authoritative: false },
        sourceType: "SOURCE",
        providerKey: "csv",
        confidence: 60,
        observedAt: at(1),
      },
    ]);
    const resolver = new ResolverService(prisma as never);
    await resolver.resolveCompany("c1");
    expect((prisma.__updates[0]!.techStack as string[]).sort()).toEqual(["marketo", "salesforce"]);
  });

  it("ignores a lower-ranked authoritative observation when the top-ranked one is non-authoritative", async () => {
    const prisma = makeFakePrisma("c1", [
      {
        companyId: "c1",
        field: "technographics.stack",
        value: { items: [{ key: "hubspot_crm", raw: "HubSpot" }], authoritative: false },
        sourceType: "SOURCE",
        providerKey: "csv",
        confidence: 95,
        observedAt: at(9),
      },
      {
        companyId: "c1",
        field: "technographics.stack",
        value: { items: [{ key: "salesforce", raw: "Salesforce" }], authoritative: true },
        sourceType: "SOURCE",
        providerKey: "mock_apollo",
        confidence: 50,
        observedAt: at(1),
      },
    ]);
    const resolver = new ResolverService(prisma as never);
    await resolver.resolveCompany("c1");
    const canonical = prisma.__updates[0]!.canonical as { technographics: { stack: { authoritative: boolean; items: unknown[] } } };
    expect(canonical.technographics.stack.authoritative).toBe(false);
    expect(prisma.__updates[0]!.techStack).toEqual(["hubspot_crm"]);
  });
});
