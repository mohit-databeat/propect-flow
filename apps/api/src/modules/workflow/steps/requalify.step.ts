import { Injectable } from "@nestjs/common";
import type { WorkflowRun } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { env } from "../../../config/env";
import { QualificationService } from "../../qualification/qualification.service";
import { newAssessmentStats } from "../../qualification/qualitative-assessor.service";
import type { StepOutcome, WorkflowStepHandler } from "../step-handler.interface";

interface ProspectSummary {
  requiredFails?: string[];
}

@Injectable()
export class RequalifyStepHandler implements WorkflowStepHandler {
  readonly key = "REQUALIFY" as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly qualification: QualificationService,
  ) {}

  async run(run: WorkflowRun): Promise<StepOutcome> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: run.projectId } });
    const prospects = await this.prisma.prospect.findMany({ where: { workflowRunId: run.id } });

    if (prospects.length === 0) {
      return { summary: { considered: 0 }, skipped: true, skipReason: "No prospects were produced by QUALIFY for this run" };
    }

    const skippedHardFail = prospects.filter((p) => ((p.summary as ProspectSummary)?.requiredFails?.length ?? 0) > 0).length;

    const fresh = await this.prisma.workflowRun.findUnique({ where: { id: run.id }, select: { status: true } });
    if (fresh?.status === "CANCELLED") {
      return { summary: { considered: prospects.length, skippedHardFail }, skipped: true, skipReason: "Workflow run was cancelled before REQUALIFY started" };
    }

    const stats = newAssessmentStats();
    const results = await this.qualification.requalifyCompanies(
      prospects.map((p) => p.companyId),
      run.icpProfileId,
      run.id,
      {
        workspaceId: project.workspaceId,
        projectId: run.projectId,
        workflowRunId: run.id,
        batchSize: env.AI_ASSESS_BATCH_SIZE,
        budget: { used: 0, max: env.MAX_LLM_PROSPECTS_PER_RUN },
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
    };
  }
}
