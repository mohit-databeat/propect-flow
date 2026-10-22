import type { PrismaService } from "../../../prisma/prisma.service";
import { env } from "../../../config/env";
import type { QualificationService } from "../../qualification/qualification.service";
import { newAssessmentStats, type LlmBudget } from "../../qualification/qualitative-assessor.service";
import { isRunCancelled, type ItemOutcome, type OperationRun } from "./run-control";

export interface RequalifyDeps {
  prisma: PrismaService;
  qualification: QualificationService;
}

interface ProspectSummary {
  requiredFails?: string[];
}

export async function requalifyOperation(deps: RequalifyDeps, run: OperationRun, prospectIds?: string[], budget?: LlmBudget): Promise<ItemOutcome> {
  const project = await deps.prisma.project.findUniqueOrThrow({ where: { id: run.projectId } });
  const prospects = await deps.prisma.prospect.findMany({ where: { workflowRunId: run.id, ...(prospectIds ? { id: { in: prospectIds } } : {}) } });
  const itemIds = prospects.map((p) => p.id);

  if (prospects.length === 0) {
    return { summary: { considered: 0 }, skipped: true, skipReason: "No prospects were produced by QUALIFY for this run", itemIds };
  }

  const skippedHardFail = prospects.filter((p) => ((p.summary as ProspectSummary)?.requiredFails?.length ?? 0) > 0).length;

  if (await isRunCancelled(deps.prisma, run.id)) {
    return { summary: { considered: prospects.length, skippedHardFail }, skipped: true, skipReason: "Workflow run was cancelled before REQUALIFY started", itemIds };
  }

  const stats = newAssessmentStats();
  const results = await deps.qualification.requalifyCompanies(
    prospects.map((p) => p.companyId),
    run.icpProfileId,
    run.id,
    {
      workspaceId: project.workspaceId,
      projectId: run.projectId,
      workflowRunId: run.id,
      batchSize: env.AI_ASSESS_BATCH_SIZE,
      budget: budget ?? { used: 0, max: env.MAX_LLM_PROSPECTS_PER_RUN },
      stats,
    },
  );

  let qualified = 0;
  let disqualified = 0;
  let needsReview = 0;
  let pending = 0;
  for (const r of results.values()) {
    if (r.status === "QUALIFIED") qualified++;
    else if (r.status === "DISQUALIFIED") disqualified++;
    else if (r.status === "NEEDS_REVIEW") needsReview++;
    else pending++;
  }

  return {
    summary: {
      considered: prospects.length,
      skippedHardFail,
      evaluated: results.size,
      qualified,
      disqualified,
      needsReview,
      pending,
      llmAssessments: stats.llmCalls,
      cachedAssessments: stats.cacheHits,
      llmCapReached: stats.capReached,
      unknownDueToMissingEvidence: stats.missingEvidenceUnknown,
    },
    itemIds,
  };
}
