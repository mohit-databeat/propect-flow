import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { PrismaModule } from "./prisma/prisma.module";
import { ProvidersModule } from "./providers/providers.module";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { HealthController } from "./health/health.controller";
import { AuthModule } from "./modules/auth/auth.module";
import { WorkspacesModule } from "./modules/workspaces/workspaces.module";
import { ProjectsModule } from "./modules/projects/projects.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { AiModule } from "./modules/ai/ai.module";
import { IcpModule } from "./modules/icp/icp.module";
import { DataSourcesModule } from "./modules/data-sources/data-sources.module";
import { QualificationModule } from "./modules/qualification/qualification.module";
import { WorkflowModule } from "./modules/workflow/workflow.module";
import { WorkflowBuilderModule } from "./modules/workflow-builder/workflow-builder.module";
import { ProspectsModule } from "./modules/prospects/prospects.module";
import { MessagesModule } from "./modules/messages/messages.module";
import { OutboundModule } from "./modules/outbound/outbound.module";
import { CampaignsModule } from "./modules/campaigns/campaigns.module";
import { SettingsModule } from "./modules/settings/settings.module";

@Module({
  imports: [
    PrismaModule,
    ProvidersModule,
    AuthModule,
    WorkspacesModule,
    ProjectsModule,
    AnalyticsModule,
    AiModule,
    IcpModule,
    DataSourcesModule,
    QualificationModule,
    WorkflowModule,
    WorkflowBuilderModule,
    ProspectsModule,
    MessagesModule,
    OutboundModule,
    CampaignsModule,
    SettingsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
