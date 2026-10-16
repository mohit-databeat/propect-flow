import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  ErrorCodes,
  type CreateDataSourceDto,
  type CsvUploadResponse,
  type DataSourceSummary,
  type FieldMappingDto,
  type SourceRecordSummary,
  type SyncResult,
  type UpdateDataSourceDto,
} from "@prospect/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { ProviderRegistryService } from "../../providers/provider-registry.service";
import { AppException, conflict, notFound } from "../../common/errors";
import type { WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { ProjectsService } from "../projects/projects.service";
import { AiService } from "../ai/ai.service";
import { CsvConnector, type CsvConfig } from "../connectors/csv.connector";
import { IngestionService } from "../normalization/ingestion.service";
import { validateMapping } from "./mapping-validation";

@Injectable()
export class DataSourcesService {
  private readonly logger = new Logger(DataSourcesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly registry: ProviderRegistryService,
    private readonly csvConnector: CsvConnector,
    private readonly ingestion: IngestionService,
    private readonly ai: AiService,
  ) {}

  connectorCatalogue() {
    return this.registry.catalogueConnectors();
  }

  async list(ws: WorkspaceContext, projectId: string, includeArchived: boolean): Promise<DataSourceSummary[]> {
    await this.projects.findOneOrThrow(ws, projectId);
    const rows = await this.prisma.dataSource.findMany({
      where: { projectId, ...(includeArchived ? {} : { status: { not: "ARCHIVED" } }) },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toSummary);
  }

  async create(ws: WorkspaceContext, projectId: string, dto: CreateDataSourceDto): Promise<DataSourceSummary> {
    const project = await this.projects.findOneOrThrow(ws, projectId);
    const connector = this.registry.getConnector(dto.providerKey);
    if (dto.type !== connector.type) {
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCodes.VALIDATION_ERROR, `Provider "${dto.providerKey}" is a ${connector.type} connector, not ${dto.type}`);
    }

    this.registry.ctxFor(project.workspaceId, connector);

    const row = await this.prisma.dataSource.create({
      data: {
        projectId,
        type: dto.type,
        providerKey: dto.providerKey,
        name: dto.name,
        config: dto.config as Prisma.InputJsonValue,
        status: connector.capabilities().requiresMapping ? "DRAFT" : "READY",
      },
    });
    return toSummary(row);
  }

  async get(ws: WorkspaceContext, projectId: string, dsId: string): Promise<DataSourceSummary> {
    return toSummary(await this.findOneOrThrow(ws, projectId, dsId));
  }

  async update(ws: WorkspaceContext, projectId: string, dsId: string, dto: UpdateDataSourceDto): Promise<DataSourceSummary> {
    const row = await this.findOneOrThrow(ws, projectId, dsId);
    const updated = await this.prisma.dataSource.update({
      where: { id: row.id },
      data: { name: dto.name ?? undefined, config: dto.config ? { ...(row.config as object), ...dto.config } as Prisma.InputJsonValue : undefined },
    });
    return toSummary(updated);
  }

  async archive(ws: WorkspaceContext, projectId: string, dsId: string): Promise<void> {
    const row = await this.findOneOrThrow(ws, projectId, dsId);
    await this.prisma.dataSource.update({ where: { id: row.id }, data: { status: "ARCHIVED" } });
  }

  async uploadCsv(ws: WorkspaceContext, projectId: string, fileName: string, csvText: string): Promise<CsvUploadResponse> {
    const project = await this.projects.findOneOrThrow(ws, projectId);
    const { columns, rows } = CsvConnector.parse(csvText);
    if (columns.length === 0) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCodes.VALIDATION_ERROR, "CSV file has no headers or is empty");

    const sampleRows = rows.slice(0, 20);
    const heuristic = await this.csvConnector.suggestMapping(columns, sampleRows);
    let mapping = heuristic.mapping;
    let confidence = heuristic.confidence;
    let mappingSource: "heuristic" | "ai" = "heuristic";

    try {
      const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: project.workspaceId } });
      const aiProviderKey = (workspace.settings as { aiProviderKey?: string })?.aiProviderKey ?? "mock";
      const aiProvider = this.registry.catalogueAi().find((p) => p.key === aiProviderKey);
      if (aiProvider?.available && aiProvider.configured) {
        const refined = await this.ai.suggestCsvMapping({ workspaceId: project.workspaceId, projectId }, columns, sampleRows);
        mapping = refined.data.mapping;
        confidence = refined.data.confidence;
        mappingSource = "ai";
      }
    } catch (err) {
      this.logger.warn(`CSV mapping AI refinement skipped, using heuristics: ${err instanceof Error ? err.message : err}`);
    }

    const config: CsvConfig = { fileName, delimiter: ",", columns, mapping, rows };
    const row = await this.prisma.dataSource.create({
      data: { projectId, type: "CSV", providerKey: "csv", name: fileName, config: config as unknown as Prisma.InputJsonValue, status: "DRAFT" },
    });

    return { dataSourceId: row.id, columns, sampleRows, suggestedMapping: mapping, confidence, mappingSource };
  }

  async updateMapping(ws: WorkspaceContext, projectId: string, dsId: string, mapping: FieldMappingDto): Promise<DataSourceSummary> {
    const row = await this.findOneOrThrow(ws, projectId, dsId);
    if (row.status === "ARCHIVED") throw conflict(ErrorCodes.DATA_SOURCE_NOT_READY, "Data source is archived");

    validateMapping(mapping);

    const config = { ...(row.config as object), mapping } as Prisma.InputJsonValue;
    const updated = await this.prisma.dataSource.update({ where: { id: row.id }, data: { config, status: "READY" } });
    return toSummary(updated);
  }

  async testConnection(ws: WorkspaceContext, projectId: string, dsId: string) {
    const row = await this.findOneOrThrow(ws, projectId, dsId);
    const project = await this.projects.findOneOrThrow(ws, projectId);
    const connector = this.registry.getConnector(row.providerKey);
    const ctx = this.registry.ctxFor(project.workspaceId, connector, projectId);
    return connector.testConnection(ctx, row.config);
  }

  async sync(ws: WorkspaceContext, projectId: string, dsId: string): Promise<SyncResult> {
    const row = await this.findOneOrThrow(ws, projectId, dsId);
    if (row.status === "ARCHIVED") throw conflict(ErrorCodes.DATA_SOURCE_NOT_READY, "Archived data sources cannot sync");
    const connector = this.registry.getConnector(row.providerKey);
    if (connector.capabilities().requiresMapping && row.status === "DRAFT") {
      throw conflict(ErrorCodes.DATA_SOURCE_NOT_READY, "Confirm the field mapping before syncing");
    }
    return this.ingestion.syncDataSource(dsId);
  }

  async getRecords(ws: WorkspaceContext, projectId: string, dsId: string, page: number, pageSize: number): Promise<{ items: SourceRecordSummary[]; total: number }> {
    const row = await this.findOneOrThrow(ws, projectId, dsId);
    const [items, total] = await Promise.all([
      this.prisma.sourceRecord.findMany({ where: { dataSourceId: row.id }, orderBy: { fetchedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.sourceRecord.count({ where: { dataSourceId: row.id } }),
    ]);
    return {
      items: items.map((r) => ({
        id: r.id,
        externalId: r.externalId,
        rawPayload: r.rawPayload as Record<string, unknown>,
        fetchedAt: r.fetchedAt.toISOString(),
        normalizedCompanyId: r.normalizedCompanyId,
        normalizationError: r.normalizationError,
      })),
      total,
    };
  }

  private async findOneOrThrow(ws: WorkspaceContext, projectId: string, dsId: string) {
    await this.projects.findOneOrThrow(ws, projectId);
    const row = await this.prisma.dataSource.findFirst({ where: { id: dsId, projectId } });
    if (!row) throw notFound("Data source");
    return row;
  }
}

function toSummary(row: { id: string; projectId: string; type: string; providerKey: string; name: string; config: unknown; status: string; lastSyncedAt: Date | null; recordCount: number; lastError: string | null; createdAt: Date; updatedAt: Date }): DataSourceSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type as DataSourceSummary["type"],
    providerKey: row.providerKey,
    name: row.name,
    config: row.config as Record<string, unknown>,
    status: row.status as DataSourceSummary["status"],
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    recordCount: row.recordCount,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
