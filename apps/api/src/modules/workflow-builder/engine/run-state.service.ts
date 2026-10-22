import { Injectable } from "@nestjs/common";
import type { Prisma, WorkflowNodeRunStatus, WorkflowRunStatus } from "@prisma/client";
import type { WorkflowNodeLogEntry } from "@prospect/shared";
import { PrismaService } from "../../../prisma/prisma.service";

export type LogLevel = WorkflowNodeLogEntry["level"];

export interface NodeTransitionPatch {
  input?: string[];
  outputs?: Record<string, string[]>;
  summary?: Record<string, unknown>;
  error?: string | null;
  startedAt?: Date;
  finishedAt?: Date;
}

export interface RunTransitionPatch {
  error?: string | null;
  startedAt?: Date;
  finishedAt?: Date | null;
  currentStep?: string | null;
}

const MAX_LOG_ENTRIES = 200;
const MAX_LOG_MESSAGE_LENGTH = 500;

function entry(level: LogLevel, message: string): WorkflowNodeLogEntry {
  return { at: new Date().toISOString(), level, message: message.slice(0, MAX_LOG_MESSAGE_LENGTH) };
}

@Injectable()
export class RunStateService {
  constructor(private readonly prisma: PrismaService) {}

  async transitionNode(
    nodeRunId: string,
    from: readonly WorkflowNodeRunStatus[],
    to: WorkflowNodeRunStatus,
    patch: NodeTransitionPatch,
    log: { level?: LogLevel; message: string },
  ): Promise<boolean> {
    const current = await this.prisma.workflowNodeRun.findUnique({ where: { id: nodeRunId }, select: { logs: true } });
    if (!current) return false;
    const logs = [...(current.logs as unknown as WorkflowNodeLogEntry[]), entry(log.level ?? "info", log.message)].slice(-MAX_LOG_ENTRIES);

    const data: Prisma.WorkflowNodeRunUpdateManyMutationInput = { status: to, logs: logs as unknown as Prisma.InputJsonValue };
    if (patch.input !== undefined) data.input = patch.input as unknown as Prisma.InputJsonValue;
    if (patch.outputs !== undefined) data.outputs = patch.outputs as unknown as Prisma.InputJsonValue;
    if (patch.summary !== undefined) data.summary = patch.summary as unknown as Prisma.InputJsonValue;
    if (patch.error !== undefined) data.error = patch.error;
    if (patch.startedAt !== undefined) data.startedAt = patch.startedAt;
    if (patch.finishedAt !== undefined) data.finishedAt = patch.finishedAt;

    const result = await this.prisma.workflowNodeRun.updateMany({ where: { id: nodeRunId, status: { in: [...from] } }, data });
    return result.count === 1;
  }

  async appendLog(nodeRunId: string, level: LogLevel, message: string): Promise<void> {
    const current = await this.prisma.workflowNodeRun.findUnique({ where: { id: nodeRunId }, select: { logs: true } });
    if (!current) return;
    const logs = [...(current.logs as unknown as WorkflowNodeLogEntry[]), entry(level, message)].slice(-MAX_LOG_ENTRIES);
    await this.prisma.workflowNodeRun.update({ where: { id: nodeRunId }, data: { logs: logs as unknown as Prisma.InputJsonValue } });
  }

  async transitionRun(runId: string, from: readonly WorkflowRunStatus[], to: WorkflowRunStatus, patch: RunTransitionPatch = {}): Promise<boolean> {
    const result = await this.prisma.workflowRun.updateMany({
      where: { id: runId, status: { in: [...from] } },
      data: { status: to, ...patch },
    });
    return result.count === 1;
  }
}
