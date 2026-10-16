import { randomUUID } from "node:crypto";
import { CompanyMatcherService } from "./company-matcher.service";

interface FakeCompany {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  domain: string | null;
  website: string | null;
  possibleDuplicate: boolean;
}

function makeFakePrisma() {
  const companies: FakeCompany[] = [];
  return {
    company: {
      findFirst: async ({ where }: { where: { projectId: string; domain?: string | null } }) =>
        companies.find((c) => c.projectId === where.projectId && (where.domain === undefined || c.domain === where.domain)) ?? null,
      findMany: async ({ where }: { where: { projectId: string; domain: null } }) =>
        companies.filter((c) => c.projectId === where.projectId && c.domain === null),
      create: async ({ data }: { data: Omit<FakeCompany, "id" | "possibleDuplicate"> & { possibleDuplicate?: boolean } }) => {

        const row: FakeCompany = { id: randomUUID(), possibleDuplicate: false, ...data, domain: data.domain ?? null };
        companies.push(row);
        return row;
      },
    },
    __companies: companies,
  };
}

describe("CompanyMatcherService", () => {
  it("matches an existing company by (projectId, domain), reporting isNew: false", async () => {
    const prisma = makeFakePrisma();
    const matcher = new CompanyMatcherService(prisma as never);
    const first = await matcher.findOrCreate("ws1", "proj1", { name: "Databricks", domain: "databricks.com" });
    const second = await matcher.findOrCreate("ws1", "proj1", { name: "Databricks Inc.", domain: "databricks.com" });
    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(second.company.id).toBe(first.company.id);
    expect(prisma.__companies).toHaveLength(1);
  });

  it("creates a new company for a new domain", async () => {
    const prisma = makeFakePrisma();
    const matcher = new CompanyMatcherService(prisma as never);
    await matcher.findOrCreate("ws1", "proj1", { name: "Databricks", domain: "databricks.com" });
    await matcher.findOrCreate("ws1", "proj1", { name: "Notion", domain: "notion.so" });
    expect(prisma.__companies).toHaveLength(2);
  });

  it("matches an existing domain-less company by normalized name", async () => {
    const prisma = makeFakePrisma();
    const matcher = new CompanyMatcherService(prisma as never);
    const first = await matcher.findOrCreate("ws1", "proj1", { name: "Acme Corp" });
    const second = await matcher.findOrCreate("ws1", "proj1", { name: "  ACME  corp " });
    expect(second.company.id).toBe(first.company.id);
    expect(second.isNew).toBe(false);
    expect(prisma.__companies).toHaveLength(1);
  });

  it("creates a new company (not a merge) when a domain-less name match is ambiguous, flagged possibleDuplicate", async () => {
    const prisma = makeFakePrisma();
    const matcher = new CompanyMatcherService(prisma as never);

    prisma.__companies.push({ id: "a", workspaceId: "ws1", projectId: "proj1", name: "Acme", domain: null, website: null, possibleDuplicate: false });
    prisma.__companies.push({ id: "b", workspaceId: "ws1", projectId: "proj1", name: "acme", domain: null, website: null, possibleDuplicate: false });

    const result = await matcher.findOrCreate("ws1", "proj1", { name: "ACME" });
    expect(result.isNew).toBe(true);
    expect(result.company.id).not.toBe("a");
    expect(result.company.id).not.toBe("b");
    expect(result.company.possibleDuplicate).toBe(true);
    expect(prisma.__companies).toHaveLength(3);
  });
});
