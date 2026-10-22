import { Injectable, Logger } from "@nestjs/common";
import type { WorkflowNodeRun, WorkflowRun, WorkflowVersion } from "@prisma/client";
import { WorkflowDefinition, NODE_CATALOG, type WorkflowNodeType } from "@prospect/shared";
import { PrismaService } from "../../../prisma/prisma.service";
import { env } from "../../../config/env";
import { AiQaNode } from "../nodes/prospect-nodes";
import { ConditionNode, EnrichNode, GenerateEmailNode, QualifyNode, RequalifyNode } from "../nodes/prospect-nodes";
import { HumanApprovalNode, SimulatedSendNode } from "../nodes/review-and-send-nodes";
import { DataSourceNode, NormalizeNode } from "../nodes/source-nodes";
import { planNext, type NodeRunState } from "./graph-state";
import type { NodeContext, NodeHandler, NodeResult } from "./node-handler.interface";
import { RunStateService } from "./run-state.service";

type RunWithGraph = WorkflowRun & { workflowVersion: WorkflowVersion | null; nodeRuns: WorkflowNodeRun[] };

const ACTIVE_RUN_STATUSES = ["PENDING", "RUNNING", "AWAITING_REVIEW"] as const;
const RUNNABLE_FROM = ["PENDING", "AWAITING_REVIEW"] as const;

function toState(row: WorkflowNodeRun): NodeRunState {
  return { nodeId: row.nodeId, attempt: row.attempt, status: row.status, outputs: (row.outputs as Record<string, string[]> | null) ?? null };
}

function messageOf(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Unknown error";
}

