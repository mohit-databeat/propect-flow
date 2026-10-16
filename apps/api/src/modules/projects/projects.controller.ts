import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { CreateProjectDto, UpdateProjectDto, type ProjectSummary } from "@prospect/shared";
import { WorkspaceGuard } from "../../common/guards/workspace.guard";
import { CurrentWorkspace, type WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { ProjectsService } from "./projects.service";

@Controller("projects")
@UseGuards(WorkspaceGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentWorkspace() ws: WorkspaceContext): Promise<ProjectSummary[]> {
    return this.projects.list(ws);
  }

  @Post()
  create(@CurrentWorkspace() ws: WorkspaceContext, @Body(new ZodValidationPipe(CreateProjectDto)) dto: CreateProjectDto): Promise<ProjectSummary> {
    return this.projects.create(ws, dto);
  }

  @Get(":id")
  get(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") id: string): Promise<ProjectSummary> {
    return this.projects.get(ws, id);
  }

  @Patch(":id")
  update(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") id: string, @Body(new ZodValidationPipe(UpdateProjectDto)) dto: UpdateProjectDto): Promise<ProjectSummary> {
    return this.projects.update(ws, id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") id: string): Promise<void> {
    await this.projects.archive(ws, id);
  }

  @Delete(":id/permanent")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") id: string): Promise<void> {
    await this.projects.delete(ws, id);
  }

  @Post(":id/unarchive")
  @HttpCode(HttpStatus.NO_CONTENT)
  async unarchive(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") id: string): Promise<void> {
    await this.projects.unarchive(ws, id);
  }
}
