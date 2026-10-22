import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ErrorCodes,
  WorkflowDefinition,
  type StartWorkflowExecutionDto,
  type StartWorkflowExecutionResponse,
  type WorkflowExecutionDto,
  type WorkflowExecutionSummaryDto,
} from "@prospect/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { badRequest, conflict, notFound } from "../../common/errors";
import type { WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { ProjectsService } from "../projects/projects.service";
import { GraphExecutorService } from "./engine/graph-executor.service";
import { latestAttempts, type NodeRunState } from "./engine/graph-state";
import { RunStateService } from "./engine/run-state.service";
import { toExecutionDto, type ExecutionRow } from "./execution.mapper";
import { ProjectDefinitionValidator } from "./project-definition-validator.service";
import { WorkflowsService } from "./workflows.service";

const ACTIVE_STATUSES = ["PENDING", "RUNNING", "AWAITING_REVIEW"] as const;
const MAX_LISTED_EXECUTIONS = 50;

function stateOf(row: { nodeId: string; attempt: number; status: NodeRunState["status"]; outputs: unknown }): NodeRunState {
  return { nodeId: row.nodeId, attempt: row.attempt, status: row.status, outputs: (row.outputs as Record<string, string[]> | null) ?? null };
}

@Injectable()
export class ExecutionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly workflows: WorkflowsService,
    private readonly validator: ProjectDefinitionValidator,
    private readonly executor: GraphExecutorService,
    private readonly state: RunStateService,
  ) {}

  async start(ws: WorkspaceContext, projectId: string, workflowId: string, userId: string, dto: StartWorkflowExecutionDto): Promise<StartWorkflowExecutionResponse> {
    const workflow = await this.workflows.findOwnedOrThrow(ws, projectId, workflowId);
    if (workflow.status === "ARCHIVED") throw conflict(ErrorCodes.WORKFLOW_ARCHIVED, "This workflow is archived and cannot be run");

    const project = await this.projects.findOneOrThrow(ws, projectId);
    if (project.status === "ARCHIVED") throw conflict(ErrorCodes.PROJECT_ARCHIVED, "This project is archived. Unarchive it before running a workflow");

    const version = await this.prisma.workflowVersion.findFirst({ where: { id: dto.versionId, workflowId: workflow.id } });
    if (!version) throw notFound("Workflow version");

    const result = await this.validator.validate(ws, projectId, version.definition);
    if (!result.valid) {
      throw badRequest(ErrorCodes.WORKFLOW_INVALID, `This version has ${result.issues.length} problem(s) and cannot be run`, result.issues);
    }

    const activeIcp = await this.prisma.icpProfile.findFirst({ where: { projectId, status: "ACTIVE" } });
    if (!activeIcp) throw conflict(ErrorCodes.ICP_NOT_ACTIVE, "This project has no active ICP. Activate one before running a workflow");

    const definition = WorkflowDefinition.parse(version.definition);
    const run = await this.prisma.workflowRun.create({
      data: {
        projectId,
        icpProfileId: activeIcp.id,
        workflowVersionId: version.id,
        status: "PENDING",
        triggeredById: userId,
        options: (dto.maxLlmProspects ? { maxLlmProspects: dto.maxLlmProspects } : {}) as Prisma.InputJsonValue,
        summary: {},
        nodeRuns: { create: definition.nodes.map((n) => ({ nodeId: n.id, nodeType: n.type, attempt: 1, status: "QUEUED" as const })) },
      },
    });

    this.executor.schedule(run.id);
    return { runId: run.id };
  }

  async listForWorkflow(ws: WorkspaceContext, projectId: string, workflowId: string): Promise<WorkflowExecutionSummaryDto[]> {
    const workflow = await this.workflows.findOwnedOrThrow(ws, projectId, workflowId);
    const rows = await this.prisma.workflowRun.findMany({
      where: { projectId, workflowVersion: { workflowId: workflow.id } },
      orderBy: { createdAt: "desc" },
      take: MAX_LISTED_EXECUTIONS,
      include: { workflowVersion: { select: { version: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      workflowVersion: r.workflowVersion!.version,
      status: r.status,
      error: r.error,
      startedAt: r.startedAt?.toISOString() ?? null,
      finishedAt: r.finishedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async get(ws: WorkspaceContext, projectId: string, runId: string): Promise<WorkflowExecutionDto> {
    return toExecutionDto(await this.findRunOrThrow(ws, projectId, runId));
  }

  async cancel(ws: WorkspaceContext, projectId: string, runId: string): Promise<WorkflowExecutionDto> {
    const run = await this.findRunOrThrow(ws, projectId, runId);
    if (!(ACTIVE_STATUSES as readonly string[]).includes(run.status)) {
      throw conflict(ErrorCodes.WORKFLOW_RUN_NOT_ACTIVE, `This run is already ${run.status.toLowerCase()} and cannot be cancelled`);
    }

    const cancelled = await this.state.transitionRun(run.id, ACTIVE_STATUSES, "CANCELLED", { finishedAt: new Date(), currentStep: null });
    if (!cancelled) throw conflict(ErrorCodes.WORKFLOW_RUN_NOT_ACTIVE, "This run finished before it could be cancelled");

    for (const row of this.latestRows(run)) {
      if (row.status === "QUEUED" || row.status === "WAITING") {
        await this.state.transitionNode(row.id, ["QUEUED", "WAITING"], "SKIPPED", { finishedAt: new Date() }, { message: "Cancelled by user" });
      }
    }
    return this.get(ws, projectId, runId);
  }

  async retry(ws: WorkspaceContext, projectId: string, runId: string): Promise<WorkflowExecutionDto> {
    const run = await this.findRunOrThrow(ws, projectId, runId);
    if (run.status !== "FAILED") throw conflict(ErrorCodes.WORKFLOW_RUN_NOT_RETRYABLE, "Only a failed run can be retried");

    const failed = this.latestRows(run).find((r) => r.status === "FAILED");
    if (!failed) throw conflict(ErrorCodes.WORKFLOW_RUN_NOT_RETRYABLE, "This run has no failed step to retry");

    try {
      await this.prisma.workflowNodeRun.create({
        data: { workflowRunId: run.id, nodeId: failed.nodeId, nodeType: failed.nodeType, attempt: failed.attempt + 1, status: "QUEUED" },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw conflict(ErrorCodes.WORKFLOW_RUN_NOT_RETRYABLE, "This step is already being retried");
      }
      throw err;
    }

    await this.state.transitionRun(run.id, ["FAILED"], "PENDING", { error: null, finishedAt: null });
    this.executor.schedule(run.id);
    return this.get(ws, projectId, runId);
  }

  async resume(ws: WorkspaceContext, projectId: string, runId: string, nodeId: string): Promise<WorkflowExecutionDto> {
    const run = await this.findRunOrThrow(ws, projectId, runId);
    const nodeRun = this.latestRows(run).find((r) => r.nodeId === nodeId);
    if (!nodeRun) throw notFound("Workflow step");
    if (run.status !== "AWAITING_REVIEW" || nodeRun.status !== "WAITING") {
      throw conflict(ErrorCodes.WORKFLOW_NODE_NOT_WAITING, "This step is not waiting for review");
    }

    const blocker = await this.executor.blockerFor(run, nodeRun);
    if (blocker) throw conflict(ErrorCodes.REVIEW_INCOMPLETE, blocker);

    const claimed = await this.executor.resumeNode(run, nodeRun);
    if (!claimed) throw conflict(ErrorCodes.WORKFLOW_NODE_NOT_WAITING, "This step was already resumed");
    return this.get(ws, projectId, runId);
  }

  private latestRows(run: ExecutionRow) {
    const latest = latestAttempts(run.nodeRuns.map(stateOf));
    return run.nodeRuns.filter((r) => latest.get(r.nodeId)?.attempt === r.attempt);
  }

  private async findRunOrThrow(ws: WorkspaceContext, projectId: string, runId: string): Promise<ExecutionRow> {
    await this.projects.findOneOrThrow(ws, projectId);
    const run = await this.prisma.workflowRun.findFirst({
      where: { id: runId, projectId, workflowVersionId: { not: null } },
      include: { workflowVersion: true, nodeRuns: true },
    });
    if (!run?.workflowVersion) throw notFound("Workflow execution");
    return run as ExecutionRow;
  }
}
