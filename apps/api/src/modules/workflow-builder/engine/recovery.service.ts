import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { GraphExecutorService } from "./graph-executor.service";
import { latestAttempts } from "./graph-state";
import { RunStateService } from "./run-state.service";

export const INTERRUPTED_MESSAGE = "Interrupted by a server restart. Retry this step to continue.";

@Injectable()
export class RecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: RunStateService,
    private readonly executor: GraphExecutorService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const result = await this.recover();
      if (result.failed > 0 || result.rescheduled > 0) {
        this.logger.warn(`Workflow recovery: ${result.failed} interrupted run(s) marked failed, ${result.rescheduled} run(s) continued`);
      }
    } catch (err) {
      this.logger.error(`Workflow recovery failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  async recover(): Promise<{ failed: number; rescheduled: number }> {
    const runs = await this.prisma.workflowRun.findMany({
      where: { workflowVersionId: { not: null }, status: { in: ["PENDING", "RUNNING"] } },
      include: { nodeRuns: true },
    });

    let failed = 0;
    let rescheduled = 0;
    for (const run of runs) {
      const latest = latestAttempts(run.nodeRuns.map((r) => ({ nodeId: r.nodeId, attempt: r.attempt, status: r.status, outputs: null })));
      const interrupted = run.nodeRuns.filter((r) => latest.get(r.nodeId)?.attempt === r.attempt && r.status === "RUNNING");

      if (interrupted.length === 0) {
        this.executor.schedule(run.id);
        rescheduled++;
        continue;
      }

      for (const row of interrupted) {
        await this.state.transitionNode(row.id, ["RUNNING"], "FAILED", { error: INTERRUPTED_MESSAGE, finishedAt: new Date() }, { level: "error", message: INTERRUPTED_MESSAGE });
      }
      await this.state.transitionRun(run.id, ["PENDING", "RUNNING"], "FAILED", { error: INTERRUPTED_MESSAGE, finishedAt: new Date(), currentStep: null });
      failed++;
    }
    return { failed, rescheduled };
  }
}
