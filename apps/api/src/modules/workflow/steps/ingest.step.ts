import { Injectable } from "@nestjs/common";
import type { WorkflowRun } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { IngestionService } from "../../normalization/ingestion.service";
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

  async run(run: WorkflowRun): Promise<StepOutcome> {
    const options = (run.options ?? {}) as RunOptions;
    if (!options.refreshSources) {
      return { summary: { refreshed: false }, skipped: true, skipReason: "refreshSources=false — reusing already-synced companies from Phase 3" };
    }

    const sources = options.dataSourceIds?.length
      ? await this.prisma.dataSource.findMany({ where: { id: { in: options.dataSourceIds }, projectId: run.projectId } })
      : await this.prisma.dataSource.findMany({ where: { projectId: run.projectId, status: { not: "ARCHIVED" } } });

    let synced = 0;
    let ignoredArchived = 0;
    const errors: string[] = [];
    for (const source of sources) {
      if (source.status === "ARCHIVED") {
        ignoredArchived++;
        continue;
      }
      try {
        await this.ingestion.syncDataSource(source.id);
        synced++;
      } catch (err) {
        errors.push(`${source.name}: ${err instanceof Error ? err.message : "sync failed"}`);
      }
    }

    return { summary: { refreshed: true, sourcesConsidered: sources.length, synced, ignoredArchived, errors } };
  }
}
