import { MockApolloConnector } from "./mock-apollo.connector";
import { MOCK_APOLLO_COMPANIES } from "./fixtures/mock-apollo-companies";

const ctx = { workspaceId: "ws1", credentials: {}, logger: { debug() {}, info() {}, warn() {}, error() {} } };

describe("MockApolloConnector", () => {
  const connector = new MockApolloConnector();

  it("is a mock, available, with no required credentials", () => {
    expect(connector.isMock).toBe(true);
    expect(connector.available).toBe(true);
    expect(connector.requiredCredentials).toEqual([]);
  });

  it("supports paging: returns a nextCursor until the fixture is exhausted", async () => {
    const page1 = await connector.fetchRecords(ctx, {}, { limit: 3 });
    expect(page1.records).toHaveLength(3);
    expect(page1.nextCursor).toBe("3");

    const page2 = await connector.fetchRecords(ctx, {}, { limit: 3, cursor: page1.nextCursor });
    expect(page2.records).toHaveLength(3);
    expect(page2.nextCursor).toBe("6");

    const page3 = await connector.fetchRecords(ctx, {}, { limit: 3, cursor: page2.nextCursor });
    expect(page3.records).toHaveLength(2);
    expect(page3.nextCursor).toBeUndefined();
  });

  it("supports a domain filter", async () => {
    const { records } = await connector.fetchRecords(ctx, { filters: { domains: ["linear.app", "notion.so"] } }, { limit: 100 });
    expect(records).toHaveLength(2);
  });

  it("maps Linear with no employeeCount attribute at all (missing, not zero)", async () => {
    const linearRaw = (await connector.fetchRecords(ctx, { filters: { domains: ["linear.app"] } }, { limit: 10 })).records[0]!;
    const { attributes } = connector.mapToCanonical(linearRaw);
    expect(attributes.find((a) => a.field === "firmographics.employeeCount")).toBeUndefined();
  });

  it("marks Linear's tech stack non-authoritative-empty and hiring authoritative-empty", async () => {
    const linearRaw = (await connector.fetchRecords(ctx, { filters: { domains: ["linear.app"] } }, { limit: 10 })).records[0]!;
    const { attributes } = connector.mapToCanonical(linearRaw);
    const stack = attributes.find((a) => a.field === "technographics.stack")!.value as { items: unknown[]; authoritative: boolean };
    const hiring = attributes.find((a) => a.field === "signals.hiring")!.value as { items: unknown[]; authoritative: boolean };
    expect(stack.items).toHaveLength(0);
    expect(stack.authoritative).toBe(false);
    expect(hiring.items).toHaveLength(0);
    expect(hiring.authoritative).toBe(true);
  });

  it("maps people for every fixture company", async () => {
    const { records } = await connector.fetchRecords(ctx, {}, { limit: 100 });
    for (const record of records) {
      const { people } = connector.mapToCanonical(record);
      expect(people.length).toBeGreaterThan(0);
    }
  });

  it("covers exactly the eight documented demo companies", () => {
    expect(MOCK_APOLLO_COMPANIES.map((c) => c.domain).sort()).toEqual(
      ["canva.com", "databricks.com", "figma.com", "linear.app", "notion.so", "slack.com", "stripe.com", "webflow.com"].sort(),
    );
  });

  it("never emits provenance from mapToCanonical", async () => {
    const { records } = await connector.fetchRecords(ctx, {}, { limit: 1 });
    const { canonical } = connector.mapToCanonical(records[0]!);
    expect((canonical as Record<string, unknown>).provenance).toBeUndefined();
  });

  it("produces byte-identical payloads across repeated fetches within the same day, so re-syncing is idempotent", async () => {
    const { records: first } = await connector.fetchRecords(ctx, {}, { limit: 100 });
    const { records: second } = await connector.fetchRecords(ctx, {}, { limit: 100 });
    expect(second.map((r) => r.payload)).toEqual(first.map((r) => r.payload));
  });
});
