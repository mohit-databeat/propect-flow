import { Injectable } from "@nestjs/common";
import type { CanonicalCompany, CanonicalFieldPath, ProviderCtx } from "@prospect/shared";
import type { EnrichmentProvider, EnrichmentResult } from "../enrichment-provider.interface";

@Injectable()
export class ApolloEnrichStubProvider implements EnrichmentProvider {
  readonly key = "apollo_enrich";
  readonly displayName = "Apollo Enrichment (not yet implemented)";
  readonly isMock = false;
  readonly available = false;
  readonly requiredCredentials = ["APOLLO_API_KEY"];
  readonly rateLimit = { rpm: 60, concurrency: 2 };

  supportedFields(): CanonicalFieldPath[] {
    return [];
  }

  enrich(_ctx: ProviderCtx, _company: CanonicalCompany, _fields: CanonicalFieldPath[]): Promise<EnrichmentResult> {
    return Promise.reject(new Error("apollo_enrich provider is a documented stub and is not implemented"));
  }
}
