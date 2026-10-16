import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { StartWorkflowRunDto, type StartWorkflowRunResponse, type WorkflowRunSummary } from "@prospect/shared";
import { WorkspaceGuard } from "../../common/guards/workspace.guard";
import { CurrentUser, CurrentWorkspace, type AuthUser, type WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { WorkflowService } from "./workflow.service";

@Controller("projects/:id/workflow-runs")
@UseGuards(WorkspaceGuard)
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  start(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param("id") projectId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(StartWorkflowRunDto)) dto: StartWorkflowRunDto,
  ): Promise<StartWorkflowRunResponse> {
    return this.workflow.start(ws, projectId, user.userId, dto);
  }

  @Get()
  list(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string): Promise<WorkflowRunSummary[]> {
    return this.workflow.list(ws, projectId);
  }

  @Get(":runId")
  get(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("runId") runId: string): Promise<WorkflowRunSummary> {
    return this.workflow.get(ws, projectId, runId);
  }

  @Post(":runId/cancel")
  cancel(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("runId") runId: string): Promise<WorkflowRunSummary> {
    return this.workflow.cancel(ws, projectId, runId);
  }

  @Post(":runId/retry")
  retry(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("runId") runId: string): Promise<WorkflowRunSummary> {
    return this.workflow.retry(ws, projectId, runId);
  }
}
