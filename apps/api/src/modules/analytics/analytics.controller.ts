import { Controller, Get, UseGuards } from "@nestjs/common";
import type { AnalyticsOverview } from "@prospect/shared";
import { WorkspaceGuard } from "../../common/guards/workspace.guard";
import { CurrentWorkspace, type WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { AnalyticsService } from "./analytics.service";

@Controller("analytics")
@UseGuards(WorkspaceGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("overview")
  overview(@CurrentWorkspace() ws: WorkspaceContext): Promise<AnalyticsOverview> {
    return this.analytics.overview(ws);
  }
}
