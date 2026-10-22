import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Message } from "@prisma/client";
import {
  ErrorCodes,
  IcpDefinition,
  type EditMessageDto,
  type EmailCompanyContext,
  type EmailGenerationRequest,
  type EmailHighlight,
  type EmailQaRequest,
  type EmailRecipientContext,
  type MessageDto,
  type MessageListQuery,
  type MessageListResponse,
} from "@prospect/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { badRequest, conflict, notFound } from "../../common/errors";
import type { WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { ProjectsService } from "../projects/projects.service";
import { AiService } from "../ai/ai.service";
import { selectRecipient, type RecipientCandidate } from "./recipient-selector";

interface GenerationContext {
  companyContext: EmailCompanyContext;
  recipientContext: EmailRecipientContext;
  highlights: EmailHighlight[];
  icpSummary: string;
}

type MessageWithRelations = Message & { company: { name: string }; person: { fullName: string; title: string | null } | null };

export function toMessageDto(m: MessageWithRelations): MessageDto {
  return {
    id: m.id,
    projectId: m.projectId,
    campaignId: m.campaignId,
    prospectId: m.prospectId,
    companyId: m.companyId,
    companyName: m.company.name,
    personId: m.personId,
    recipientName: m.person?.fullName ?? null,
    recipientTitle: m.person?.title ?? null,
    toAddress: m.toAddress,
    subject: m.subject,
    body: m.body,
    generatedSubject: m.generatedSubject,
    generatedBody: m.generatedBody,
    personalizationPoints: (m.qaResult as { personalizationPoints?: string[] } | null)?.personalizationPoints ?? [],
    qaStatus: m.qaStatus,
    qaResult: (m.qaResult as { verdict: "PASS" | "WARN" | "FAIL"; issues: { severity: "WARN" | "FAIL"; note: string }[]; reason: string } | null) ?? null,
    reviewStatus: m.reviewStatus,
    reviewedById: m.reviewedById,
    reviewedAt: m.reviewedAt?.toISOString() ?? null,
    reviewNote: m.reviewNote,
    sendStatus: m.sendStatus,
    sentAt: m.sentAt?.toISOString() ?? null,
    providerMessageId: m.providerMessageId,
    sendError: m.sendError,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly ai: AiService,
  ) {}

  private async loadProspectForGeneration(prospectId: string, projectId: string) {
    const prospect = await this.prisma.prospect.findFirst({
      where: { id: prospectId, projectId },
      include: { company: { include: { people: true } }, icpProfile: true, project: true, results: { where: { status: "PASS" } } },
    });
    if (!prospect) throw notFound("Prospect");
    return prospect;
  }

  private buildGenerationContext(prospect: Awaited<ReturnType<MessagesService["loadProspectForGeneration"]>>, recipient: RecipientCandidate): GenerationContext {
    const icp = IcpDefinition.parse(prospect.icpProfile.definition);
    const byCriterion = new Map<string, EmailHighlight>();
    for (const r of prospect.results) {

      if (r.phase === "INITIAL" && byCriterion.has(r.criterionId)) continue;
      byCriterion.set(r.criterionId, { criterionLabel: r.criterionLabel, reason: r.reason });
    }
    const highlights = [...prospect.results]
      .sort((a, b) => b.weight - a.weight)
      .filter((r, i, arr) => arr.findIndex((x) => x.criterionId === r.criterionId) === i)
      .slice(0, 5)
      .map((r) => byCriterion.get(r.criterionId)!);

    return {
      companyContext: {
        name: prospect.company.name,
        domain: prospect.company.domain,
        industry: prospect.company.industry,
        country: prospect.company.country,
        employeeCount: prospect.company.employeeCount,
        description: prospect.company.description,
      },
      recipientContext: { fullName: recipient.fullName, title: recipient.title, seniority: recipient.seniority },
      highlights,
      icpSummary: icp.summary || icp.name,
    };
  }

  private resolveRecipient(prospect: Awaited<ReturnType<MessagesService["loadProspectForGeneration"]>>, personId?: string): RecipientCandidate {
    const candidates: RecipientCandidate[] = prospect.company.people.map((p) => ({ id: p.id, fullName: p.fullName, title: p.title, seniority: p.seniority, email: p.email }));
    if (personId) {
      const explicit = candidates.find((c) => c.id === personId);
      if (!explicit) throw notFound("Person");
      if (!explicit.email) throw badRequest(ErrorCodes.NO_ELIGIBLE_RECIPIENT, "This contact has no email address on file");
      return explicit;
    }
    const icp = IcpDefinition.parse(prospect.icpProfile.definition);
    const picked = selectRecipient(candidates, icp.targetPersonas);
    if (!picked) throw badRequest(ErrorCodes.NO_ELIGIBLE_RECIPIENT, "No contact with an email address was found for this company — add one before generating an email");
    return picked;
  }

  async generateDraft(ws: WorkspaceContext, projectId: string, prospectId: string, personId?: string): Promise<Message> {
    const project = await this.projects.findOneOrThrow(ws, projectId);
    const prospect = await this.loadProspectForGeneration(prospectId, projectId);
    if (prospect.status !== "QUALIFIED") {
      throw badRequest(ErrorCodes.PROSPECT_NOT_QUALIFIED, "Only QUALIFIED prospects are eligible for outreach email generation");
    }

    const recipient = this.resolveRecipient(prospect, personId);
    const ctx = this.buildGenerationContext(prospect, recipient);

    const request: EmailGenerationRequest = {
      company: ctx.companyContext,
      recipient: ctx.recipientContext,
      icpSummary: ctx.icpSummary,
      highlights: ctx.highlights,
      senderContext: project.description ?? null,
    };
    const { data, aiRunId } = await this.ai.generateEmail({ workspaceId: project.workspaceId, projectId }, request, prospectId);

    const existing = await this.prisma.message.findFirst({
      where: { companyId: prospect.companyId, projectId, sendStatus: { notIn: ["QUEUED", "SENT_SIMULATED", "SENT"] } },
    });
    const messageData = {
      projectId,
      prospectId,
      companyId: prospect.companyId,
      personId: recipient.id,
      toAddress: recipient.email,
      subject: data.subject,
      body: data.body,
      generatedSubject: data.subject,
      generatedBody: data.body,
      generationAiRunId: aiRunId,
      qaAiRunId: null,
      qaStatus: "PENDING" as const,
      qaResult: { personalizationPoints: data.personalizationPoints } as unknown as Prisma.InputJsonValue,
      reviewStatus: "PENDING" as const,
      reviewedById: null,
      reviewedAt: null,
      reviewNote: null,
      sendStatus: "NOT_SENT" as const,
    };

    if (existing) {
      return this.prisma.message.update({ where: { id: existing.id }, data: messageData });
    }
    return this.prisma.message.create({ data: messageData });
  }

  async runQa(ws: WorkspaceContext, projectId: string, messageId: string): Promise<MessageDto> {
    const project = await this.projects.findOneOrThrow(ws, projectId);
    const message = await this.prisma.message.findFirst({ where: { id: messageId, projectId }, include: { company: true, person: true } });
    if (!message) throw notFound("Message");
    if (!message.prospectId) throw badRequest(ErrorCodes.VALIDATION_ERROR, "This message has no linked prospect to QA against");

    const prospect = await this.loadProspectForGeneration(message.prospectId, projectId);
    const recipient: RecipientCandidate = message.personId
      ? (prospect.company.people.find((p) => p.id === message.personId) ?? { id: "", fullName: "Unknown", title: null, seniority: null, email: null })
      : { id: "", fullName: "Unknown", title: null, seniority: null, email: null };
    const ctx = this.buildGenerationContext(prospect, recipient);

    const request: EmailQaRequest = { subject: message.subject, body: message.body, company: ctx.companyContext, recipient: ctx.recipientContext, highlights: ctx.highlights };
    const { data, aiRunId } = await this.ai.qaEmail({ workspaceId: project.workspaceId, projectId }, request, messageId);

    const priorPersonalization = (message.qaResult as { personalizationPoints?: string[] } | null)?.personalizationPoints ?? [];
    const updated = await this.prisma.message.update({
      where: { id: message.id },
      data: {
        qaStatus: data.verdict,
        qaAiRunId: aiRunId,
        qaResult: { ...data, personalizationPoints: priorPersonalization } as unknown as Prisma.InputJsonValue,
      },
      include: { company: true, person: true },
    });
    return toMessageDto(updated);
  }

  async generate(ws: WorkspaceContext, projectId: string, prospectId: string, personId?: string): Promise<MessageDto> {
    const draft = await this.generateDraft(ws, projectId, prospectId, personId);
    return this.runQa(ws, projectId, draft.id);
  }

  async regenerate(ws: WorkspaceContext, projectId: string, messageId: string, personId?: string): Promise<MessageDto> {
    const existing = await this.prisma.message.findFirst({ where: { id: messageId, projectId } });
    if (!existing) throw notFound("Message");
    if (!existing.prospectId) throw badRequest(ErrorCodes.VALIDATION_ERROR, "This message has no linked prospect to regenerate from");
    return this.generate(ws, projectId, existing.prospectId, personId);
  }

  async edit(ws: WorkspaceContext, projectId: string, messageId: string, dto: EditMessageDto): Promise<MessageDto> {
    await this.projects.findOneOrThrow(ws, projectId);
    const existing = await this.prisma.message.findFirst({ where: { id: messageId, projectId } });
    if (!existing) throw notFound("Message");

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { subject: dto.subject, body: dto.body, reviewStatus: "EDITED", qaStatus: "PENDING", qaResult: Prisma.JsonNull },
      include: { company: true, person: true },
    });
    return toMessageDto(updated);
  }

  async approve(ws: WorkspaceContext, projectId: string, messageId: string, userId: string): Promise<MessageDto> {
    await this.projects.findOneOrThrow(ws, projectId);
    const existing = await this.prisma.message.findFirst({ where: { id: messageId, projectId } });
    if (!existing) throw notFound("Message");
    if (existing.qaStatus !== "PASS" && existing.qaStatus !== "WARN") {
      throw conflict(ErrorCodes.QA_NOT_PASSED, "This email cannot be approved until QA reports PASS or WARN — edit and re-run QA, or approve only once it passes.");
    }

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { reviewStatus: "APPROVED", reviewedById: userId, reviewedAt: new Date(), reviewNote: null },
      include: { company: true, person: true },
    });
    return toMessageDto(updated);
  }

  async reject(ws: WorkspaceContext, projectId: string, messageId: string, userId: string, note?: string): Promise<MessageDto> {
    await this.projects.findOneOrThrow(ws, projectId);
    const existing = await this.prisma.message.findFirst({ where: { id: messageId, projectId } });
    if (!existing) throw notFound("Message");

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { reviewStatus: "REJECTED", reviewedById: userId, reviewedAt: new Date(), reviewNote: note ?? null },
      include: { company: true, person: true },
    });
    return toMessageDto(updated);
  }

  async listForProspect(ws: WorkspaceContext, projectId: string, prospectId: string): Promise<MessageDto[]> {
    await this.projects.findOneOrThrow(ws, projectId);
    const rows = await this.prisma.message.findMany({ where: { projectId, prospectId }, include: { company: true, person: true }, orderBy: { createdAt: "desc" } });
    return rows.map(toMessageDto);
  }

  async list(ws: WorkspaceContext, projectId: string, query: MessageListQuery): Promise<MessageListResponse> {
    await this.projects.findOneOrThrow(ws, projectId);
    const where: Prisma.MessageWhereInput = { projectId };
    if (query.reviewStatus) where.reviewStatus = query.reviewStatus;
    if (query.qaStatus) where.qaStatus = query.qaStatus;

    const [rows, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        include: { company: true, person: true },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.message.count({ where }),
    ]);
    return { items: rows.map(toMessageDto), page: query.page, pageSize: query.pageSize, total };
  }
}
