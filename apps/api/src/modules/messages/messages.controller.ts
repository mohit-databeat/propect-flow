import { Body, Controller, Get, Param, Post, Patch, Query, UseGuards } from "@nestjs/common";
import { EditMessageDto, GenerateMessageDto, MessageListQuery, RejectMessageDto, type MessageDto, type MessageListResponse } from "@prospect/shared";
import { WorkspaceGuard } from "../../common/guards/workspace.guard";
import { CurrentUser, CurrentWorkspace, type AuthUser, type WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { MessagesService } from "./messages.service";

@Controller("projects/:id/messages")
@UseGuards(WorkspaceGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  list(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Query(new ZodValidationPipe(MessageListQuery)) query: MessageListQuery): Promise<MessageListResponse> {
    return this.messages.list(ws, projectId, query);
  }

  @Post(":messageId/qa")
  runQa(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("messageId") messageId: string): Promise<MessageDto> {
    return this.messages.runQa(ws, projectId, messageId);
  }

  @Post(":messageId/regenerate")
  regenerate(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param("id") projectId: string,
    @Param("messageId") messageId: string,
    @Body(new ZodValidationPipe(GenerateMessageDto)) dto: GenerateMessageDto,
  ): Promise<MessageDto> {
    return this.messages.regenerate(ws, projectId, messageId, dto.personId);
  }

  @Patch(":messageId")
  edit(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param("id") projectId: string,
    @Param("messageId") messageId: string,
    @Body(new ZodValidationPipe(EditMessageDto)) dto: EditMessageDto,
  ): Promise<MessageDto> {
    return this.messages.edit(ws, projectId, messageId, dto);
  }

  @Post(":messageId/approve")
  approve(@CurrentWorkspace() ws: WorkspaceContext, @CurrentUser() user: AuthUser, @Param("id") projectId: string, @Param("messageId") messageId: string): Promise<MessageDto> {
    return this.messages.approve(ws, projectId, messageId, user.userId);
  }

  @Post(":messageId/reject")
  reject(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthUser,
    @Param("id") projectId: string,
    @Param("messageId") messageId: string,
    @Body(new ZodValidationPipe(RejectMessageDto)) dto: RejectMessageDto,
  ): Promise<MessageDto> {
    return this.messages.reject(ws, projectId, messageId, user.userId, dto.note);
  }
}

@Controller("projects/:id/prospects/:prospectId/messages")
@UseGuards(WorkspaceGuard)
export class ProspectMessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  list(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("prospectId") prospectId: string): Promise<MessageDto[]> {
    return this.messages.listForProspect(ws, projectId, prospectId);
  }

  @Post("generate")
  generate(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param("id") projectId: string,
    @Param("prospectId") prospectId: string,
    @Body(new ZodValidationPipe(GenerateMessageDto)) dto: GenerateMessageDto,
  ): Promise<MessageDto> {
    return this.messages.generate(ws, projectId, prospectId, dto.personId);
  }
}
