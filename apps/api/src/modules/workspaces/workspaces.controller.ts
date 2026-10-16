import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { UpdateWorkspaceDto, type WorkspaceMemberResponse, type WorkspaceResponse } from "@prospect/shared";
import { WorkspaceGuard } from "../../common/guards/workspace.guard";
import { CurrentWorkspace, type WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { WorkspacesService } from "./workspaces.service";

@Controller("workspaces")
@UseGuards(WorkspaceGuard)
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get("current")
  getCurrent(@CurrentWorkspace() ws: WorkspaceContext): Promise<WorkspaceResponse> {
    return this.workspaces.getCurrent(ws);
  }

  @Patch("current")
  update(@CurrentWorkspace() ws: WorkspaceContext, @Body(new ZodValidationPipe(UpdateWorkspaceDto)) dto: UpdateWorkspaceDto): Promise<WorkspaceResponse> {
    return this.workspaces.update(ws, dto);
  }

  @Get("current/members")
  members(@CurrentWorkspace() ws: WorkspaceContext): Promise<WorkspaceMemberResponse[]> {
    return this.workspaces.members(ws);
  }
}