@Injectable()
export class GraphExecutorService {
  private readonly logger = new Logger(GraphExecutorService.name);
  private readonly handlers: Map<WorkflowNodeType, NodeHandler<WorkflowNodeType>>;
  private readonly chains = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: RunStateService,
    dataSource: DataSourceNode,
    normalize: NormalizeNode,
    qualify: QualifyNode,
    condition: ConditionNode,
    enrich: EnrichNode,
    requalify: RequalifyNode,
    generateEmail: GenerateEmailNode,
    aiQa: AiQaNode,
    humanApproval: HumanApprovalNode,
    simulatedSend: SimulatedSendNode,
  ) {
    const all = [dataSource, normalize, qualify, condition, enrich, requalify, generateEmail, aiQa, humanApproval, simulatedSend] as unknown as NodeHandler<WorkflowNodeType>[];
    this.handlers = new Map(all.map((h) => [h.type, h]));
  }

  schedule(runId: string): void {
    const previous = this.chains.get(runId) ?? Promise.resolve();
    const next: Promise<void> = previous
      .then(() => this.advance(runId))
      .catch((err) => this.logger.error(`Unhandled error advancing workflow run ${runId}: ${messageOf(err)}`))
      .finally(() => {
        if (this.chains.get(runId) === next) this.chains.delete(runId);
      });
    this.chains.set(runId, next);
  }

  async idle(runId: string): Promise<void> {
    await this.chains.get(runId);
  }

  async advance(runId: string): Promise<void> {
    for (let guard = 0; guard < 1000; guard++) {
      if (!(await this.step(runId))) return;
    }
    this.logger.error(`Workflow run ${runId} exceeded the step guard and was stopped`);
  }

  async resumeNode(run: RunWithGraph, nodeRun: WorkflowNodeRun): Promise<boolean> {
    const definition = WorkflowDefinition.parse(run.workflowVersion!.definition);
    const node = definition.nodes.find((n) => n.id === nodeRun.nodeId)!;
    const handler = this.handlers.get(node.type);
    if (!handler?.resume) throw new Error(`${NODE_CATALOG[node.type].label} cannot be resumed`);

    const ctx = await this.contextFor(run, definition, nodeRun, node.id, (nodeRun.input as string[] | null) ?? []);
    const claimed = await this.state.transitionNode(nodeRun.id, ["WAITING"], "RUNNING", {}, { message: "Resumed after review" });
    if (!claimed) return false;
    await this.state.transitionRun(run.id, RUNNABLE_FROM, "RUNNING", { currentStep: node.id });

    try {
      const result = await handler.resume(ctx);
      await this.finishNode(run, nodeRun, result);
    } catch (err) {
      await this.failNode(run, nodeRun, node.type, err);
      return true;
    }
    this.schedule(run.id);
    return true;
  }

  async blockerFor(run: RunWithGraph, nodeRun: WorkflowNodeRun): Promise<string | null> {
    const definition = WorkflowDefinition.parse(run.workflowVersion!.definition);
    const node = definition.nodes.find((n) => n.id === nodeRun.nodeId)!;
    const handler = this.handlers.get(node.type);
    if (!handler?.resumeBlocker) return null;
    return handler.resumeBlocker(await this.contextFor(run, definition, nodeRun, node.id, (nodeRun.input as string[] | null) ?? []));
  }

  private async step(runId: string): Promise<boolean> {
    const run = await this.prisma.workflowRun.findUnique({ where: { id: runId }, include: { workflowVersion: true, nodeRuns: true } });
    if (!run?.workflowVersion) return false;
    if (!(ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status)) return false;

    const definition = WorkflowDefinition.parse(run.workflowVersion.definition);
    const plan = planNext(definition, run.nodeRuns.map(toState));

    switch (plan.action) {
      case "running":
        return false;
      case "wait":
        await this.state.transitionRun(run.id, ["PENDING", "RUNNING"], "AWAITING_REVIEW", { currentStep: null });
        return false;
      case "complete":
        await this.state.transitionRun(run.id, ACTIVE_RUN_STATUSES, "COMPLETED", { finishedAt: new Date(), currentStep: null, error: null });
        return false;
      case "fail": {
        const failed = run.nodeRuns.filter((r) => r.nodeId === plan.nodeId).sort((a, b) => b.attempt - a.attempt)[0];
        await this.state.transitionRun(run.id, ACTIVE_RUN_STATUSES, "FAILED", { finishedAt: new Date(), currentStep: null, error: failed?.error ?? "A step failed" });
        return false;
      }
      case "stuck":
        await this.state.transitionRun(run.id, ACTIVE_RUN_STATUSES, "FAILED", {
          finishedAt: new Date(),
          currentStep: null,
          error: `The workflow cannot continue: ${plan.nodeIds.length} step(s) have no way to run`,
        });
        return false;
      case "run":
        return this.execute(run, definition, plan.nodeId, plan.input);
    }
  }

  private async execute(run: RunWithGraph, definition: WorkflowDefinition, nodeId: string, input: string[]): Promise<boolean> {
    const node = definition.nodes.find((n) => n.id === nodeId)!;
    const nodeRun = run.nodeRuns.filter((r) => r.nodeId === nodeId).sort((a, b) => b.attempt - a.attempt)[0]!;
    const handler = this.handlers.get(node.type);
    if (!handler) {
      await this.failNode(run, nodeRun, node.type, new Error(`No handler is registered for ${node.type}`));
      return false;
    }

    await this.state.transitionRun(run.id, RUNNABLE_FROM, "RUNNING", { startedAt: run.startedAt ?? new Date(), currentStep: nodeId });

    const hasNoInput = input.length === 0 && NODE_CATALOG[node.type].inputKind !== null;
    if (hasNoInput && !handler.runsOnEmptyInput) {
      const skipped = await this.state.transitionNode(nodeRun.id, ["QUEUED"], "SKIPPED", { input, outputs: {}, summary: { skipReason: "No items reached this step" }, finishedAt: new Date() }, { message: "Skipped: no items reached this step" });
      return skipped;
    }

    const claimed = await this.state.transitionNode(nodeRun.id, ["QUEUED"], "RUNNING", { input, startedAt: new Date() }, { message: `Started with ${input.length} item(s)` });
    if (!claimed) return false;

    let result: NodeResult;
    try {
      const ctx = await this.contextFor(run, definition, nodeRun, nodeId, input);
      result = await handler.run(ctx);
    } catch (err) {
      await this.failNode(run, nodeRun, node.type, err);
      return false;
    }

    const cancelled = (await this.prisma.workflowRun.findUnique({ where: { id: run.id }, select: { status: true } }))?.status === "CANCELLED";
    await this.finishNode(run, nodeRun, result);
    return !cancelled && result.kind === "done";
  }

  private async finishNode(run: RunWithGraph, nodeRun: WorkflowNodeRun, result: NodeResult): Promise<void> {
    if (result.kind === "wait") {
      await this.state.transitionNode(nodeRun.id, ["RUNNING"], "WAITING", { summary: result.summary }, { message: "Waiting for a person to review" });
      await this.state.transitionRun(run.id, ["PENDING", "RUNNING"], "AWAITING_REVIEW", { currentStep: null });
      return;
    }

    const summary: Record<string, unknown> = { ...result.summary };
    if (result.llmUnits !== undefined) summary.llmUnits = result.llmUnits;
    if (result.skipReason) summary.skipReason = result.skipReason;
    const counts = Object.entries(result.outputs).map(([handle, ids]) => `${handle}: ${ids.length}`).join(", ");
    await this.state.transitionNode(
      nodeRun.id,
      ["RUNNING"],
      result.skipped ? "SKIPPED" : "SUCCEEDED",
      { outputs: result.outputs, summary, finishedAt: new Date() },
      { message: result.skipped ? `Skipped: ${result.skipReason ?? "nothing to do"}` : `Finished${counts ? ` (${counts})` : ""}` },
    );
  }

  private async failNode(run: RunWithGraph, nodeRun: WorkflowNodeRun, type: WorkflowNodeType, err: unknown): Promise<void> {
    const message = messageOf(err);
    this.logger.warn(`Workflow run ${run.id} node ${nodeRun.nodeId} (${type}) failed: ${message}`);
    await this.state.transitionNode(nodeRun.id, ["QUEUED", "RUNNING"], "FAILED", { error: message, finishedAt: new Date() }, { level: "error", message: `Failed: ${message}` });
    await this.state.transitionRun(run.id, ACTIVE_RUN_STATUSES, "FAILED", {
      finishedAt: new Date(),
      currentStep: null,
      error: `${NODE_CATALOG[type].label}: ${message}`,
    });
  }

  private async contextFor(run: RunWithGraph, definition: WorkflowDefinition, nodeRun: WorkflowNodeRun, nodeId: string, input: string[]): Promise<NodeContext> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: run.projectId }, select: { workspaceId: true } });
    const fresh = await this.prisma.workflowNodeRun.findMany({ where: { workflowRunId: run.id }, select: { summary: true } });
    const used = fresh.reduce((sum, r) => sum + (typeof (r.summary as { llmUnits?: unknown })?.llmUnits === "number" ? (r.summary as { llmUnits: number }).llmUnits : 0), 0);
    const options = (run.options ?? {}) as { maxLlmProspects?: number };

    return {
      run,
      workspaceId: project.workspaceId,
      nodeRunId: nodeRun.id,
      attempt: nodeRun.attempt,
      node: definition.nodes.find((n) => n.id === nodeId)!,
      definition,
      input,
      budget: { used, max: options.maxLlmProspects ?? env.MAX_LLM_PROSPECTS_PER_RUN },
      log: (level, message) => this.state.appendLog(nodeRun.id, level, message),
    } as NodeContext;
  }
}
