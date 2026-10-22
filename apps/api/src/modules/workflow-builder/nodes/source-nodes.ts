import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { IngestionService } from "../../normalization/ingestion.service";
import { ingestOperation } from "../../workflow/operations/ingest.operation";
import { normalizeOperation } from "../../workflow/operations/normalize.operation";
import { companyIdsForSources, verifiedDataSourceIds } from "../../workflow/operations/scope";
import type { NodeContext, NodeHandler, NodeResult } from "../engine/node-handler.interface";

async function resolveSources(prisma: PrismaService, projectId: string, requested: readonly string[]): Promise<string[]> {
  const verified = await verifiedDataSourceIds(prisma, projectId, requested);
  if (requested.length > 0 && verified.length === 0) {
    throw new Error("None of the selected data sources are available in this project. Pick different sources or leave the selection empty to use all of them.");
  }
  return verified;
}

@Injectable()
export class DataSourceNode implements NodeHandler<"DATA_SOURCE"> {
  readonly type = "DATA_SOURCE" as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: IngestionService,
  ) {}

  async run(ctx: NodeContext<"DATA_SOURCE">): Promise<NodeResult> {
    const { dataSourceIds, refresh } = ctx.node.config;
    const summary: Record<string, unknown> = { requestedSources: dataSourceIds.length, refresh };

    if (refresh) {
      const ingest = await ingestOperation({ prisma: this.prisma, ingestion: this.ingestion }, { projectId: ctx.run.projectId, dataSourceIds, refresh: true });
      summary.ingest = ingest.summary;
      await ctx.log("info", "Refreshed the selected data sources");
    }

    const sources = await resolveSources(this.prisma, ctx.run.projectId, dataSourceIds);
    const companyIds = await companyIdsForSources(this.prisma, ctx.run.projectId, sources);
    summary.companies = companyIds.length;
    return { kind: "done", outputs: { out: companyIds }, summary };
  }
}

@Injectable()
export class NormalizeNode implements NodeHandler<"NORMALIZE"> {
  readonly type = "NORMALIZE" as const;
  readonly runsOnEmptyInput = true;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: IngestionService,
  ) {}

  async run(ctx: NodeContext<"NORMALIZE">): Promise<NodeResult> {
    const source = ctx.definition.nodes.find((n) => n.type === "DATA_SOURCE");
    const requested = source?.type === "DATA_SOURCE" ? source.config.dataSourceIds : [];
    const sources = await resolveSources(this.prisma, ctx.run.projectId, requested);

    const outcome = await normalizeOperation({ ingestion: this.ingestion }, { projectId: ctx.run.projectId, verifiedDataSourceIds: sources.length > 0 ? sources : undefined });
    const companyIds = await companyIdsForSources(this.prisma, ctx.run.projectId, sources);
    return { kind: "done", outputs: { out: companyIds }, summary: { ...outcome.summary, companies: companyIds.length } };
  }
}
