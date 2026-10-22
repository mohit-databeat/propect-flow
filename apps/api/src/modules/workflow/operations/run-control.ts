import type { PrismaService } from "../../../prisma/prisma.service";
import type { WorkspaceContext } from "../../../common/decorators/current-user.decorator";
import type { StepOutcome } from "../step-handler.interface";

export interface OperationRun {
  id: string;
  projectId: string;
  icpProfileId: string;
}

export interface ItemOutcome extends StepOutcome {
  itemIds: string[];
}

export async function isRunCancelled(prisma: Pick<PrismaService, "workflowRun">, runId: string): Promise<boolean> {
  const fresh = await prisma.workflowRun.findUnique({ where: { id: runId }, select: { status: true } });
  return fresh?.status === "CANCELLED";
}

export function systemWorkspace(workspaceId: string): WorkspaceContext {
  return { id: workspaceId, role: "OWNER" };
}
