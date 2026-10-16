import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { ProjectAnalyticsController } from "./project-analytics.controller";
import { ProjectAnalyticsService } from "./project-analytics.service";

@Module({
  imports: [ProjectsModule],
  controllers: [AnalyticsController, ProjectAnalyticsController],
  providers: [AnalyticsService, ProjectAnalyticsService],
})
export class AnalyticsModule {}
