import { Injectable } from "@nestjs/common";
import type { WorkflowRun } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { IngestionService } from "../../normalization/ingestion.service";
import { ingestOperation } from "../operations/ingest.operation";
import type { StepOutcome, WorkflowStepHandler } from "../step-handler.interface";

interface RunOptions {
  dataSourceIds?: string[];
  refreshSources?: boolean;
}

@Injectable()
export class IngestStepHandler implements WorkflowStepHandler {
  readonly key = "INGEST" as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: IngestionService,
  ) {}

  run(run: WorkflowRun): Promise<StepOutcome> {
    const options = (run.options ?? {}) as RunOptions;
    return ingestOperation(
      { prisma: this.prisma, ingestion: this.ingestion },
      { projectId: run.projectId, dataSourceIds: options.dataSourceIds, refresh: Boolean(options.refreshSources) },
    );
  }
}
