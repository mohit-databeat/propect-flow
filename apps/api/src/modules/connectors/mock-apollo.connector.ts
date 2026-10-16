import { Injectable } from "@nestjs/common";
import type { CanonicalPerson, MappedRecord, NewAttribute, ProviderCtx, RawRecord } from "@prospect/shared";
import { normalizeDomain } from "@prospect/shared";
import type { ConnectorCapabilities, DataSourceConnector, FetchQuery } from "./connector.interface";
import { MOCK_APOLLO_COMPANIES, toApolloRawPayload } from "./fixtures/mock-apollo-companies";

interface ApolloRawShape {
  id: string;
  name: string;
  primary_domain: string;
  website_url: string;
  industry: string;
  short_description: string;
  country: string;
  city: string;
  state: string | null;
  estimated_num_employees: number | null;
  annual_revenue: number | null;
  founded_year: number;
  latest_funding_stage: string;
  total_funding: number;
  technologies: { name: string }[];
  technologies_complete: boolean;
  job_postings: { title: string; department: string; posted_at: string; url: string }[];
  job_postings_complete: boolean;
  people: { name: string; title: string; seniority: string; department: string; email: string }[];
}

@Injectable()
export class MockApolloConnector implements DataSourceConnector {
  readonly key = "mock_apollo";
  readonly displayName = "Mock Apollo (demo fixture)";
  readonly type = "API" as const;
  readonly isMock = true;
  readonly available = true;
  readonly requiredCredentials: string[] = [];

  capabilities(): ConnectorCapabilities {
    return {
      supportsSearch: true,
      supportsPaging: true,
      requiresMapping: false,
      suppliesFields: [
        "identity.name",
        "identity.domain",
        "firmographics.industry",
        "firmographics.country",
        "firmographics.hqCity",
        "firmographics.hqState",
        "firmographics.employeeCount",
        "firmographics.revenueUsd",
        "firmographics.foundedYear",
        "firmographics.fundingStage",
        "firmographics.totalFundingUsd",
        "firmographics.description",
        "technographics.stack",
        "signals.hiring",
      ],
      suppliesPeople: true,
    };
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    return { ok: true, message: `${MOCK_APOLLO_COMPANIES.length} fixture companies available.` };
  }

  async fetchRecords(_ctx: ProviderCtx, config: unknown, query: FetchQuery): Promise<{ records: RawRecord[]; nextCursor?: string }> {
    const domainFilter = (config as { filters?: { domains?: string[] } })?.filters?.domains;
    let all = MOCK_APOLLO_COMPANIES;
    if (domainFilter?.length) {
      const wanted = new Set(domainFilter.map((d) => normalizeDomain(d)));
      all = all.filter((c) => wanted.has(c.domain));
    }
    const start = query.cursor ? Number(query.cursor) : 0;
    const limit = query.limit || all.length;
    const end = Math.min(start + limit, all.length);
    const records: RawRecord[] = all.slice(start, end).map((c) => ({ externalId: `mock_${c.id}`, payload: toApolloRawPayload(c) }));
    return { records, nextCursor: end < all.length ? String(end) : undefined };
  }

  mapToCanonical(raw: RawRecord): MappedRecord {
    const p = raw.payload as unknown as ApolloRawShape;
    const attributes: NewAttribute[] = [];
    const domain = normalizeDomain(p.primary_domain);

    attributes.push({ field: "identity.name", value: p.name, confidence: 100 });
    attributes.push({ field: "identity.domain", value: domain, confidence: 100 });
    if (p.industry) attributes.push({ field: "firmographics.industry", value: p.industry, confidence: 95 });
    if (p.short_description) attributes.push({ field: "firmographics.description", value: p.short_description, confidence: 90 });
    if (p.country) attributes.push({ field: "firmographics.country", value: p.country, confidence: 95 });
    if (p.city) attributes.push({ field: "firmographics.hqCity", value: p.city, confidence: 90 });
    if (p.state) attributes.push({ field: "firmographics.hqState", value: p.state, confidence: 90 });
    if (p.estimated_num_employees != null) attributes.push({ field: "firmographics.employeeCount", value: p.estimated_num_employees, confidence: 90 });
    if (p.annual_revenue != null) attributes.push({ field: "firmographics.revenueUsd", value: p.annual_revenue, confidence: 85 });
    if (p.founded_year) attributes.push({ field: "firmographics.foundedYear", value: p.founded_year, confidence: 95 });
    if (p.latest_funding_stage) attributes.push({ field: "firmographics.fundingStage", value: p.latest_funding_stage, confidence: 90 });
    if (p.total_funding != null) attributes.push({ field: "firmographics.totalFundingUsd", value: p.total_funding, confidence: 85 });

    attributes.push({
      field: "technographics.stack",
      value: { items: p.technologies.map((t) => ({ key: t.name, raw: t.name })), authoritative: p.technologies_complete },
      confidence: 90,
    });
    attributes.push({
      field: "signals.hiring",
      value: {
        items: p.job_postings.map((j) => ({ title: j.title, department: j.department, postedAt: j.posted_at, url: j.url })),
        authoritative: p.job_postings_complete,
      },
      confidence: 90,
    });

    const people: CanonicalPerson[] = p.people.map((person) => ({
      fullName: person.name,
      title: person.title,
      seniority: person.seniority as CanonicalPerson["seniority"],
      department: person.department,
      email: person.email,
    }));

    return { canonical: { identity: { name: p.name, domain, website: p.website_url } }, attributes, people };
  }
}
