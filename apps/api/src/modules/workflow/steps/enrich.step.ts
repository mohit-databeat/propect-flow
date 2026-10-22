import { Injectable } from "@nestjs/common";
import type { WorkflowRun } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { ProviderRegistryService } from "../../../providers/provider-registry.service";
import { EnrichmentService } from "../../enrichment/enrichment.service";
import { enrichOperation } from "../operations/enrich.operation";
import type { StepOutcome, WorkflowStepHandler } from "../step-handler.interface";

@Injectable()
export class EnrichStepHandler implements WorkflowStepHandler {
  readonly key = "ENRICH" as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistryService,
    private readonly enrichment: EnrichmentService,
  ) {}

  async run(run: WorkflowRun): Promise<StepOutcome> {
    const { summary, skipped, skipReason } = await enrichOperation({ prisma: this.prisma, registry: this.registry, enrichment: this.enrichment }, run);
    return { summary, skipped, skipReason };
  }
}
