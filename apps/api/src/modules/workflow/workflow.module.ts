import { Module, OnModuleInit } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module";
import { NormalizationModule } from "../normalization/normalization.module";
import { QualificationModule } from "../qualification/qualification.module";
import { EnrichmentModule } from "../enrichment/enrichment.module";
import { MessagesModule } from "../messages/messages.module";
import { WorkflowController } from "./workflow.controller";
import { WorkflowService } from "./workflow.service";
import { WorkflowRunnerService } from "./workflow-runner.service";
import { InProcessJobDispatcher } from "./job-dispatcher";
import { IngestStepHandler } from "./steps/ingest.step";
import { NormalizeStepHandler } from "./steps/normalize.step";
import { QualifyStepHandler } from "./steps/qualify.step";
import { EnrichStepHandler } from "./steps/enrich.step";
import { RequalifyStepHandler } from "./steps/requalify.step";
import { GenerateEmailStepHandler } from "./steps/generate-email.step";
import { QaStepHandler } from "./steps/qa.step";
import { AwaitReviewStepHandler } from "./steps/await-review.step";

@Module({
  imports: [ProjectsModule, NormalizationModule, QualificationModule, EnrichmentModule, MessagesModule],
  controllers: [WorkflowController],
  providers: [
    WorkflowService,
    WorkflowRunnerService,
    InProcessJobDispatcher,
    IngestStepHandler,
    NormalizeStepHandler,
    QualifyStepHandler,
    EnrichStepHandler,
    RequalifyStepHandler,
    GenerateEmailStepHandler,
    QaStepHandler,
    AwaitReviewStepHandler,
  ],
  exports: [WorkflowService],
})
export class WorkflowModule implements OnModuleInit {
  constructor(
    private readonly dispatcher: InProcessJobDispatcher,
    private readonly runner: WorkflowRunnerService,
  ) {}

  onModuleInit(): void {
    this.dispatcher.setExecutor((job) => this.runner.executeStep(job));
  }
}
