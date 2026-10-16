import { AttributeWriterService } from "./attribute-writer.service";

function makeFakePrisma() {
  const rows: Record<string, unknown>[] = [];
  return {
    companyAttribute: {
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        rows.push(...data);
        return { count: data.length };
      },

    },
    __rows: rows,
  };
}

describe("AttributeWriterService — append-only ledger", () => {
  it("inserts new rows via createMany and never updates existing ones", async () => {
    const prisma = makeFakePrisma();
    const writer = new AttributeWriterService(prisma as never);

    await writer.append([{ field: "firmographics.employeeCount", value: 400, confidence: 90 }], { companyId: "c1", sourceType: "SOURCE", providerKey: "mock_apollo" });
    await writer.append([{ field: "firmographics.employeeCount", value: 480, confidence: 90 }], { companyId: "c1", sourceType: "SOURCE", providerKey: "mock_apollo" });

    expect(prisma.__rows).toHaveLength(2);
    expect(prisma.__rows.map((r) => r.value)).toEqual([400, 480]);
  });

  it("clamps confidence into 0-100 and defaults observedAt to now when not supplied", async () => {
    const prisma = makeFakePrisma();
    const writer = new AttributeWriterService(prisma as never);
    await writer.append([{ field: "firmographics.industry", value: "software_saas", confidence: 150 }], { companyId: "c1", sourceType: "SOURCE", providerKey: "csv" });
    expect(prisma.__rows[0]!.confidence).toBe(100);
    expect(prisma.__rows[0]!.observedAt).toBeInstanceOf(Date);
  });

  it("does nothing for an empty attribute list (no createMany call needed)", async () => {
    const prisma = makeFakePrisma();
    const writer = new AttributeWriterService(prisma as never);
    await writer.append([], { companyId: "c1", sourceType: "SOURCE", providerKey: "csv" });
    expect(prisma.__rows).toHaveLength(0);
  });
});
