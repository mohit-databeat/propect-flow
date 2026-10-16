import { Injectable } from "@nestjs/common";
import { WorkspaceSettings, type UpdateWorkspaceDto, type WorkspaceMemberResponse, type WorkspaceResponse } from "@prospect/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { notFound } from "../../common/errors";
import type { WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { ProviderRegistryService } from "../../providers/provider-registry.service";

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistryService,
  ) {}

  async getCurrent(ws: WorkspaceContext): Promise<WorkspaceResponse> {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: ws.id } });
    if (!workspace) throw notFound("Workspace");
    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      settings: WorkspaceSettings.parse(workspace.settings),
      role: ws.role,
      createdAt: workspace.createdAt.toISOString(),
    };
  }

  private validateProviderSelection(workspaceId: string, settings: WorkspaceSettings): void {
    const ai = this.registry.getAi(settings.aiProviderKey);
    this.registry.ctxFor(workspaceId, ai);
    const enrichment = this.registry.getEnricher(settings.enrichmentProviderKey);
    this.registry.ctxFor(workspaceId, enrichment);
    const outbound = this.registry.getOutbound(settings.outboundProviderKey);
    this.registry.ctxFor(workspaceId, outbound);
  }

  async update(ws: WorkspaceContext, dto: UpdateWorkspaceDto): Promise<WorkspaceResponse> {
    const current = await this.prisma.workspace.findUniqueOrThrow({ where: { id: ws.id } });
    const mergedSettings = WorkspaceSettings.parse({ ...WorkspaceSettings.parse(current.settings), ...dto.settings });

    if (dto.settings) this.validateProviderSelection(ws.id, mergedSettings);

    const updated = await this.prisma.workspace.update({
      where: { id: ws.id },
      data: { name: dto.name ?? undefined, settings: mergedSettings },
    });

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      settings: WorkspaceSettings.parse(updated.settings),
      role: ws.role,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  async members(ws: WorkspaceContext): Promise<WorkspaceMemberResponse[]> {
    const rows = await this.prisma.workspaceMember.findMany({ where: { workspaceId: ws.id }, include: { user: true }, orderBy: { createdAt: "asc" } });
    return rows.map((m) => ({ userId: m.userId, email: m.user.email, name: m.user.name, role: m.role, joinedAt: m.createdAt.toISOString() }));
  }
}
