import { Injectable } from "@nestjs/common";
import type { Campaign, Prisma } from "@prisma/client";
import {
  ErrorCodes,
  WorkspaceSettings,
  type AddCampaignMessagesDto,
  type CampaignAddReport,
  type CampaignClearReport,
  type CampaignDetailDto,
  type CampaignSendReport,
  type CampaignSummaryDto,
  type CreateCampaignDto,
  type SenderConfig,
  type SkippedMessageDto,
  type UpdateCampaignDto,
} from "@prospect/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { ProviderRegistryService } from "../../providers/provider-registry.service";
import { ProviderCallError } from "../../common/provider-call.error";
import { conflict, notFound } from "../../common/errors";
import type { WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { ProjectsService } from "../projects/projects.service";
import { toMessageDto } from "../messages/messages.service";
import { env } from "../../config/env";
import { checkSendable } from "./sendability";

const DEFAULT_FROM_NAME = "Sales Team";
const DEFAULT_FROM_EMAIL = "outreach@example.com";

interface CampaignMessageSlice {
  reviewStatus: string;
  qaStatus: string;
  sendStatus: string;
  toAddress: string | null;
}

function toSummary(c: Campaign & { messages: CampaignMessageSlice[] }): CampaignSummaryDto {
  const approved = c.messages.filter((m) => m.reviewStatus === "APPROVED").length;
  const sent = c.messages.filter((m) => m.sendStatus === "SENT" || m.sendStatus === "SENT_SIMULATED").length;
  const failed = c.messages.filter((m) => m.sendStatus === "FAILED").length;
  const skipped = c.messages.filter((m) => m.sendStatus === "NOT_SENT" && !checkSendable(m).sendable).length;
  return {
    id: c.id,
    projectId: c.projectId,
    name: c.name,
    status: c.status,
    outboundProviderKey: c.outboundProviderKey,
    senderConfig: (c.senderConfig as SenderConfig | null) ?? {},
    counts: { total: c.messages.length, approved, sent, skipped, failed },
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly registry: ProviderRegistryService,
  ) {}

  async create(ws: WorkspaceContext, projectId: string, dto: CreateCampaignDto): Promise<CampaignSummaryDto> {
    const project = await this.projects.findOneOrThrow(ws, projectId);
    const settings = WorkspaceSettings.parse((await this.prisma.workspace.findUniqueOrThrow({ where: { id: project.workspaceId } })).settings);
    const outboundProviderKey = dto.outboundProviderKey || settings.outboundProviderKey;

    const provider = this.registry.getOutbound(outboundProviderKey);
    this.registry.ctxFor(project.workspaceId, provider, projectId);

    const created = await this.prisma.campaign.create({
      data: { projectId, name: dto.name, outboundProviderKey, senderConfig: (dto.senderConfig ?? {}) as unknown as Prisma.InputJsonValue },
      include: { messages: { select: { reviewStatus: true, sendStatus: true, qaStatus: true, toAddress: true } } },
    });
    return toSummary(created);
  }

  async list(ws: WorkspaceContext, projectId: string): Promise<CampaignSummaryDto[]> {
    await this.projects.findOneOrThrow(ws, projectId);
    const rows = await this.prisma.campaign.findMany({
      where: { projectId },
      include: { messages: { select: { reviewStatus: true, sendStatus: true, qaStatus: true, toAddress: true } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toSummary);
  }

  private async loadOwned(ws: WorkspaceContext, projectId: string, campaignId: string) {
    await this.projects.findOneOrThrow(ws, projectId);
    const campaign = await this.prisma.campaign.findFirst({ where: { id: campaignId, projectId } });
    if (!campaign) throw notFound("Campaign");
    return campaign;
  }

  async get(ws: WorkspaceContext, projectId: string, campaignId: string): Promise<CampaignDetailDto> {
    await this.loadOwned(ws, projectId, campaignId);
    const campaign = await this.prisma.campaign.findFirstOrThrow({
      where: { id: campaignId, projectId },
      include: { messages: { include: { company: true, person: true }, orderBy: { createdAt: "desc" } } },
    });
    return { ...toSummary(campaign), messages: campaign.messages.map((m) => toMessageDto(m)) };
  }

  async update(ws: WorkspaceContext, projectId: string, campaignId: string, dto: UpdateCampaignDto): Promise<CampaignSummaryDto> {
    const campaign = await this.loadOwned(ws, projectId, campaignId);

    if (dto.outboundProviderKey) {
      const provider = this.registry.getOutbound(dto.outboundProviderKey);
      const project = await this.projects.findOneOrThrow(ws, projectId);
      this.registry.ctxFor(project.workspaceId, provider, projectId);
    }

    const updated = await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        name: dto.name ?? undefined,
        status: dto.status ?? undefined,
        outboundProviderKey: dto.outboundProviderKey ?? undefined,
        senderConfig: dto.senderConfig ? ({ ...(campaign.senderConfig as object), ...dto.senderConfig } as unknown as Prisma.InputJsonValue) : undefined,
      },
      include: { messages: { select: { reviewStatus: true, sendStatus: true, qaStatus: true, toAddress: true } } },
    });
    return toSummary(updated);
  }

  private eligibleWhere(projectId: string): Prisma.MessageWhereInput {
    return {
      projectId,
      campaignId: null,
      reviewStatus: "APPROVED",
      qaStatus: { in: ["PASS", "WARN"] },
      sendStatus: "NOT_SENT",
      toAddress: { not: null },
    };
  }

  async addMessages(ws: WorkspaceContext, projectId: string, campaignId: string, dto: AddCampaignMessagesDto): Promise<CampaignAddReport> {
    const campaign = await this.loadOwned(ws, projectId, campaignId);

    if (!dto.messageIds || dto.messageIds.length === 0) {
      const eligible = await this.prisma.message.findMany({ where: this.eligibleWhere(projectId), select: { id: true } });
      if (eligible.length === 0) return { added: 0, alreadyInCampaign: 0, skipped: 0, skippedMessages: [] };
      await this.prisma.message.updateMany({ where: { id: { in: eligible.map((m) => m.id) } }, data: { campaignId: campaign.id } });
      return { added: eligible.length, alreadyInCampaign: 0, skipped: 0, skippedMessages: [] };
    }

    const rows = await this.prisma.message.findMany({ where: { id: { in: dto.messageIds }, projectId }, include: { company: true } });
    const found = new Map(rows.map((m) => [m.id, m]));

    let added = 0;
    let alreadyInCampaign = 0;
    const skippedMessages: SkippedMessageDto[] = [];
    const toAttach: string[] = [];

    for (const id of dto.messageIds) {
      const m = found.get(id);
      if (!m) {
        skippedMessages.push({ messageId: id, companyName: "—", reason: "Message not found in this project" });
        continue;
      }
      if (m.campaignId) {
        alreadyInCampaign++;
        continue;
      }
      const check = checkSendable({ reviewStatus: m.reviewStatus, qaStatus: m.qaStatus, sendStatus: m.sendStatus, toAddress: m.toAddress });
      if (!check.sendable) {
        skippedMessages.push({ messageId: id, companyName: m.company.name, reason: check.reason });
        continue;
      }
      toAttach.push(id);
    }

    if (toAttach.length > 0) {
      await this.prisma.message.updateMany({ where: { id: { in: toAttach } }, data: { campaignId: campaign.id } });
      added = toAttach.length;
    }

    return { added, alreadyInCampaign, skipped: skippedMessages.length, skippedMessages };
  }

  async removeMessage(ws: WorkspaceContext, projectId: string, campaignId: string, messageId: string): Promise<CampaignDetailDto> {
    await this.loadOwned(ws, projectId, campaignId);
    const message = await this.prisma.message.findFirst({ where: { id: messageId, projectId, campaignId } });
    if (!message) throw notFound("Message in this campaign");
    if (message.sendStatus === "SENT" || message.sendStatus === "SENT_SIMULATED") {
      throw conflict(ErrorCodes.MESSAGE_ALREADY_SENT, "This email was already sent as part of this campaign and can't be removed — it's part the campaign's send history.");
    }

    await this.prisma.message.update({ where: { id: messageId }, data: { campaignId: null } });
    return this.get(ws, projectId, campaignId);
  }

  async clearMessages(ws: WorkspaceContext, projectId: string, campaignId: string): Promise<CampaignClearReport> {
    const campaign = await this.loadOwned(ws, projectId, campaignId);
    const messages = await this.prisma.message.findMany({ where: { campaignId: campaign.id }, select: { id: true, sendStatus: true } });

    const removable = messages.filter((m) => m.sendStatus !== "SENT" && m.sendStatus !== "SENT_SIMULATED");
    if (removable.length > 0) {
      await this.prisma.message.updateMany({ where: { id: { in: removable.map((m) => m.id) } }, data: { campaignId: null } });
    }

    return { removed: removable.length, kept: messages.length - removable.length };
  }

  async send(ws: WorkspaceContext, projectId: string, campaignId: string): Promise<CampaignSendReport> {
    const campaign = await this.loadOwned(ws, projectId, campaignId);
    const project = await this.projects.findOneOrThrow(ws, projectId);

    const provider = this.registry.getOutbound(campaign.outboundProviderKey);
    const ctx = this.registry.ctxFor(project.workspaceId, provider, projectId);

    const messages = await this.prisma.message.findMany({ where: { campaignId: campaign.id }, include: { company: true } });
    const sender = campaign.senderConfig as SenderConfig | null;
    const fromName = sender?.fromName || env.SMTP_FROM_NAME || DEFAULT_FROM_NAME;
    const fromEmail = sender?.fromEmail || env.SMTP_FROM_EMAIL || DEFAULT_FROM_EMAIL;
    const from = `${fromName} <${fromEmail}>`;

    let sent = 0;
    let failed = 0;
    const skippedMessages: SkippedMessageDto[] = [];

    for (const m of messages) {
      const check = checkSendable({ reviewStatus: m.reviewStatus, qaStatus: m.qaStatus, sendStatus: m.sendStatus, toAddress: m.toAddress });
      if (!check.sendable) {
        skippedMessages.push({ messageId: m.id, companyName: m.company.name, reason: check.reason });
        continue;
      }
      try {
        const result = await provider.send(ctx, { messageId: m.id, from, to: m.toAddress!, subject: m.subject, body: m.body });
        await this.prisma.message.update({
          where: { id: m.id },
          data: { sendStatus: result.status, sentAt: new Date(), providerMessageId: result.providerMessageId, sendError: null },
        });
        sent++;
      } catch (err) {
        const message = err instanceof ProviderCallError ? err.message : err instanceof Error ? err.message : "Unknown send error";
        await this.prisma.message.update({ where: { id: m.id }, data: { sendStatus: "FAILED", sendError: message } });
        failed++;
      }
    }

    if (campaign.status === "DRAFT" && sent > 0) {
      await this.prisma.campaign.update({ where: { id: campaign.id }, data: { status: "ACTIVE" } });
    }

    return { total: messages.length, sent, skipped: skippedMessages.length, failed, skippedMessages };
  }

  async sendReport(ws: WorkspaceContext, projectId: string, campaignId: string): Promise<CampaignSendReport> {
    await this.loadOwned(ws, projectId, campaignId);
    const messages = await this.prisma.message.findMany({ where: { campaignId }, include: { company: true } });

    let sent = 0;
    let failed = 0;
    const skippedMessages: SkippedMessageDto[] = [];

    for (const m of messages) {
      if (m.sendStatus === "SENT" || m.sendStatus === "SENT_SIMULATED") {
        sent++;
        continue;
      }
      if (m.sendStatus === "FAILED") {
        failed++;
        skippedMessages.push({ messageId: m.id, companyName: m.company.name, reason: m.sendError ?? "Send failed" });
        continue;
      }
      const check = checkSendable({ reviewStatus: m.reviewStatus, qaStatus: m.qaStatus, sendStatus: m.sendStatus, toAddress: m.toAddress });
      skippedMessages.push({ messageId: m.id, companyName: m.company.name, reason: check.sendable ? "Not yet sent" : check.reason });
    }

    return { total: messages.length, sent, skipped: skippedMessages.length, failed, skippedMessages };
  }
}
