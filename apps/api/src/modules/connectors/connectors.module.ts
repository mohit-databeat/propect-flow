import { Module, OnModuleInit } from "@nestjs/common";
import { ProviderRegistryService } from "../../providers/provider-registry.service";
import { CsvConnector } from "./csv.connector";
import { MockApolloConnector } from "./mock-apollo.connector";
import { ApolloStubConnector } from "./apollo-stub.connector";

@Module({
  providers: [CsvConnector, MockApolloConnector, ApolloStubConnector],
  exports: [CsvConnector, MockApolloConnector, ApolloStubConnector],
})
export class ConnectorsModule implements OnModuleInit {
  constructor(
    private readonly registry: ProviderRegistryService,
    private readonly csv: CsvConnector,
    private readonly mockApollo: MockApolloConnector,
    private readonly apolloStub: ApolloStubConnector,
  ) {}

  onModuleInit(): void {
    this.registry.registerConnector(this.csv);
    this.registry.registerConnector(this.mockApollo);
    this.registry.registerConnector(this.apolloStub);
  }
}
