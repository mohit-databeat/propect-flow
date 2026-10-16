import { NormalizersService } from "./normalizers";
import { employeeRangeFor, revenueRangeFor, normalizeDomain } from "@prospect/shared";

describe("NormalizersService — dictionary-driven, explicit aliases only", () => {
  const normalizers = new NormalizersService();

  it("normalizes industry aliases to the same canonical key", () => {
    expect(normalizers.normalizeIndustry("SaaS")).toBe("software_saas");
    expect(normalizers.normalizeIndustry("Computer Software")).toBe("software_saas");
    expect(normalizers.normalizeIndustry("Software")).toBe("software_saas");
  });

  it("normalizes technology aliases without generically stripping vendor suffixes", () => {
    expect(normalizers.normalizeTechnology("Salesforce")).toBe("salesforce");
    expect(normalizers.normalizeTechnology("SFDC")).toBe("salesforce");
    expect(normalizers.normalizeTechnology("Salesforce CRM")).toBe("salesforce");

    expect(normalizers.normalizeTechnology("Salesforce Marketing Cloud")).toBe("salesforce_marketing_cloud");
    expect(normalizers.normalizeTechnology("Salesforce Marketing Cloud")).not.toBe("salesforce");
  });

  it("normalizes country aliases to ISO-3166 alpha-2", () => {
    expect(normalizers.normalizeCountry("USA")).toBe("US");
    expect(normalizers.normalizeCountry("U.S.")).toBe("US");
    expect(normalizers.normalizeCountry("United States")).toBe("US");
  });

  it("accepts an already-valid ISO alpha-2 code as-is", () => {
    expect(normalizers.normalizeCountry("US")).toBe("US");
    expect(normalizers.normalizeCountry("au")).toBe("AU");
  });

  it("maps the common 2-letter abbreviation 'UK' to the real ISO code 'GB', not the literal 'UK'", () => {

    expect(normalizers.normalizeCountry("UK")).toBe("GB");
    expect(normalizers.normalizeCountry("uk")).toBe("GB");
  });

  it("returns undefined (unmapped, kept raw by the caller) for values not in the dictionary", () => {
    expect(normalizers.normalizeIndustry("Underwater Basket Weaving")).toBeUndefined();
    expect(normalizers.normalizeTechnology("SomeBrandNewTool")).toBeUndefined();
    expect(normalizers.normalizeCountry("Freedonia")).toBeUndefined();
  });

  it("never throws for unmapped values — it logs dictionary.unmapped and returns undefined instead", () => {
    expect(() => normalizers.normalizeIndustry("Nonexistent Industry")).not.toThrow();
    expect(() => normalizers.normalizeTechnology("Nonexistent Tool")).not.toThrow();
    expect(() => normalizers.normalizeCountry("Nonexistent Land")).not.toThrow();
  });
});

describe("domain normalization", () => {
  it("strips protocol and www, lowercases", () => {
    expect(normalizeDomain("https://www.Example.com")).toBe("example.com");
    expect(normalizeDomain("http://example.com/")).toBe("example.com");
    expect(normalizeDomain("EXAMPLE.COM")).toBe("example.com");
    expect(normalizeDomain("www.example.com/path")).toBe("example.com");
  });
});

describe("range derivation", () => {
  it("derives employeeRange buckets from employeeCount", () => {
    expect(employeeRangeFor(5)).toBe("1-10");
    expect(employeeRangeFor(480)).toBe("201-500");
    expect(employeeRangeFor(2500)).toBe("1001-5000");
    expect(employeeRangeFor(20000)).toBe("10001+");
  });

  it("derives revenueRange buckets from revenueUsd", () => {
    expect(revenueRangeFor(500_000)).toBe("<1M");
    expect(revenueRangeFor(5_000_000)).toBe("1M-10M");
    expect(revenueRangeFor(250_000_000)).toBe("100M-500M");
    expect(revenueRangeFor(2_000_000_000)).toBe(">1B");
  });
});
