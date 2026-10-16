import { CsvConnector } from "./csv.connector";

const SAMPLE_CSV = `Company Name,Website,HQ Country,Headcount,Annual Revenue (USD),Industry,Tech Stack
Databricks,https://www.databricks.com,United States,7000,1600000000,Software,"Salesforce CRM; Marketo"
Notion,notion.so,USA,480,,SaaS,Salesforce`;

describe("CsvConnector.parse", () => {
  it("parses headers and rows deterministically", () => {
    const { columns, rows } = CsvConnector.parse(SAMPLE_CSV);
    expect(columns).toEqual(["Company Name", "Website", "HQ Country", "Headcount", "Annual Revenue (USD)", "Industry", "Tech Stack"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ "Company Name": "Databricks", Headcount: "7000" });
  });
});

describe("CsvConnector.suggestMapping (heuristics)", () => {
  it("maps identity.name and common headers with no external calls", async () => {
    const connector = new CsvConnector();
    const { columns, rows } = CsvConnector.parse(SAMPLE_CSV);
    const { mapping, confidence } = await connector.suggestMapping(columns, rows);
    expect(mapping["Company Name"]).toBe("identity.name");
    expect(mapping["Website"]).toBe("identity.domain");
    expect(mapping["Headcount"]).toBe("firmographics.employeeCount");
    expect(mapping["Annual Revenue (USD)"]).toBe("firmographics.revenueUsd");
    expect(confidence["Company Name"]).toBeGreaterThan(0);
  });

  it("leaves unrecognized headers unmapped (null) rather than guessing", async () => {
    const connector = new CsvConnector();
    const { mapping } = await connector.suggestMapping(["Some Totally Unknown Column"], []);
    expect(mapping["Some Totally Unknown Column"]).toBeNull();
  });
});

describe("CsvConnector.mapToCanonical", () => {
  const connector = new CsvConnector();
  const mapping = {
    "Company Name": "identity.name" as const,
    Website: "identity.domain" as const,
    Headcount: "firmographics.employeeCount" as const,
    "Tech Stack": "technographics.stack" as const,
  };

  it("maps a row deterministically with no I/O", () => {
    const { canonical, attributes } = connector.mapToCanonical({ payload: { "Company Name": "Databricks", Website: "https://www.databricks.com", Headcount: "7000", "Tech Stack": "Salesforce CRM; Marketo" } }, mapping);
    expect(canonical.identity.name).toBe("Databricks");
    expect(canonical.identity.domain).toBe("databricks.com");
    expect(attributes.find((a) => a.field === "firmographics.employeeCount")?.value).toBe(7000);
    const stack = attributes.find((a) => a.field === "technographics.stack")?.value as { items: unknown[]; authoritative: boolean };
    expect(stack.items).toHaveLength(2);

    expect(stack.authoritative).toBe(false);
  });

  it("never emits a canonical.provenance field — only the Resolver may write it", () => {
    const { canonical } = connector.mapToCanonical({ payload: { "Company Name": "Notion" } }, mapping);
    expect((canonical as Record<string, unknown>).provenance).toBeUndefined();
  });

  it("skips empty cells rather than writing empty-string attributes", () => {
    const { attributes } = connector.mapToCanonical({ payload: { "Company Name": "Notion", Headcount: "" } }, mapping);
    expect(attributes.find((a) => a.field === "firmographics.employeeCount")).toBeUndefined();
  });
});
