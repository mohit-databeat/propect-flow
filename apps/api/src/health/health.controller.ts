import { Controller, Get } from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { env } from "../config/env";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    const dbOk = await this.prisma.isHealthy();
    return {
      status: dbOk ? "ok" : "degraded",
      db: dbOk ? "ok" : "unreachable",
      providers: {
        ai: { key: env.AI_PROVIDER, available: true, configured: env.AI_PROVIDER === "mock" || Boolean(env.ANTHROPIC_API_KEY) },
        enrichment: { key: env.ENRICHMENT_PROVIDER, available: env.ENRICHMENT_PROVIDER === "mock_enrichment", configured: env.ENRICHMENT_PROVIDER === "mock_enrichment" || Boolean(env.APOLLO_API_KEY) },
        outbound: { key: env.OUTBOUND_PROVIDER, available: env.OUTBOUND_PROVIDER === "simulated", configured: env.OUTBOUND_PROVIDER === "simulated" || Boolean(env.SMTP_HOST) },
      },
    };
  }
}
