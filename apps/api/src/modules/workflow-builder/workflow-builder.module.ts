import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module";
import { DataSourcesModule } from "../data-sources/data-sources.module";
import { CampaignsModule } from "../campaigns/campaigns.module";
import { NormalizationModule } from "../normalization/normalization.module";
import { QualificationModule } from "../qualification/qualification.module";
import { EnrichmentModule } from "../enrichment/enrichment.module";
import { MessagesModule } from "../messages/messages.module";
import { WorkflowsController } from "./workflows.controller";
import { WorkflowsService } from "./workflows.service";
import { ExecutionsController } from "./executions.controller";
import { ExecutionsService } from "./executions.service";
import { ProjectDefinitionValidator } from "./project-definition-validator.service";
import { RunStateService } from "./engine/run-state.service";
import { GraphExecutorService } from "./engine/graph-executor.service";
import { RecoveryService } from "./engine/recovery.service";
import { DataSourceNode, NormalizeNode } from "./nodes/source-nodes";
import { AiQaNode, ConditionNode, EnrichNode, GenerateEmailNode, QualifyNode, RequalifyNode } from "./nodes/prospect-nodes";
import { HumanApprovalNode, SimulatedSendNode } from "./nodes/review-and-send-nodes";

@Module({
  imports: [ProjectsModule, DataSourcesModule, CampaignsModule, NormalizationModule, QualificationModule, EnrichmentModule, MessagesModule],
  controllers: [WorkflowsController, ExecutionsController],
  providers: [
    WorkflowsService,
    ExecutionsService,
    ProjectDefinitionValidator,
    RunStateService,
    GraphExecutorService,
    RecoveryService,
    DataSourceNode,
    NormalizeNode,
    QualifyNode,
    ConditionNode,
    EnrichNode,
    RequalifyNode,
    GenerateEmailNode,
    AiQaNode,
    HumanApprovalNode,
    SimulatedSendNode,
  ],
  exports: [WorkflowsService, ProjectDefinitionValidator],
})
export class WorkflowBuilderModule {}
