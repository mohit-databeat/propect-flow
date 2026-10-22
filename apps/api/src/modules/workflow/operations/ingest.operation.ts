import type { PrismaService } from "../../../prisma/prisma.service";
import type { IngestionService } from "../../normalization/ingestion.service";
import type { StepOutcome } from "../step-handler.interface";

export interface IngestDeps {
  prisma: PrismaService;
  ingestion: IngestionService;
}

export interface IngestScope {
  projectId: string;
  dataSourceIds?: string[];
  refresh: boolean;
}

export async function ingestOperation(deps: IngestDeps, scope: IngestScope): Promise<StepOutcome> {
  if (!scope.refresh) {
    return { summary: { refreshed: false }, skipped: true, skipReason: "refreshSources=false — reusing already-synced companies from Phase 3" };
  }

  const sources = scope.dataSourceIds?.length
    ? await deps.prisma.dataSource.findMany({ where: { id: { in: scope.dataSourceIds }, projectId: scope.projectId } })
    : await deps.prisma.dataSource.findMany({ where: { projectId: scope.projectId, status: { not: "ARCHIVED" } } });

  let synced = 0;
  let ignoredArchived = 0;
  const errors: string[] = [];
  for (const source of sources) {
    if (source.status === "ARCHIVED") {
      ignoredArchived++;
      continue;
    }
    try {
      await deps.ingestion.syncDataSource(source.id);
      synced++;
    } catch (err) {
      errors.push(`${source.name}: ${err instanceof Error ? err.message : "sync failed"}`);
    }
  }

  return { summary: { refreshed: true, sourcesConsidered: sources.length, synced, ignoredArchived, errors } };
}
