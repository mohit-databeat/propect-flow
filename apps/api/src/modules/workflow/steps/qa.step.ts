import { Injectable } from "@nestjs/common";
import type { WorkflowRun } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { MessagesService } from "../../messages/messages.service";
import type { StepOutcome, WorkflowStepHandler } from "../step-handler.interface";

@Injectable()
export class QaStepHandler implements WorkflowStepHandler {
  readonly key = "QA" as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
  ) {}

  async run(run: WorkflowRun): Promise<StepOutcome> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: run.projectId } });
    const ws = { id: project.workspaceId, role: "OWNER" as const };

    const pending = await this.prisma.message.findMany({
      where: { qaStatus: "PENDING", prospect: { workflowRunId: run.id } },
      select: { id: true },
    });
    if (pending.length === 0) {
      return { summary: { considered: 0 }, skipped: true, skipReason: "No drafted emails are pending QA for this run" };
    }

    let pass = 0;
    let warn = 0;
    let fail = 0;
    let errored = 0;
    for (const m of pending) {
      try {
        const result = await this.messages.runQa(ws, run.projectId, m.id);
        if (result.qaStatus === "PASS") pass++;
        else if (result.qaStatus === "WARN") warn++;
        else if (result.qaStatus === "FAIL") fail++;
      } catch {
        errored++;
      }
    }

    return { summary: { considered: pending.length, pass, warn, fail, errored } };
  }
}
