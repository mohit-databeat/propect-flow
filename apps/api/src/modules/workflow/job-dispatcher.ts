import { Injectable, Logger } from "@nestjs/common";
import type { WorkflowStepKey } from "@prisma/client";

export interface WorkflowJob {
  runId: string;
  stepKey: WorkflowStepKey;
}

export interface JobDispatcher {
  dispatch(job: WorkflowJob): void;
}

@Injectable()
export class InProcessJobDispatcher implements JobDispatcher {
  private readonly logger = new Logger(InProcessJobDispatcher.name);
  private executor?: (job: WorkflowJob) => Promise<void>;

  setExecutor(executor: (job: WorkflowJob) => Promise<void>): void {
    this.executor = executor;
  }

  dispatch(job: WorkflowJob): void {
    if (!this.executor) {
      this.logger.error("dispatch() called before an executor was wired — job dropped");
      return;
    }
    process.nextTick(() => {
      this.executor!(job).catch((err) => this.logger.error(`Unhandled error executing ${job.stepKey} for run ${job.runId}: ${err instanceof Error ? err.message : err}`));
    });
  }
}
