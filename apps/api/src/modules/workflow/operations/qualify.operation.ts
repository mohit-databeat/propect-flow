import type { PrismaService } from "../../../prisma/prisma.service";
import type { QualificationService } from "../../qualification/qualification.service";
import { isRunCancelled, type ItemOutcome, type OperationRun } from "./run-control";

export interface QualifyDeps {
  prisma: PrismaService;
  qualification: QualificationService;
}

export async function qualifyOperation(deps: QualifyDeps, run: OperationRun, companyIds?: string[]): Promise<ItemOutcome> {
  const companies = await deps.prisma.company.findMany({
    where: { projectId: run.projectId, ...(companyIds ? { id: { in: companyIds } } : {}) },
    select: { id: true },
  });

  let qualified = 0;
  let disqualified = 0;
  let needsReview = 0;
  let pending = 0;
  let evaluated = 0;
  const itemIds: string[] = [];

  for (const company of companies) {
    if (await isRunCancelled(deps.prisma, run.id)) break;

    const result = await deps.qualification.qualifyCompany({
      runId: run.id,
      companyId: company.id,
      icpProfileId: run.icpProfileId,
      phase: "INITIAL",
    });
    evaluated++;
    itemIds.push(result.prospectId);
    if (result.status === "QUALIFIED") qualified++;
    else if (result.status === "DISQUALIFIED") disqualified++;
    else if (result.status === "NEEDS_REVIEW") needsReview++;
    else pending++;
  }

  return { summary: { companiesInProject: companies.length, evaluated, qualified, disqualified, needsReview, pending }, itemIds };
}
