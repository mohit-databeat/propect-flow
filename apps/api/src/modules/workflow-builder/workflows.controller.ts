import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  CreateWorkflowDto,
  PublishWorkflowDto,
  UpdateWorkflowDto,
  ValidateWorkflowDto,
  type PublishWorkflowResponse,
  type WorkflowDetailDto,
  type WorkflowSummaryDto,
  type WorkflowValidationResponse,
  type WorkflowVersionDto,
} from "@prospect/shared";
import { WorkspaceGuard } from "../../common/guards/workspace.guard";
import { CurrentUser, CurrentWorkspace, type AuthUser, type WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { WorkflowsService } from "./workflows.service";

@Controller("projects/:id/workflows")
@UseGuards(WorkspaceGuard)
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get()
  list(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string): Promise<WorkflowSummaryDto[]> {
    return this.workflows.list(ws, projectId);
  }

  @Post()
  create(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param("id") projectId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateWorkflowDto)) dto: CreateWorkflowDto,
  ): Promise<WorkflowDetailDto> {
    return this.workflows.create(ws, projectId, user.userId, dto);
  }

  @Get(":workflowId")
  get(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("workflowId") workflowId: string): Promise<WorkflowDetailDto> {
    return this.workflows.get(ws, projectId, workflowId);
  }

  @Patch(":workflowId")
  update(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param("id") projectId: string,
    @Param("workflowId") workflowId: string,
    @Body(new ZodValidationPipe(UpdateWorkflowDto)) dto: UpdateWorkflowDto,
  ): Promise<WorkflowDetailDto> {
    return this.workflows.update(ws, projectId, workflowId, dto);
  }

  @Delete(":workflowId")
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("workflowId") workflowId: string): Promise<void> {
    return this.workflows.archive(ws, projectId, workflowId);
  }

  @Post(":workflowId/validate")
  @HttpCode(HttpStatus.OK)
  validate(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param("id") projectId: string,
    @Param("workflowId") workflowId: string,
    @Body(new ZodValidationPipe(ValidateWorkflowDto)) dto: ValidateWorkflowDto,
  ): Promise<WorkflowValidationResponse> {
    return this.workflows.validate(ws, projectId, workflowId, dto);
  }

  @Get(":workflowId/versions")
  listVersions(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("workflowId") workflowId: string): Promise<WorkflowVersionDto[]> {
    return this.workflows.listVersions(ws, projectId, workflowId);
  }

  @Post(":workflowId/versions")
  publish(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param("id") projectId: string,
    @Param("workflowId") workflowId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(PublishWorkflowDto)) dto: PublishWorkflowDto,
  ): Promise<PublishWorkflowResponse> {
    return this.workflows.publish(ws, projectId, workflowId, user.userId, dto);
  }
}
