import { Injectable } from "@nestjs/common";
import type { WorkflowRun } from "@prisma/client";
import type { CanonicalFieldPath } from "@prospect/shared";
import { WorkspaceSettings } from "@prospect/shared";
import { PrismaService } from "../../../prisma/prisma.service";
import { ProviderRegistryService } from "../../../providers/provider-registry.service";
import { env } from "../../../config/env";
import { EnrichmentService } from "../../enrichment/enrichment.service";
import type { StepOutcome, WorkflowStepHandler } from "../step-handler.interface";

interface ProspectSummary {
  requiredFails?: string[];
  missingFields?: string[];
}

@Injectable()
export class EnrichStepHandler implements WorkflowStepHandler {
  readonly key = "ENRICH" as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistryService,
    private readonly enrichment: EnrichmentService,
  ) {}

  async run(run: WorkflowRun): Promise<StepOutcome> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: run.projectId } });
    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: project.workspaceId } });
    const settings = WorkspaceSettings.parse(workspace.settings);
    const providerKey = settings.enrichmentProviderKey || env.ENRICHMENT_PROVIDER;

    const prospects = await this.prisma.prospect.findMany({ where: { workflowRunId: run.id } });

    const eligible = prospects.filter((p) => {
      const summary = (p.summary as ProspectSummary) ?? {};
      return (summary.requiredFails?.length ?? 0) === 0 && (summary.missingFields?.length ?? 0) > 0;
    });
    const skippedHardFail = prospects.filter((p) => ((p.summary as ProspectSummary)?.requiredFails?.length ?? 0) > 0).length;

    if (eligible.length === 0) {
      return { summary: { considered: prospects.length, skippedHardFail, enrichmentCalls: 0 }, skipped: true, skipReason: "No eligible prospect has a missing field to enrich" };
    }

    const provider = this.registry.getEnricher(providerKey);
    this.registry.ctxFor(project.workspaceId, provider);

    let fieldsRequested = 0;
    let fieldsFound = 0;
    let fieldsUnavailable = 0;
    let calls = 0;

    for (const prospect of eligible) {
      const fresh = await this.prisma.workflowRun.findUnique({ where: { id: run.id }, select: { status: true } });
      if (fresh?.status === "CANCELLED") break;

      const missing = ((prospect.summary as ProspectSummary).missingFields ?? []) as CanonicalFieldPath[];
      const outcome = await this.enrichment.enrichCompany({
        workspaceId: project.workspaceId,
        projectId: run.projectId,
        companyId: prospect.companyId,
        workflowRunId: run.id,
        providerKey,
        missingFields: missing,
      });
      if (outcome.ran) {
        calls++;
        fieldsRequested += outcome.requested.length;
        fieldsFound += outcome.supplied.length;
        fieldsUnavailable += outcome.unavailable.length;
      }
    }

    return { summary: { considered: prospects.length, eligible: eligible.length, skippedHardFail, enrichmentCalls: calls, fieldsRequested, fieldsFound, fieldsUnavailable } };
  }
}
