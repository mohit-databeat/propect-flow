import { Injectable } from "@nestjs/common";
import type { WorkflowRun } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { env } from "../../../config/env";
import { AppException } from "../../../common/errors";
import { MessagesService } from "../../messages/messages.service";
import type { StepOutcome, WorkflowStepHandler } from "../step-handler.interface";

@Injectable()
export class GenerateEmailStepHandler implements WorkflowStepHandler {
  readonly key = "GENERATE_EMAIL" as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
  ) {}

  async run(run: WorkflowRun): Promise<StepOutcome> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: run.projectId } });
    const ws = { id: project.workspaceId, role: "OWNER" as const };

    const qualified = await this.prisma.prospect.findMany({ where: { workflowRunId: run.id, status: "QUALIFIED" } });
    if (qualified.length === 0) {
      return { summary: { qualified: 0, drafted: 0 }, skipped: true, skipReason: "No QUALIFIED prospects in this run" };
    }

    const existing = await this.prisma.message.findMany({
      where: { companyId: { in: qualified.map((p) => p.companyId) }, projectId: run.projectId, sendStatus: "NOT_SENT" },
      select: { companyId: true },
    });
    const already = new Set(existing.map((m) => m.companyId));
    const pending = qualified.filter((p) => !already.has(p.companyId));

    let drafted = 0;
    let noRecipient = 0;
    let failed = 0;
    const cap = env.MAX_LLM_PROSPECTS_PER_RUN;
    let capReached = 0;

    for (const prospect of pending) {
      if (drafted >= cap) {
        capReached++;
        continue;
      }
      try {
        await this.messages.generateDraft(ws, run.projectId, prospect.id);
        drafted++;
      } catch (err) {
        if (err instanceof AppException && err.code === "NO_ELIGIBLE_RECIPIENT") noRecipient++;
        else failed++;
      }
    }

    return {
      summary: { qualified: qualified.length, alreadyDrafted: already.size, drafted, noRecipient, failed, capReached },
    };
  }
}
