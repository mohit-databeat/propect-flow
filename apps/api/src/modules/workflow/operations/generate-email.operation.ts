import type { PrismaService } from "../../../prisma/prisma.service";
import { AppException } from "../../../common/errors";
import type { MessagesService } from "../../messages/messages.service";
import { systemWorkspace, type ItemOutcome, type OperationRun } from "./run-control";

export interface GenerateEmailDeps {
  prisma: PrismaService;
  messages: MessagesService;
}

export async function generateEmailOperation(deps: GenerateEmailDeps, run: OperationRun, opts: { prospectIds?: string[]; cap: number; adoptExisting?: boolean }): Promise<ItemOutcome> {
  const project = await deps.prisma.project.findUniqueOrThrow({ where: { id: run.projectId } });
  const ws = systemWorkspace(project.workspaceId);

  const qualified = await deps.prisma.prospect.findMany({
    where: { workflowRunId: run.id, status: "QUALIFIED", ...(opts.prospectIds ? { id: { in: opts.prospectIds } } : {}) },
  });
  if (qualified.length === 0) {
    return { summary: { qualified: 0, drafted: 0 }, skipped: true, skipReason: "No QUALIFIED prospects in this run", itemIds: [] };
  }

  const existing = await deps.prisma.message.findMany({
    where: { companyId: { in: qualified.map((p) => p.companyId) }, projectId: run.projectId, sendStatus: "NOT_SENT" },
    select: { id: true, companyId: true, prospectId: true },
    orderBy: { createdAt: "desc" },
  });
  const draftByCompany = new Map<string, { id: string; prospectId: string | null }>();
  for (const m of existing) if (!draftByCompany.has(m.companyId)) draftByCompany.set(m.companyId, m);
  const already = new Set(draftByCompany.keys());
  const pending = qualified.filter((p) => !already.has(p.companyId));

  let drafted = 0;
  let noRecipient = 0;
  let failed = 0;
  let capReached = 0;
  const draftedCompanyIds = new Set<string>();

  for (const prospect of pending) {
    if (drafted >= opts.cap) {
      capReached++;
      continue;
    }
    try {
      await deps.messages.generateDraft(ws, run.projectId, prospect.id);
      drafted++;
      draftedCompanyIds.add(prospect.companyId);
    } catch (err) {
      if (err instanceof AppException && err.code === "NO_ELIGIBLE_RECIPIENT") noRecipient++;
      else failed++;
    }
  }

  let adopted = 0;
  if (opts.adoptExisting) {
    for (const prospect of qualified) {
      const draft = draftByCompany.get(prospect.companyId);
      if (!draft || draft.prospectId === prospect.id) continue;
      await deps.prisma.message.update({ where: { id: draft.id }, data: { prospectId: prospect.id } });
      adopted++;
    }
  }

  const itemIds = qualified.filter((p) => already.has(p.companyId) || draftedCompanyIds.has(p.companyId)).map((p) => p.id);
  return { summary: { qualified: qualified.length, alreadyDrafted: already.size, drafted, noRecipient, failed, capReached, ...(opts.adoptExisting ? { adopted } : {}) }, itemIds };
}
