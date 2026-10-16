import { Global, Module } from "@nestjs/common";
import { ProviderRegistryService } from "./provider-registry.service";

@Global()
@Module({
  providers: [ProviderRegistryService],
  exports: [ProviderRegistryService],
})
export class ProvidersModule {}
