import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import {
  AddCampaignMessagesDto,
  CreateCampaignDto,
  UpdateCampaignDto,
  type CampaignAddReport,
  type CampaignClearReport,
  type CampaignDetailDto,
  type CampaignSendReport,
  type CampaignSummaryDto,
} from "@prospect/shared";
import { WorkspaceGuard } from "../../common/guards/workspace.guard";
import { CurrentWorkspace, type WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CampaignsService } from "./campaigns.service";

@Controller("projects/:id/campaigns")
@UseGuards(WorkspaceGuard)
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Post()
  create(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Body(new ZodValidationPipe(CreateCampaignDto)) dto: CreateCampaignDto): Promise<CampaignSummaryDto> {
    return this.campaigns.create(ws, projectId, dto);
  }

  @Get()
  list(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string): Promise<CampaignSummaryDto[]> {
    return this.campaigns.list(ws, projectId);
  }

  @Get(":campaignId")
  get(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("campaignId") campaignId: string): Promise<CampaignDetailDto> {
    return this.campaigns.get(ws, projectId, campaignId);
  }

  @Patch(":campaignId")
  update(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param("id") projectId: string,
    @Param("campaignId") campaignId: string,
    @Body(new ZodValidationPipe(UpdateCampaignDto)) dto: UpdateCampaignDto,
  ): Promise<CampaignSummaryDto> {
    return this.campaigns.update(ws, projectId, campaignId, dto);
  }

  @Post(":campaignId/messages")
  addMessages(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param("id") projectId: string,
    @Param("campaignId") campaignId: string,
    @Body(new ZodValidationPipe(AddCampaignMessagesDto)) dto: AddCampaignMessagesDto,
  ): Promise<CampaignAddReport> {
    return this.campaigns.addMessages(ws, projectId, campaignId, dto);
  }

  @Delete(":campaignId/messages/:messageId")
  removeMessage(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param("id") projectId: string,
    @Param("campaignId") campaignId: string,
    @Param("messageId") messageId: string,
  ): Promise<CampaignDetailDto> {
    return this.campaigns.removeMessage(ws, projectId, campaignId, messageId);
  }

  @Delete(":campaignId/messages")
  clearMessages(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("campaignId") campaignId: string): Promise<CampaignClearReport> {
    return this.campaigns.clearMessages(ws, projectId, campaignId);
  }

  @Post(":campaignId/send")
  send(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("campaignId") campaignId: string): Promise<CampaignSendReport> {
    return this.campaigns.send(ws, projectId, campaignId);
  }

  @Get(":campaignId/send-report")
  sendReport(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("campaignId") campaignId: string): Promise<CampaignSendReport> {
    return this.campaigns.sendReport(ws, projectId, campaignId);
  }
}
