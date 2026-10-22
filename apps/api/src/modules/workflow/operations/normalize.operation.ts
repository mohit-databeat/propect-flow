import type { IngestionService } from "../../normalization/ingestion.service";
import type { StepOutcome } from "../step-handler.interface";

export interface NormalizeDeps {
  ingestion: IngestionService;
}

type NormalizeResult = Awaited<ReturnType<IngestionService["normalizePending"]>>;

export async function normalizeOperation(deps: NormalizeDeps, scope: { projectId: string; verifiedDataSourceIds?: string[] }): Promise<StepOutcome> {
  const results: NormalizeResult[] = [];
  if (scope.verifiedDataSourceIds?.length) {
    for (const dataSourceId of scope.verifiedDataSourceIds) results.push(await deps.ingestion.normalizePending({ dataSourceId }));
  } else {
    results.push(await deps.ingestion.normalizePending({ projectId: scope.projectId }));
  }

  const sum = (pick: (r: NormalizeResult) => number) => results.reduce((n, r) => n + pick(r), 0);
  return {
    summary: {
      normalizationErrors: sum((r) => r.normalizationErrors.length),
      possibleDuplicates: sum((r) => r.possibleDuplicates),
      newCompanies: sum((r) => r.newCompanies),
      mergedIntoExisting: sum((r) => r.mergedIntoExisting),
    },
  };
}
