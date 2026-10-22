import { Injectable } from "@nestjs/common";
import type { WorkflowRun } from "@prisma/client";
import { IngestionService } from "../../normalization/ingestion.service";
import { normalizeOperation } from "../operations/normalize.operation";
import type { StepOutcome, WorkflowStepHandler } from "../step-handler.interface";

@Injectable()
export class NormalizeStepHandler implements WorkflowStepHandler {
  readonly key = "NORMALIZE" as const;

  constructor(private readonly ingestion: IngestionService) {}

  run(run: WorkflowRun): Promise<StepOutcome> {
    return normalizeOperation({ ingestion: this.ingestion }, { projectId: run.projectId });
  }
}
