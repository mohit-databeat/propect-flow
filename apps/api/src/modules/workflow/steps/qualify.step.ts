import { Injectable } from "@nestjs/common";
import type { WorkflowRun } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { QualificationService } from "../../qualification/qualification.service";
import type { StepOutcome, WorkflowStepHandler } from "../step-handler.interface";

@Injectable()
export class QualifyStepHandler implements WorkflowStepHandler {
  readonly key = "QUALIFY" as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly qualification: QualificationService,
  ) {}

  async run(run: WorkflowRun): Promise<StepOutcome> {
    const companies = await this.prisma.company.findMany({ where: { projectId: run.projectId }, select: { id: true } });

    let qualified = 0;
    let disqualified = 0;
    let needsReview = 0;
    let pending = 0;
    let evaluated = 0;

    for (const company of companies) {
      const fresh = await this.prisma.workflowRun.findUnique({ where: { id: run.id }, select: { status: true } });
      if (fresh?.status === "CANCELLED") break;

      const result = await this.qualification.qualifyCompany({
        runId: run.id,
        companyId: company.id,
        icpProfileId: run.icpProfileId,
        phase: "INITIAL",
      });
      evaluated++;
      if (result.status === "QUALIFIED") qualified++;
      else if (result.status === "DISQUALIFIED") disqualified++;
      else if (result.status === "NEEDS_REVIEW") needsReview++;
      else pending++;
    }

    return { summary: { companiesInProject: companies.length, evaluated, qualified, disqualified, needsReview, pending } };
  }
}
