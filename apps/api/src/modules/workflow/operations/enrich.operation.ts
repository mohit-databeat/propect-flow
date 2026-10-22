import type { CanonicalFieldPath } from "@prospect/shared";
import { WorkspaceSettings } from "@prospect/shared";
import type { PrismaService } from "../../../prisma/prisma.service";
import type { ProviderRegistryService } from "../../../providers/provider-registry.service";
import { env } from "../../../config/env";
import type { EnrichmentService } from "../../enrichment/enrichment.service";
import { isRunCancelled, type ItemOutcome, type OperationRun } from "./run-control";

export interface EnrichDeps {
  prisma: PrismaService;
  registry: ProviderRegistryService;
  enrichment: EnrichmentService;
}

interface ProspectSummary {
  requiredFails?: string[];
  missingFields?: string[];
}

export async function enrichOperation(deps: EnrichDeps, run: OperationRun, prospectIds?: string[]): Promise<ItemOutcome> {
  const project = await deps.prisma.project.findUniqueOrThrow({ where: { id: run.projectId } });
  const workspace = await deps.prisma.workspace.findUniqueOrThrow({ where: { id: project.workspaceId } });
  const settings = WorkspaceSettings.parse(workspace.settings);
  const providerKey = settings.enrichmentProviderKey || env.ENRICHMENT_PROVIDER;

  const prospects = await deps.prisma.prospect.findMany({ where: { workflowRunId: run.id, ...(prospectIds ? { id: { in: prospectIds } } : {}) } });
  const itemIds = prospects.map((p) => p.id);

  const eligible = prospects.filter((p) => {
    const summary = (p.summary as ProspectSummary) ?? {};
    return (summary.requiredFails?.length ?? 0) === 0 && (summary.missingFields?.length ?? 0) > 0;
  });
  const skippedHardFail = prospects.filter((p) => ((p.summary as ProspectSummary)?.requiredFails?.length ?? 0) > 0).length;

  if (eligible.length === 0) {
    return {
      summary: { considered: prospects.length, skippedHardFail, enrichmentCalls: 0 },
      skipped: true,
      skipReason: "No eligible prospect has a missing field to enrich",
      itemIds,
    };
  }

  const alreadyRun = await deps.prisma.enrichmentRun.findMany({
    where: { workflowRunId: run.id, status: { in: ["SUCCEEDED", "PARTIAL"] }, companyId: { in: eligible.map((p) => p.companyId) } },
    select: { companyId: true },
  });
  const alreadyEnrichedCompanies = new Set(alreadyRun.map((r) => r.companyId));
  const todo = eligible.filter((p) => !alreadyEnrichedCompanies.has(p.companyId));
  const alreadyEnriched = eligible.length - todo.length;

  const provider = deps.registry.getEnricher(providerKey);
  deps.registry.ctxFor(project.workspaceId, provider);

  let fieldsRequested = 0;
  let fieldsFound = 0;
  let fieldsUnavailable = 0;
  let calls = 0;

  for (const prospect of todo) {
    if (await isRunCancelled(deps.prisma, run.id)) break;

    const missing = ((prospect.summary as ProspectSummary).missingFields ?? []) as CanonicalFieldPath[];
    const outcome = await deps.enrichment.enrichCompany({
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

  return {
    summary: { considered: prospects.length, eligible: eligible.length, alreadyEnriched, skippedHardFail, enrichmentCalls: calls, fieldsRequested, fieldsFound, fieldsUnavailable },
    itemIds,
  };
}
