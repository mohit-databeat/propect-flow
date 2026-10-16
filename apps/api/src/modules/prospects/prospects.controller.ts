import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { EnrichProspectDto, ProspectListQuery, type AttributeHistoryResponse, type ProspectDetail, type ProspectListResponse } from "@prospect/shared";
import { WorkspaceGuard } from "../../common/guards/workspace.guard";
import { CurrentWorkspace, type WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { ProspectsService } from "./prospects.service";

@Controller("projects/:id/prospects")
@UseGuards(WorkspaceGuard)
export class ProspectsController {
  constructor(private readonly prospects: ProspectsService) {}

  @Get()
  list(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Query(new ZodValidationPipe(ProspectListQuery)) query: ProspectListQuery): Promise<ProspectListResponse> {
    return this.prospects.list(ws, projectId, query);
  }

  @Get(":prospectId")
  get(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("prospectId") prospectId: string): Promise<ProspectDetail> {
    return this.prospects.getDetail(ws, projectId, prospectId);
  }

  @Get(":prospectId/attributes")
  attributes(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("prospectId") prospectId: string): Promise<AttributeHistoryResponse> {
    return this.prospects.getAttributeHistory(ws, projectId, prospectId);
  }

  @Post(":prospectId/enrich")
  enrich(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param("id") projectId: string,
    @Param("prospectId") prospectId: string,
    @Body(new ZodValidationPipe(EnrichProspectDto)) dto: EnrichProspectDto,
  ): Promise<ProspectDetail> {
    return this.prospects.enrichOne(ws, projectId, prospectId, dto);
  }

  @Post(":prospectId/requalify")
  requalify(@CurrentWorkspace() ws: WorkspaceContext, @Param("id") projectId: string, @Param("prospectId") prospectId: string): Promise<ProspectDetail> {
    return this.prospects.requalifyOne(ws, projectId, prospectId);
  }
}
