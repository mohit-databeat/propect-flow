import { Injectable } from "@nestjs/common";
import type { WorkflowRun } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { MessagesService } from "../../messages/messages.service";
import { qaOperation } from "../operations/qa.operation";
import type { StepOutcome, WorkflowStepHandler } from "../step-handler.interface";

@Injectable()
export class QaStepHandler implements WorkflowStepHandler {
  readonly key = "QA" as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
  ) {}

  async run(run: WorkflowRun): Promise<StepOutcome> {
    const { summary, skipped, skipReason } = await qaOperation({ prisma: this.prisma, messages: this.messages }, run);
    return { summary, skipped, skipReason };
  }
}
