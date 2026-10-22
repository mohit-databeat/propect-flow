import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { StartWorkflowExecutionDto, type StartWorkflowExecutionResponse, type WorkflowExecutionDto, type WorkflowExecutionSummaryDto } from "@prospect/shared";
import { WorkspaceGuard } from "../../common/guards/workspace.guard";
import { CurrentUser, CurrentWorkspace, type AuthUser, type WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { ExecutionsService } from "./executions.service";

@Controller("projects/:id")
@UseGuards(WorkspaceGuard)
export class ExecutionsController {
  constructor(private readonly executions: ExecutionsService) {}

  @Post("workflows/:workflowId/executions")
  @HttpCode(HttpStatus.ACCEPTED)
  start(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param("id") projectId: string,
    @Param("workflowId") workflowId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(StartWorkflowExecutionDto)) dto: StartWorkflowExecutionDto,
  ): Promise<StartWorkflowExecutionResponse> {
    return this.executions.start(ws, projectId, workflowId, user.userId, dto);
  }

  @Get("workflows/:workflowId/executions")
  list(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("workflowId") workflowId: string): Promise<WorkflowExecutionSummaryDto[]> {
    return this.executions.listForWorkflow(ws, projectId, workflowId);
  }

  @Get("workflow-executions/:runId")
  get(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("runId") runId: string): Promise<WorkflowExecutionDto> {
    return this.executions.get(ws, projectId, runId);
  }

  @Post("workflow-executions/:runId/cancel")
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("runId") runId: string): Promise<WorkflowExecutionDto> {
    return this.executions.cancel(ws, projectId, runId);
  }

  @Post("workflow-executions/:runId/retry")
  @HttpCode(HttpStatus.OK)
  retry(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("runId") runId: string): Promise<WorkflowExecutionDto> {
    return this.executions.retry(ws, projectId, runId);
  }

  @Post("workflow-executions/:runId/nodes/:nodeId/resume")
  @HttpCode(HttpStatus.OK)
  resume(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param("id") projectId: string,
    @Param("runId") runId: string,
    @Param("nodeId") nodeId: string,
  ): Promise<WorkflowExecutionDto> {
    return this.executions.resume(ws, projectId, runId, nodeId);
  }
}
