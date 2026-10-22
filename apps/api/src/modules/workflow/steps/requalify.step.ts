import { Injectable } from "@nestjs/common";
import type { WorkflowRun } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { QualificationService } from "../../qualification/qualification.service";
import { requalifyOperation } from "../operations/requalify.operation";
import type { StepOutcome, WorkflowStepHandler } from "../step-handler.interface";

@Injectable()
export class RequalifyStepHandler implements WorkflowStepHandler {
  readonly key = "REQUALIFY" as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly qualification: QualificationService,
  ) {}

  async run(run: WorkflowRun): Promise<StepOutcome> {
    const { summary, skipped, skipReason } = await requalifyOperation({ prisma: this.prisma, qualification: this.qualification }, run);
    return { summary, skipped, skipReason };
  }
}
