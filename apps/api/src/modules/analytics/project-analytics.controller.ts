import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import type {
  AiUsageEntry,
  CriterionBreakdownEntry,
  DistributionBucket,
  EnrichmentUsageEntry,
  ProjectAnalyticsOverview,
  ProjectFunnel,
  QualificationBreakdown,
} from "@prospect/shared";
import { WorkspaceGuard } from "../../common/guards/workspace.guard";
import { CurrentWorkspace, type WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { ProjectAnalyticsService } from "./project-analytics.service";

@Controller("projects/:id/analytics")
@UseGuards(WorkspaceGuard)
export class ProjectAnalyticsController {
  constructor(private readonly analytics: ProjectAnalyticsService) {}

  @Get("overview")
  overview(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string): Promise<ProjectAnalyticsOverview> {
    return this.analytics.overview(ws, projectId);
  }

  @Get("funnel")
  funnel(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string): Promise<ProjectFunnel> {
    return this.analytics.funnel(ws, projectId);
  }

  @Get("qualification")
  qualification(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param("id") projectId: string,
  ): Promise<{ breakdown: QualificationBreakdown; scoreDistribution: DistributionBucket[]; coverageDistribution: DistributionBucket[] }> {
    return this.analytics.qualification(ws, projectId);
  }

  @Get("criteria")
  criteria(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string): Promise<CriterionBreakdownEntry[]> {
    return this.analytics.criteria(ws, projectId);
  }

  @Get("ai-usage")
  aiUsage(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string): Promise<AiUsageEntry[]> {
    return this.analytics.aiUsage(ws, projectId);
  }

  @Get("enrichment-usage")
  enrichmentUsage(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string): Promise<EnrichmentUsageEntry[]> {
    return this.analytics.enrichmentUsage(ws, projectId);
  }
}
