import { Module, OnModuleInit } from "@nestjs/common";
import { ProviderRegistryService } from "../../providers/provider-registry.service";
import { SimulatedOutboundProvider } from "./providers/simulated-outbound.provider";
import { SmtpStubProvider } from "./providers/smtp-stub.provider";

@Module({
  providers: [SimulatedOutboundProvider, SmtpStubProvider],
  exports: [SimulatedOutboundProvider, SmtpStubProvider],
})
export class OutboundModule implements OnModuleInit {
  constructor(
    private readonly registry: ProviderRegistryService,
    private readonly simulated: SimulatedOutboundProvider,
    private readonly smtp: SmtpStubProvider,
  ) {}

  onModuleInit(): void {
    this.registry.registerOutbound(this.simulated);
    this.registry.registerOutbound(this.smtp);
  }
}
