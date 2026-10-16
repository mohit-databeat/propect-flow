import { Module, OnModuleInit } from "@nestjs/common";
import { ProviderRegistryService } from "../../providers/provider-registry.service";
import { NormalizationModule } from "../normalization/normalization.module";
import { EnrichmentService } from "./enrichment.service";
import { MockEnrichmentProvider } from "./providers/mock-enrichment.provider";
import { ApolloEnrichStubProvider } from "./providers/apollo-enrich-stub.provider";

@Module({
  imports: [NormalizationModule],
  providers: [EnrichmentService, MockEnrichmentProvider, ApolloEnrichStubProvider],
  exports: [EnrichmentService],
})
export class EnrichmentModule implements OnModuleInit {
  constructor(
    private readonly registry: ProviderRegistryService,
    private readonly mockEnrichment: MockEnrichmentProvider,
    private readonly apolloEnrich: ApolloEnrichStubProvider,
  ) {}

  onModuleInit(): void {
    this.registry.registerEnricher(this.mockEnrichment);
    this.registry.registerEnricher(this.apolloEnrich);
  }
}
