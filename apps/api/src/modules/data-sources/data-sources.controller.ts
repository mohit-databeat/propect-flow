import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  CreateDataSourceDto,
  UpdateDataSourceDto,
  UpdateMappingDto,
  type CsvUploadResponse,
  type DataSourceSummary,
  type SourceRecordSummary,
  type SyncResult,
} from "@prospect/shared";
import { WorkspaceGuard } from "../../common/guards/workspace.guard";
import { CurrentWorkspace, type WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { env } from "../../config/env";
import { DataSourcesService } from "./data-sources.service";

@Controller("projects/:id/data-sources")
@UseGuards(WorkspaceGuard)
export class DataSourcesController {
  constructor(private readonly dataSources: DataSourcesService) {}

  @Get()
  list(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Query("includeArchived") includeArchived?: string): Promise<DataSourceSummary[]> {
    return this.dataSources.list(ws, projectId, includeArchived === "true");
  }

  @Post()
  create(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Body(new ZodValidationPipe(CreateDataSourceDto)) dto: CreateDataSourceDto): Promise<DataSourceSummary> {
    return this.dataSources.create(ws, projectId, dto);
  }

  @Post("csv/upload")
  @UseInterceptors(FileInterceptor("file"))
  async uploadCsv(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param("id") projectId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<CsvUploadResponse> {
    if (!file) throw new BadRequestException("No file uploaded (expected multipart field \"file\")");
    if (file.size > env.MAX_UPLOAD_MB * 1024 * 1024) throw new BadRequestException(`File exceeds the ${env.MAX_UPLOAD_MB}MB upload limit`);
    const text = file.buffer.toString("utf8");
    return this.dataSources.uploadCsv(ws, projectId, file.originalname, text);
  }

  @Get(":dsId")
  get(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("dsId") dsId: string): Promise<DataSourceSummary> {
    return this.dataSources.get(ws, projectId, dsId);
  }

  @Patch(":dsId")
  update(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param("id") projectId: string,
    @Param("dsId") dsId: string,
    @Body(new ZodValidationPipe(UpdateDataSourceDto)) dto: UpdateDataSourceDto,
  ): Promise<DataSourceSummary> {
    return this.dataSources.update(ws, projectId, dsId, dto);
  }

  @Delete(":dsId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("dsId") dsId: string): Promise<void> {
    await this.dataSources.archive(ws, projectId, dsId);
  }

  @Put(":dsId/mapping")
  updateMapping(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param("id") projectId: string,
    @Param("dsId") dsId: string,
    @Body(new ZodValidationPipe(UpdateMappingDto)) dto: UpdateMappingDto,
  ): Promise<DataSourceSummary> {
    return this.dataSources.updateMapping(ws, projectId, dsId, dto.mapping);
  }

  @Post(":dsId/test")
  test(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("dsId") dsId: string) {
    return this.dataSources.testConnection(ws, projectId, dsId);
  }

  @Post(":dsId/sync")
  sync(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("dsId") dsId: string): Promise<SyncResult> {
    return this.dataSources.sync(ws, projectId, dsId);
  }

  @Get(":dsId/records")
  records(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param("id") projectId: string,
    @Param("dsId") dsId: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "25",
  ): Promise<{ items: SourceRecordSummary[]; total: number }> {
    return this.dataSources.getRecords(ws, projectId, dsId, Number(page), Number(pageSize));
  }
}
