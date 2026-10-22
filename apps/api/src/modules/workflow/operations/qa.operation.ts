import type { PrismaService } from "../../../prisma/prisma.service";
import type { MessagesService } from "../../messages/messages.service";
import { systemWorkspace, type ItemOutcome, type OperationRun } from "./run-control";

export interface QaDeps {
  prisma: PrismaService;
  messages: MessagesService;
}

export async function qaOperation(deps: QaDeps, run: OperationRun, prospectIds?: string[]): Promise<ItemOutcome> {
  const project = await deps.prisma.project.findUniqueOrThrow({ where: { id: run.projectId } });
  const ws = systemWorkspace(project.workspaceId);
  const prospectFilter = { workflowRunId: run.id, ...(prospectIds ? { id: { in: prospectIds } } : {}) };

  const pending = await deps.prisma.message.findMany({
    where: { qaStatus: "PENDING", prospect: prospectFilter },
    select: { id: true },
  });
  if (pending.length === 0) {
    return { summary: { considered: 0 }, skipped: true, skipReason: "No drafted emails are pending QA for this run", itemIds: await draftedProspectIds(deps.prisma, run.projectId, prospectFilter) };
  }

  let pass = 0;
  let warn = 0;
  let fail = 0;
  let errored = 0;
  for (const m of pending) {
    try {
      const result = await deps.messages.runQa(ws, run.projectId, m.id);
      if (result.qaStatus === "PASS") pass++;
      else if (result.qaStatus === "WARN") warn++;
      else if (result.qaStatus === "FAIL") fail++;
    } catch {
      errored++;
    }
  }

  return { summary: { considered: pending.length, pass, warn, fail, errored }, itemIds: await draftedProspectIds(deps.prisma, run.projectId, prospectFilter) };
}

async function draftedProspectIds(prisma: PrismaService, projectId: string, prospectFilter: object): Promise<string[]> {
  const rows = await prisma.message.findMany({
    where: { projectId, sendStatus: "NOT_SENT", prospect: prospectFilter },
    select: { prospectId: true },
  });
  return [...new Set(rows.map((r) => r.prospectId).filter((id): id is string => id !== null))];
}
