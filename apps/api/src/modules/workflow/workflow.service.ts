import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { WorkflowRun, WorkflowStep } from "@prisma/client";
import { ErrorCodes, type StartWorkflowRunDto, type WorkflowRunSummary, type WorkflowStepSummary } from "@prospect/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { conflict, notFound } from "../../common/errors";
import type { WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { ProjectsService } from "../projects/projects.service";
import { InProcessJobDispatcher } from "./job-dispatcher";
import { STEP_ORDER } from "./step-handler.interface";

@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly dispatcher: InProcessJobDispatcher,
  ) {}

  async start(ws: WorkspaceContext, projectId: string, userId: string, dto: StartWorkflowRunDto): Promise<{ runId: string }> {
    const project = await this.projects.findOneOrThrow(ws, projectId);

    if (project.status === "ARCHIVED") {
      throw conflict(ErrorCodes.PROJECT_ARCHIVED, "This project is archived — unarchive it before starting a workflow run");
    }
    const activeIcp = await this.prisma.icpProfile.findFirst({ where: { projectId, status: "ACTIVE" } });
    if (!activeIcp) throw conflict(ErrorCodes.ICP_NOT_ACTIVE, "This project has no active ICP — activate one before starting a workflow run");

    const run = await this.prisma.workflowRun.create({
      data: {
        projectId,

        icpProfileId: activeIcp.id,
        status: "PENDING",
        triggeredById: userId,
        options: dto as unknown as Prisma.InputJsonValue,
        summary: {},
      },
    });

    await this.prisma.workflowStep.createMany({
      data: STEP_ORDER.map((stepKey, order) => ({ workflowRunId: run.id, stepKey, order, status: "QUEUED" as const })),
    });

    this.dispatcher.dispatch({ runId: run.id, stepKey: "INGEST" });
    return { runId: run.id };
  }

  async list(ws: WorkspaceContext, projectId: string): Promise<WorkflowRunSummary[]> {
    await this.projects.findOneOrThrow(ws, projectId);
    const runs = await this.prisma.workflowRun.findMany({ where: { projectId, workflowVersionId: null }, orderBy: { createdAt: "desc" }, include: { steps: { orderBy: { order: "asc" } } } });
    return runs.map(toSummary);
  }

  async get(ws: WorkspaceContext, projectId: string, runId: string): Promise<WorkflowRunSummary> {
    return toSummary(await this.findOneOrThrow(ws, projectId, runId));
  }

  async cancel(ws: WorkspaceContext, projectId: string, runId: string): Promise<WorkflowRunSummary> {
    const run = await this.findOneOrThrow(ws, projectId, runId);
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) {
      throw conflict(ErrorCodes.VALIDATION_ERROR, `Cannot cancel a run that is already ${run.status}`);
    }

    await this.prisma.$transaction([
      this.prisma.workflowRun.update({ where: { id: run.id }, data: { status: "CANCELLED", finishedAt: new Date() } }),
      this.prisma.workflowStep.updateMany({
        where: { workflowRunId: run.id, status: { in: ["QUEUED"] } },
        data: { status: "SKIPPED", error: "Cancelled by user", finishedAt: new Date() },
      }),
    ]);
    return this.get(ws, projectId, runId);
  }

  async retry(ws: WorkspaceContext, projectId: string, runId: string): Promise<WorkflowRunSummary> {
    const run = await this.findOneOrThrow(ws, projectId, runId);
    const failedStep = run.steps.filter((s) => s.status === "FAILED").sort((a, b) => a.order - b.order)[0];
    if (!failedStep) throw conflict(ErrorCodes.VALIDATION_ERROR, "This run has no failed step to retry");

    await this.prisma.workflowStep.update({
      where: { id: failedStep.id },
      data: { status: "QUEUED", attempt: { increment: 1 }, error: null, output: Prisma.JsonNull, startedAt: null, finishedAt: null },
    });
    await this.prisma.workflowRun.update({ where: { id: run.id }, data: { status: "PENDING", error: null, finishedAt: null } });

    this.dispatcher.dispatch({ runId: run.id, stepKey: failedStep.stepKey });
    return this.get(ws, projectId, runId);
  }

  private async findOneOrThrow(ws: WorkspaceContext, projectId: string, runId: string): Promise<WorkflowRun & { steps: WorkflowStep[] }> {
    await this.projects.findOneOrThrow(ws, projectId);
    const run = await this.prisma.workflowRun.findFirst({ where: { id: runId, projectId, workflowVersionId: null }, include: { steps: { orderBy: { order: "asc" } } } });
    if (!run) throw notFound("Workflow run");
    return run;
  }
}

function toSummary(run: WorkflowRun & { steps: WorkflowStep[] }): WorkflowRunSummary {
  return {
    id: run.id,
    projectId: run.projectId,
    icpProfileId: run.icpProfileId,
    status: run.status,
    options: run.options as Record<string, unknown>,
    summary: run.summary as Record<string, unknown>,
    currentStep: run.currentStep,
    error: run.error,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    steps: run.steps.map((s) => ({
      id: s.id,
      stepKey: s.stepKey,
      order: s.order,
      attempt: s.attempt,
      status: s.status,
      startedAt: s.startedAt?.toISOString() ?? null,
      finishedAt: s.finishedAt?.toISOString() ?? null,
      durationMs: s.startedAt && s.finishedAt ? s.finishedAt.getTime() - s.startedAt.getTime() : null,
      output: (s.output as Record<string, unknown> | null) ?? null,
      error: s.error,
    })) as WorkflowStepSummary[],
  };
}
