import { Injectable } from "@nestjs/common";
import type { WorkflowRun } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { env } from "../../../config/env";
import { MessagesService } from "../../messages/messages.service";
import { generateEmailOperation } from "../operations/generate-email.operation";
import type { StepOutcome, WorkflowStepHandler } from "../step-handler.interface";

@Injectable()
export class GenerateEmailStepHandler implements WorkflowStepHandler {
  readonly key = "GENERATE_EMAIL" as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
  ) {}

  async run(run: WorkflowRun): Promise<StepOutcome> {
    const { summary, skipped, skipReason } = await generateEmailOperation({ prisma: this.prisma, messages: this.messages }, run, { cap: env.MAX_LLM_PROSPECTS_PER_RUN });
    return { summary, skipped, skipReason };
  }
}
