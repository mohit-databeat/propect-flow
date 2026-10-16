import { Injectable } from "@nestjs/common";
import type { CanonicalCompany, CanonicalFieldPath, NewAttribute, ProviderCtx } from "@prospect/shared";
import type { EnrichmentProvider, EnrichmentResult } from "../enrichment-provider.interface";

const REVENUE_FIXTURE: Record<string, number> = {
  "notion.so": 250_000_000,
  "webflow.com": 150_000_000,
};

const NEVER_AVAILABLE_DOMAINS = new Set(["linear.app"]);

@Injectable()
export class MockEnrichmentProvider implements EnrichmentProvider {
  readonly key = "mock_enrichment";
  readonly displayName = "Mock Enrichment (demo fixture)";
  readonly isMock = true;
  readonly available = true;
  readonly requiredCredentials: string[] = [];
  readonly rateLimit = { rpm: 120, concurrency: 5 };

  supportedFields(): CanonicalFieldPath[] {
    return ["firmographics.employeeCount", "firmographics.revenueUsd", "firmographics.foundedYear", "firmographics.fundingStage", "firmographics.totalFundingUsd"];
  }

  async enrich(_ctx: ProviderCtx, company: CanonicalCompany, fields: CanonicalFieldPath[]): Promise<EnrichmentResult> {
    const domain = company.identity.domain ?? "";
    const attributes: NewAttribute[] = [];
    const unavailable: CanonicalFieldPath[] = [];
    const observedAt = new Date().toISOString();

    for (const field of fields) {
      if (NEVER_AVAILABLE_DOMAINS.has(domain)) {
        unavailable.push(field);
        continue;
      }
      if (field === "firmographics.revenueUsd" && REVENUE_FIXTURE[domain] !== undefined) {
        attributes.push({ field, value: REVENUE_FIXTURE[domain], confidence: 85, observedAt });
        continue;
      }

      unavailable.push(field);
    }

    return { attributes, unavailable, costUnits: fields.length, raw: { domain, requested: fields } };
  }
}
