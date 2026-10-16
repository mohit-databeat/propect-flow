import { Injectable } from "@nestjs/common";
import type { AnalyticsOverview } from "@prospect/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { env } from "../../config/env";
import type { WorkspaceContext } from "../../common/decorators/current-user.decorator";

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(ws: WorkspaceContext): Promise<AnalyticsOverview> {
    const [projectsTotal, projectsActive, projectsDraft, projectsArchived, companies] = await Promise.all([
      this.prisma.project.count({ where: { workspaceId: ws.id } }),
      this.prisma.project.count({ where: { workspaceId: ws.id, status: "ACTIVE" } }),
      this.prisma.project.count({ where: { workspaceId: ws.id, status: "DRAFT" } }),
      this.prisma.project.count({ where: { workspaceId: ws.id, status: "ARCHIVED" } }),
      this.prisma.company.count({ where: { workspaceId: ws.id } }),
    ]);

    const projectIds = (await this.prisma.project.findMany({ where: { workspaceId: ws.id }, select: { id: true } })).map((p) => p.id);

    const [prospectTotal, qualified, needsReview, disqualified, pending] = await Promise.all([
      this.prisma.prospect.count({ where: { projectId: { in: projectIds } } }),
      this.prisma.prospect.count({ where: { projectId: { in: projectIds }, status: "QUALIFIED" } }),
      this.prisma.prospect.count({ where: { projectId: { in: projectIds }, status: "NEEDS_REVIEW" } }),
      this.prisma.prospect.count({ where: { projectId: { in: projectIds }, status: "DISQUALIFIED" } }),
      this.prisma.prospect.count({ where: { projectId: { in: projectIds }, status: "PENDING" } }),
    ]);

    const [msgTotal, msgPending, msgApproved, msgRejected, msgEdited, msgSent] = await Promise.all([
      this.prisma.message.count({ where: { projectId: { in: projectIds } } }),
      this.prisma.message.count({ where: { projectId: { in: projectIds }, reviewStatus: "PENDING" } }),
      this.prisma.message.count({ where: { projectId: { in: projectIds }, reviewStatus: "APPROVED" } }),
      this.prisma.message.count({ where: { projectId: { in: projectIds }, reviewStatus: "REJECTED" } }),
      this.prisma.message.count({ where: { projectId: { in: projectIds }, reviewStatus: "EDITED" } }),
      this.prisma.message.count({ where: { projectId: { in: projectIds }, sendStatus: { in: ["SENT", "SENT_SIMULATED"] } } }),
    ]);

    const aiAgg = await this.prisma.aiRun.aggregate({
      where: { workspaceId: ws.id },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    });

    const [enrichTotal, enrichSucceeded, enrichPartial, enrichFailed] = await Promise.all([
      this.prisma.enrichmentRun.count({ where: { company: { workspaceId: ws.id } } }),
      this.prisma.enrichmentRun.count({ where: { company: { workspaceId: ws.id }, status: "SUCCEEDED" } }),
      this.prisma.enrichmentRun.count({ where: { company: { workspaceId: ws.id }, status: "PARTIAL" } }),
      this.prisma.enrichmentRun.count({ where: { company: { workspaceId: ws.id }, status: "FAILED" } }),
    ]);

    const recentRuns = await this.prisma.workflowRun.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { project: { select: { name: true } } },
    });

    return {
      projects: { total: projectsTotal, active: projectsActive, draft: projectsDraft, archived: projectsArchived },
      companies,
      prospects: { total: prospectTotal, qualified, needsReview, disqualified, pending },
      emails: { total: msgTotal, pendingReview: msgPending, approved: msgApproved, rejected: msgRejected, edited: msgEdited, sent: msgSent },
      ai: { runs: aiAgg._count._all, inputTokens: aiAgg._sum.inputTokens ?? 0, outputTokens: aiAgg._sum.outputTokens ?? 0, costUsd: aiAgg._sum.costUsd ?? 0 },
      enrichment: { runs: enrichTotal, succeeded: enrichSucceeded, partial: enrichPartial, failed: enrichFailed },
      recentRuns: recentRuns.map((r) => ({
        id: r.id,
        projectId: r.projectId,
        projectName: r.project.name,
        status: r.status,
        startedAt: r.startedAt?.toISOString() ?? null,
        finishedAt: r.finishedAt?.toISOString() ?? null,
        summary: r.summary as Record<string, unknown>,
      })),
      providers: {
        ai: { key: env.AI_PROVIDER, available: true, configured: env.AI_PROVIDER === "mock" || Boolean(env.ANTHROPIC_API_KEY) },
        enrichment: { key: env.ENRICHMENT_PROVIDER, available: env.ENRICHMENT_PROVIDER === "mock_enrichment", configured: env.ENRICHMENT_PROVIDER === "mock_enrichment" || Boolean(env.APOLLO_API_KEY) },
        outbound: { key: env.OUTBOUND_PROVIDER, available: env.OUTBOUND_PROVIDER === "simulated", configured: env.OUTBOUND_PROVIDER === "simulated" || Boolean(env.SMTP_HOST) },
      },
    };
  }
}
