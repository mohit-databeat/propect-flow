import { Injectable } from "@nestjs/common";
import type { IcpProfile, Prisma } from "@prisma/client";
import {
  ChatMessage,
  Clarification,
  IcpDefinition,
  IcpDraftDefinition,
  IcpDraftEditable,
  checkActivatable,
  defaultedAssumptions,
  ErrorCodes,
  openBlockingClarifications,
  reconcileClarifications,
  unresolvedClarifications,
  type IcpChatResponse,
  type IcpProfileVersionSummary,
  type IcpStateResponse,
} from "@prospect/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { conflict, notFound } from "../../common/errors";
import type { WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { ProjectsService } from "../projects/projects.service";
import { AiService } from "../ai/ai.service";

@Injectable()
export class IcpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly ai: AiService,
  ) {}

  async getState(ws: WorkspaceContext, projectId: string): Promise<IcpStateResponse> {
    await this.projects.findOneOrThrow(ws, projectId);
    const [active, draft] = await Promise.all([
      this.prisma.icpProfile.findFirst({ where: { projectId, status: "ACTIVE" } }),
      this.prisma.icpProfile.findFirst({ where: { projectId, status: "DRAFT" }, orderBy: { version: "desc" } }),
    ]);
    return this.toState(projectId, active, draft);
  }

  async versions(ws: WorkspaceContext, projectId: string): Promise<IcpProfileVersionSummary[]> {
    await this.projects.findOneOrThrow(ws, projectId);
    const rows = await this.prisma.icpProfile.findMany({ where: { projectId }, orderBy: { version: "desc" } });
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      status: r.status,
      name: (r.definition as { name?: string }).name ?? "Untitled ICP",
      createdAt: r.createdAt.toISOString(),
      activatedAt: r.activatedAt?.toISOString() ?? null,
    }));
  }

  async chat(ws: WorkspaceContext, projectId: string, userId: string, message: string): Promise<IcpChatResponse> {
    const profile = await this.getOrCreateDraftProfile(ws, projectId, userId);
    const currentDraft = IcpDraftDefinition.parse(profile.definition);
    const transcript = [...(profile.chatTranscript as unknown as ChatMessage[]), userTurn(message)];

    const { data } = await this.ai.extractIcp({ workspaceId: ws.id, projectId }, transcript, currentDraft);

    const reconciled = reconcileClarifications(currentDraft.clarifications, data.clarifications);
    const newDraft = IcpDraftDefinition.parse({ ...data.draft, clarifications: reconciled });
    transcript.push(assistantTurn(data.assistantMessage));

    const updated = await this.persistDraft(profile.id, newDraft, transcript);
    const state = await this.toState(projectId, await this.findActive(projectId), updated);
    return { ...state, assistantMessage: data.assistantMessage, unsupported: data.unsupported };
  }

  async updateDraft(ws: WorkspaceContext, projectId: string, userId: string, dto: IcpDraftEditable): Promise<IcpStateResponse> {
    const profile = await this.getOrCreateDraftProfile(ws, projectId, userId);
    const current = IcpDraftDefinition.parse(profile.definition);

    const updated = IcpDraftDefinition.parse({ ...dto, clarifications: current.clarifications });
    const saved = await this.persistDraft(profile.id, updated, profile.chatTranscript as unknown as ChatMessage[]);
    return this.toState(projectId, await this.findActive(projectId), saved);
  }

  async resolveClarification(ws: WorkspaceContext, projectId: string, userId: string, clarId: string, answer: string): Promise<IcpStateResponse> {
    const profile = await this.getOrCreateDraftProfile(ws, projectId, userId);
    const current = IcpDraftDefinition.parse(profile.definition);
    const target = current.clarifications.find((c) => c.id === clarId);
    if (!target) throw notFound("Clarification", { clarificationId: clarId }, ErrorCodes.CLARIFICATION_NOT_FOUND);

    const resolved: Clarification = { ...target, answer: answer.trim(), resolvedBy: "USER" };
    const withResolution = IcpDraftDefinition.parse({
      ...current,
      clarifications: current.clarifications.map((c) => (c.id === clarId ? resolved : c)),
    });

    let profileRow = await this.persistDraft(profile.id, withResolution, profile.chatTranscript as unknown as ChatMessage[]);

    const transcript = [...(profileRow.chatTranscript as unknown as ChatMessage[]), userTurn(`Regarding "${target.question}": ${answer.trim()}`)];
    const { data } = await this.ai.extractIcp({ workspaceId: ws.id, projectId }, transcript, withResolution);

    const reconciled = reconcileClarifications(withResolution.clarifications, data.clarifications);
    const newDraft = IcpDraftDefinition.parse({ ...data.draft, clarifications: reconciled });
    transcript.push(assistantTurn(data.assistantMessage));

    profileRow = await this.persistDraft(profileRow.id, newDraft, transcript);
    return this.toState(projectId, await this.findActive(projectId), profileRow);
  }

  async activate(ws: WorkspaceContext, projectId: string): Promise<IcpStateResponse> {
    await this.projects.findOneOrThrow(ws, projectId);
    const draftRow = await this.prisma.icpProfile.findFirst({ where: { projectId, status: "DRAFT" }, orderBy: { version: "desc" } });
    if (!draftRow) {
      throw conflict(ErrorCodes.ICP_NOT_ACTIVATABLE, "No ICP draft exists yet for this project — start a conversation first", { issues: [], openBlocking: [] });
    }

    const result = IcpDraftDefinition.parse(draftRow.definition);
    const check = checkActivatable(result);
    if (!check.activatable) {
      const openBlocking = openBlockingClarifications(result).map((c) => c.id);
      throw conflict(ErrorCodes.ICP_NOT_ACTIVATABLE, "This ICP draft does not satisfy the requirements for activation", {
        issues: check.blockers,
        openBlocking,
      });
    }
    const strict: IcpDefinition = IcpDefinition.parse(result);

    await this.prisma.$transaction([
      this.prisma.icpProfile.updateMany({ where: { projectId, status: "ACTIVE" }, data: { status: "ARCHIVED" } }),
      this.prisma.icpProfile.update({
        where: { id: draftRow.id },
        data: { status: "ACTIVE", activatedAt: new Date(), blockingOpenCount: 0, definition: strict as unknown as Prisma.InputJsonValue },
      }),
    ]);

    const [active, draft] = await Promise.all([
      this.findActive(projectId),
      this.prisma.icpProfile.findFirst({ where: { projectId, status: "DRAFT" }, orderBy: { version: "desc" } }),
    ]);
    return this.toState(projectId, active, draft);
  }

  private findActive(projectId: string) {
    return this.prisma.icpProfile.findFirst({ where: { projectId, status: "ACTIVE" } });
  }

  private async getOrCreateDraftProfile(ws: WorkspaceContext, projectId: string, userId: string): Promise<IcpProfile> {
    await this.projects.findOneOrThrow(ws, projectId);
    const existing = await this.prisma.icpProfile.findFirst({ where: { projectId, status: "DRAFT" }, orderBy: { version: "desc" } });
    if (existing) return existing;

    const latest = await this.prisma.icpProfile.findFirst({ where: { projectId }, orderBy: { version: "desc" } });
    const empty = IcpDraftDefinition.parse({ schemaVersion: 1 });
    return this.prisma.icpProfile.create({
      data: {
        projectId,
        version: (latest?.version ?? 0) + 1,
        status: "DRAFT",
        naturalLanguage: "",
        definition: empty as unknown as Prisma.InputJsonValue,
        chatTranscript: [] as unknown as Prisma.InputJsonValue,
        blockingOpenCount: 0,
        createdById: userId,
      },
    });
  }

  private async persistDraft(profileId: string, draft: IcpDraftDefinition, transcript: ChatMessage[]): Promise<IcpProfile> {
    const naturalLanguage = transcript
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n");
    return this.prisma.icpProfile.update({
      where: { id: profileId },
      data: {
        definition: draft as unknown as Prisma.InputJsonValue,
        chatTranscript: transcript as unknown as Prisma.InputJsonValue,
        blockingOpenCount: openBlockingClarifications(draft).length,
        naturalLanguage,
      },
    });
  }

  private toState(projectId: string, active: IcpProfile | null, draft: IcpProfile | null): IcpStateResponse {
    const draftDefinition = draft ? IcpDraftDefinition.parse(draft.definition) : null;
    const check = draftDefinition ? checkActivatable(draftDefinition) : { activatable: false, blockers: [{ path: "draft", message: "No ICP draft yet — start a conversation" }] };

    return {
      projectId,
      active: active ? { id: active.id, version: active.version, definition: active.definition as unknown as IcpDefinition, activatedAt: active.activatedAt!.toISOString() } : null,
      draft: draftDefinition && draft ? { id: draft.id, version: draft.version, definition: draftDefinition, chatTranscript: draft.chatTranscript as unknown as ChatMessage[] } : null,
      unresolvedClarifications: draftDefinition ? unresolvedClarifications(draftDefinition) : [],
      defaultedAssumptions: draftDefinition ? defaultedAssumptions(draftDefinition) : [],
      activatable: check.activatable,
      blockers: check.blockers,
    };
  }
}

function userTurn(content: string): ChatMessage {
  return { role: "user", content, at: new Date().toISOString() };
}
function assistantTurn(content: string): ChatMessage {
  return { role: "assistant", content, at: new Date().toISOString() };
}
