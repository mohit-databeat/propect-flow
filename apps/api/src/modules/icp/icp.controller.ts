import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from "@nestjs/common";
import { ChatMessageDto, IcpDraftEditable, ResolveClarificationDto, type IcpChatResponse, type IcpProfileVersionSummary, type IcpStateResponse } from "@prospect/shared";
import { WorkspaceGuard } from "../../common/guards/workspace.guard";
import { CurrentUser, CurrentWorkspace, type AuthUser, type WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { IcpService } from "./icp.service";

@Controller("projects/:id/icp")
@UseGuards(WorkspaceGuard)
export class IcpController {
  constructor(private readonly icp: IcpService) {}

  @Get()
  getState(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string): Promise<IcpStateResponse> {
    return this.icp.getState(ws, projectId);
  }

  @Get("versions")
  versions(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string): Promise<IcpProfileVersionSummary[]> {
    return this.icp.versions(ws, projectId);
  }

  @Post("chat")
  chat(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param("id") projectId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ChatMessageDto)) dto: ChatMessageDto,
  ): Promise<IcpChatResponse> {
    return this.icp.chat(ws, projectId, user.userId, dto.message);
  }

  @Put("draft")
  updateDraft(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param("id") projectId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(IcpDraftEditable)) dto: IcpDraftEditable,
  ): Promise<IcpStateResponse> {
    return this.icp.updateDraft(ws, projectId, user.userId, dto);
  }

  @Post("clarifications/:clarId/resolve")
  resolveClarification(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param("id") projectId: string,
    @Param("clarId") clarId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ResolveClarificationDto)) dto: ResolveClarificationDto,
  ): Promise<IcpStateResponse> {
    return this.icp.resolveClarification(ws, projectId, user.userId, clarId, dto.answer);
  }

  @Post("activate")
  @HttpCode(HttpStatus.OK)
  activate(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string): Promise<IcpStateResponse> {
    return this.icp.activate(ws, projectId);
  }
}
