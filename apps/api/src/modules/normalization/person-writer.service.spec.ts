import { randomUUID } from "node:crypto";
import { PersonWriterService } from "./person-writer.service";
import { personDedupeKey } from "@prospect/shared";

interface FakePerson {
  id: string;
  companyId: string;
  dedupeKey: string;
  fullName: string;
  title: string | null;
  email: string | null;
  seniority?: string | null;
  department?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  providerKey?: string;
}

function makeFakePrisma() {
  const people: FakePerson[] = [];
  return {
    person: {
      findUnique: async ({ where }: { where: { companyId_dedupeKey: { companyId: string; dedupeKey: string } } }) =>
        people.find((p) => p.companyId === where.companyId_dedupeKey.companyId && p.dedupeKey === where.companyId_dedupeKey.dedupeKey) ?? null,
      create: async ({ data }: { data: Omit<FakePerson, "id"> }) => {
        const row: FakePerson = { id: randomUUID(), ...data };
        people.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakePerson> }) => {
        const row = people.find((p) => p.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    __people: people,
  };
}

describe("PersonWriterService", () => {
  it("dedupes by email when present", async () => {
    const prisma = makeFakePrisma();
    const writer = new PersonWriterService(prisma as never);
    await writer.upsert("company1", [{ fullName: "Priya Raman", title: "VP Sales", email: "priya@example.com" }], "mock_apollo");
    await writer.upsert("company1", [{ fullName: "Priya R.", title: "VP of Sales", email: "PRIYA@example.com" }], "mock_apollo");
    expect(prisma.__people).toHaveLength(1);
    expect(prisma.__people[0]!.dedupeKey).toBe("email:priya@example.com");
    expect(prisma.__people[0]!.fullName).toBe("Priya R.");
  });

  it("falls back to normalized name+title dedupe when no email is known", async () => {
    const prisma = makeFakePrisma();
    const writer = new PersonWriterService(prisma as never);
    await writer.upsert("company1", [{ fullName: "Daniel Okafor", title: "VP Sales" }], "csv");
    await writer.upsert("company1", [{ fullName: "  daniel okafor ", title: "VP Sales" }], "csv");
    expect(prisma.__people).toHaveLength(1);
    expect(prisma.__people[0]!.dedupeKey).toBe(personDedupeKey({ fullName: "Daniel Okafor", title: "VP Sales" }));
  });

  it("treats different titles for the same name as different people when no email is known", async () => {
    const prisma = makeFakePrisma();
    const writer = new PersonWriterService(prisma as never);
    await writer.upsert("company1", [{ fullName: "Jordan Lee", title: "VP Sales" }], "csv");
    await writer.upsert("company1", [{ fullName: "Jordan Lee", title: "VP Marketing" }], "csv");
    expect(prisma.__people).toHaveLength(2);
  });

  it("upgrades a name-only person to an email key when a later observation supplies an email", async () => {
    const prisma = makeFakePrisma();
    const writer = new PersonWriterService(prisma as never);
    await writer.upsert("company1", [{ fullName: "Mei Tanaka", title: "Head of RevOps" }], "csv");
    expect(prisma.__people).toHaveLength(1);
    expect(prisma.__people[0]!.dedupeKey).toBe(personDedupeKey({ fullName: "Mei Tanaka", title: "Head of RevOps" }));

    await writer.upsert("company1", [{ fullName: "Mei Tanaka", title: "Head of RevOps", email: "mei.tanaka@example.com" }], "mock_apollo");

    expect(prisma.__people).toHaveLength(1);
    expect(prisma.__people[0]!.dedupeKey).toBe("email:mei.tanaka@example.com");
    expect(prisma.__people[0]!.email).toBe("mei.tanaka@example.com");
  });
});
