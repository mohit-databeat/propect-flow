import { Injectable } from "@nestjs/common";
import type { WorkflowRun } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import type { StepOutcome, WorkflowStepHandler } from "../step-handler.interface";

@Injectable()
export class AwaitReviewStepHandler implements WorkflowStepHandler {
  readonly key = "AWAIT_REVIEW" as const;

  constructor(private readonly prisma: PrismaService) {}

  async run(run: WorkflowRun): Promise<StepOutcome> {
    const messages = await this.prisma.message.findMany({ where: { prospect: { workflowRunId: run.id } }, select: { reviewStatus: true, qaStatus: true } });
    const pendingReview = messages.filter((m) => m.reviewStatus === "PENDING" || m.reviewStatus === "EDITED").length;
    const approved = messages.filter((m) => m.reviewStatus === "APPROVED").length;
    const rejected = messages.filter((m) => m.reviewStatus === "REJECTED").length;

    if (messages.length === 0) {
      return { summary: { total: 0 }, skipped: true, skipReason: "No emails were generated for this run" };
    }
    return { summary: { total: messages.length, pendingReview, approved, rejected } };
  }
}
