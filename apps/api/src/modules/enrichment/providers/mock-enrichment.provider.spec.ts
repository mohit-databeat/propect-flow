import { MockEnrichmentProvider } from "./mock-enrichment.provider";
import type { CanonicalCompany } from "@prospect/shared";

function makeCanonical(domain: string): CanonicalCompany {
  return {
    schemaVersion: 1,
    identity: { name: domain, domain },
    firmographics: {},
    technographics: { stack: { items: [], authoritative: false } },
    signals: { hiring: { items: [], authoritative: false }, funding: { items: [], authoritative: false }, news: { items: [], authoritative: false }, expansion: { items: [], authoritative: false } },
    provenance: {},
  };
}

describe("MockEnrichmentProvider", () => {
  const provider = new MockEnrichmentProvider();
  const ctx = { workspaceId: "ws1", credentials: {}, logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() } } as never;

  it("supplies revenueUsd for notion.so", async () => {
    const result = await provider.enrich(ctx, makeCanonical("notion.so"), ["firmographics.revenueUsd"]);
    expect(result.attributes).toEqual([expect.objectContaining({ field: "firmographics.revenueUsd", value: 250_000_000 })]);
    expect(result.unavailable).toEqual([]);
  });

  it("supplies revenueUsd for webflow.com", async () => {
    const result = await provider.enrich(ctx, makeCanonical("webflow.com"), ["firmographics.revenueUsd"]);
    expect(result.attributes).toEqual([expect.objectContaining({ field: "firmographics.revenueUsd", value: 150_000_000 })]);
  });

  it("never fabricates data for linear.app — every requested field comes back unavailable", async () => {
    const result = await provider.enrich(ctx, makeCanonical("linear.app"), ["firmographics.revenueUsd", "firmographics.employeeCount"]);
    expect(result.attributes).toEqual([]);
    expect(result.unavailable.sort()).toEqual(["firmographics.employeeCount", "firmographics.revenueUsd"]);
  });

  it("marks a field it has no fixture answer for as unavailable rather than guessing", async () => {
    const result = await provider.enrich(ctx, makeCanonical("random-co.com"), ["firmographics.employeeCount"]);
    expect(result.attributes).toEqual([]);
    expect(result.unavailable).toEqual(["firmographics.employeeCount"]);
  });
});
