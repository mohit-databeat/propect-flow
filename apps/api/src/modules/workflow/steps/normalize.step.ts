import { Injectable } from "@nestjs/common";
import type { WorkflowRun } from "@prisma/client";
import { IngestionService } from "../../normalization/ingestion.service";
import type { StepOutcome, WorkflowStepHandler } from "../step-handler.interface";

@Injectable()
export class NormalizeStepHandler implements WorkflowStepHandler {
  readonly key = "NORMALIZE" as const;

  constructor(private readonly ingestion: IngestionService) {}

  async run(run: WorkflowRun): Promise<StepOutcome> {
    const result = await this.ingestion.normalizePending({ projectId: run.projectId });
    return {
      summary: {
        normalizationErrors: result.normalizationErrors.length,
        possibleDuplicates: result.possibleDuplicates,
        newCompanies: result.newCompanies,
        mergedIntoExisting: result.mergedIntoExisting,
      },
    };
  }
}
