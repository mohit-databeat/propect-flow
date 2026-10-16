import { Injectable, Logger } from "@nestjs/common";
import type { WorkflowStepKey } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { InProcessJobDispatcher } from "./job-dispatcher";
import { nextStepKey, type WorkflowStepHandler } from "./step-handler.interface";
import { IngestStepHandler } from "./steps/ingest.step";
import { NormalizeStepHandler } from "./steps/normalize.step";
import { QualifyStepHandler } from "./steps/qualify.step";
import { EnrichStepHandler } from "./steps/enrich.step";
import { RequalifyStepHandler } from "./steps/requalify.step";
import { GenerateEmailStepHandler } from "./steps/generate-email.step";
import { QaStepHandler } from "./steps/qa.step";
import { AwaitReviewStepHandler } from "./steps/await-review.step";

@Injectable()
export class WorkflowRunnerService {
  private readonly logger = new Logger(WorkflowRunnerService.name);
  private readonly handlers: Map<WorkflowStepKey, WorkflowStepHandler>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: InProcessJobDispatcher,
    ingest: IngestStepHandler,
    normalize: NormalizeStepHandler,
    qualify: QualifyStepHandler,
    enrich: EnrichStepHandler,
    requalify: RequalifyStepHandler,
    generateEmail: GenerateEmailStepHandler,
    qa: QaStepHandler,
    awaitReview: AwaitReviewStepHandler,
  ) {
    this.handlers = new Map<WorkflowStepKey, WorkflowStepHandler>([
      [ingest.key, ingest],
      [normalize.key, normalize],
      [qualify.key, qualify],
      [enrich.key, enrich],
      [requalify.key, requalify],
      [generateEmail.key, generateEmail],
      [qa.key, qa],
      [awaitReview.key, awaitReview],
    ]);
  }

  async executeStep(job: { runId: string; stepKey: WorkflowStepKey }): Promise<void> {
    const run = await this.prisma.workflowRun.findUnique({ where: { id: job.runId } });
    if (!run || run.status === "CANCELLED") return;

    const step = await this.prisma.workflowStep.findFirst({ where: { workflowRunId: job.runId, stepKey: job.stepKey }, orderBy: { attempt: "desc" } });
    if (!step) {
      this.logger.error(`No WorkflowStep row for run=${job.runId} step=${job.stepKey}`);
      return;
    }

    if (step.status === "SUCCEEDED" || step.status === "SKIPPED") {
      return this.advance(job.runId, job.stepKey);
    }

    await this.prisma.workflowStep.update({ where: { id: step.id }, data: { status: "RUNNING", startedAt: new Date() } });
    await this.prisma.workflowRun.update({
      where: { id: job.runId },
      data: { status: "RUNNING", currentStep: job.stepKey, startedAt: run.startedAt ?? new Date() },
    });

    const handler = this.handlers.get(job.stepKey);
    if (!handler) {
      await this.failRun(job.runId, step.id, `No handler registered for step ${job.stepKey}`);
      return;
    }

    try {
      const outcome = await handler.run(run, step);
      await this.prisma.workflowStep.update({
        where: { id: step.id },
        data: {
          status: outcome.skipped ? "SKIPPED" : "SUCCEEDED",
          output: outcome.summary as unknown as Prisma.InputJsonValue,
          error: outcome.skipped ? (outcome.skipReason ?? null) : null,
          finishedAt: new Date(),
        },
      });
      await this.mergeRunSummary(job.runId, job.stepKey, outcome.summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown step error";
      await this.failRun(job.runId, step.id, message);
      return;
    }

    await this.advance(job.runId, job.stepKey);
  }

  private async failRun(runId: string, stepId: string, message: string): Promise<void> {
    await this.prisma.workflowStep.update({ where: { id: stepId }, data: { status: "FAILED", error: message, finishedAt: new Date() } });
    await this.prisma.workflowRun.update({ where: { id: runId }, data: { status: "FAILED", error: message, finishedAt: new Date() } });
  }

  private async mergeRunSummary(runId: string, stepKey: WorkflowStepKey, stepSummary: Record<string, unknown>): Promise<void> {
    const run = await this.prisma.workflowRun.findUniqueOrThrow({ where: { id: runId } });
    const summary = { ...(run.summary as object), [stepKey.toLowerCase()]: stepSummary };
    await this.prisma.workflowRun.update({ where: { id: runId }, data: { summary: summary as unknown as Prisma.InputJsonValue } });
  }

  private async advance(runId: string, completedStep: WorkflowStepKey): Promise<void> {
    const run = await this.prisma.workflowRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.status === "CANCELLED") return;

    const next = nextStepKey(completedStep);
    if (!next) {
      await this.prisma.workflowRun.update({ where: { id: runId }, data: { status: "COMPLETED", finishedAt: new Date(), currentStep: null } });
      return;
    }
    this.dispatcher.dispatch({ runId, stepKey: next });
  }
}
