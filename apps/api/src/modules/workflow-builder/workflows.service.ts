import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Workflow, WorkflowVersion } from "@prisma/client";
import {
  ErrorCodes,
  WorkflowDefinition,
  defaultProspectingDefinition,
  emptyWorkflowDefinition,
  type CreateWorkflowDto,
  type PublishWorkflowDto,
  type PublishWorkflowResponse,
  type UpdateWorkflowDto,
  type ValidateWorkflowDto,
  type WorkflowDetailDto,
  type WorkflowDraftDefinition,
  type WorkflowSummaryDto,
  type WorkflowValidationResponse,
  type WorkflowVersionDto,
} from "@prospect/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { badRequest, conflict, notFound } from "../../common/errors";
import type { WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { ProjectsService } from "../projects/projects.service";
import { checksumOf } from "./definition-checksum";
import { ProjectDefinitionValidator } from "./project-definition-validator.service";

const MAX_PUBLISH_ATTEMPTS = 3;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function nodeCountOf(definition: unknown): number {
  const nodes = (definition as { nodes?: unknown } | null)?.nodes;
  return Array.isArray(nodes) ? nodes.length : 0;
}

const toVersionDto = (v: WorkflowVersion): WorkflowVersionDto => ({
  id: v.id,
  workflowId: v.workflowId,
  version: v.version,
  checksum: v.checksum,
  note: v.note,
  createdAt: v.createdAt.toISOString(),
});

function toSummary(w: Workflow, latestVersion: number | null): WorkflowSummaryDto {
  return {
    id: w.id,
    projectId: w.projectId,
    name: w.name,
    description: w.description,
    status: w.status,
    nodeCount: nodeCountOf(w.draftDefinition),
    latestVersion,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly validator: ProjectDefinitionValidator,
  ) {}

  async list(ws: WorkspaceContext, projectId: string): Promise<WorkflowSummaryDto[]> {
    await this.projects.findOneOrThrow(ws, projectId);
    const rows = await this.prisma.workflow.findMany({
      where: { projectId, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
      include: { versions: { orderBy: { version: "desc" }, take: 1, select: { version: true } } },
    });
    return rows.map((w) => toSummary(w, w.versions[0]?.version ?? null));
  }

  async create(ws: WorkspaceContext, projectId: string, userId: string, dto: CreateWorkflowDto): Promise<WorkflowDetailDto> {
    await this.projects.findOneOrThrow(ws, projectId);
    const definition = dto.template === "DEFAULT_PROSPECTING" ? defaultProspectingDefinition() : emptyWorkflowDefinition();

    try {
      const created = await this.prisma.workflow.create({
        data: {
          projectId,
          name: dto.name,
          description: dto.description ?? null,
          draftDefinition: definition as unknown as Prisma.InputJsonValue,
          draftChecksum: checksumOf(definition),
          createdById: userId,
        },
      });
      return this.toDetail(created, null);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(ErrorCodes.WORKFLOW_NAME_TAKEN, `A workflow named "${dto.name}" already exists in this project`);
      throw err;
    }
  }

  async get(ws: WorkspaceContext, projectId: string, workflowId: string): Promise<WorkflowDetailDto> {
    const workflow = await this.findOwnedOrThrow(ws, projectId, workflowId);
    return this.toDetail(workflow, await this.latestVersionNumber(workflow.id));
  }

  async update(ws: WorkspaceContext, projectId: string, workflowId: string, dto: UpdateWorkflowDto): Promise<WorkflowDetailDto> {
    const workflow = await this.findOwnedOrThrow(ws, projectId, workflowId);
    this.assertActive(workflow);

    const data: Prisma.WorkflowUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.definition !== undefined) {
      data.draftDefinition = dto.definition as unknown as Prisma.InputJsonValue;
      data.draftChecksum = checksumOf(dto.definition);
    }

    try {
      const updated = await this.prisma.workflow.update({ where: { id: workflow.id }, data });
      return this.toDetail(updated, await this.latestVersionNumber(updated.id));
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(ErrorCodes.WORKFLOW_NAME_TAKEN, `A workflow named "${dto.name}" already exists in this project`);
      throw err;
    }
  }

  async archive(ws: WorkspaceContext, projectId: string, workflowId: string): Promise<void> {
    const workflow = await this.findOwnedOrThrow(ws, projectId, workflowId);
    if (workflow.status === "ARCHIVED") return;
    await this.prisma.workflow.update({ where: { id: workflow.id }, data: { status: "ARCHIVED" } });
  }

  async validate(ws: WorkspaceContext, projectId: string, workflowId: string, dto: ValidateWorkflowDto): Promise<WorkflowValidationResponse> {
    const workflow = await this.findOwnedOrThrow(ws, projectId, workflowId);
    const result = await this.validator.validate(ws, projectId, dto.definition ?? workflow.draftDefinition);
    return { valid: result.valid, issues: result.issues };
  }

  async publish(ws: WorkspaceContext, projectId: string, workflowId: string, userId: string, dto: PublishWorkflowDto): Promise<PublishWorkflowResponse> {
    const workflow = await this.findOwnedOrThrow(ws, projectId, workflowId);
    this.assertActive(workflow);

    const result = await this.validator.validate(ws, projectId, workflow.draftDefinition);
    if (!result.valid) {
      throw badRequest(ErrorCodes.WORKFLOW_INVALID, `This workflow has ${result.issues.length} problem(s) and cannot be published`, result.issues);
    }

    const definition = WorkflowDefinition.parse(workflow.draftDefinition);
    const checksum = checksumOf(definition);

    for (let attempt = 1; attempt <= MAX_PUBLISH_ATTEMPTS; attempt++) {
      const existing = await this.prisma.workflowVersion.findUnique({ where: { workflowId_checksum: { workflowId: workflow.id, checksum } } });
      if (existing) return { ...toVersionDto(existing), alreadyPublished: true };

      const latest = await this.latestVersionNumber(workflow.id);
      try {
        const created = await this.prisma.workflowVersion.create({
          data: {
            workflowId: workflow.id,
            version: (latest ?? 0) + 1,
            definition: definition as unknown as Prisma.InputJsonValue,
            checksum,
            note: dto.note ?? null,
            createdById: userId,
          },
        });
        return { ...toVersionDto(created), alreadyPublished: false };
      } catch (err) {
        if (!isUniqueViolation(err) || attempt === MAX_PUBLISH_ATTEMPTS) throw err;
      }
    }
    throw conflict(ErrorCodes.VALIDATION_ERROR, "Could not publish because another publish was in progress. Try again.");
  }

  async listVersions(ws: WorkspaceContext, projectId: string, workflowId: string): Promise<WorkflowVersionDto[]> {
    const workflow = await this.findOwnedOrThrow(ws, projectId, workflowId);
    const rows = await this.prisma.workflowVersion.findMany({ where: { workflowId: workflow.id }, orderBy: { version: "desc" } });
    return rows.map(toVersionDto);
  }

  async findOwnedOrThrow(ws: WorkspaceContext, projectId: string, workflowId: string): Promise<Workflow> {
    await this.projects.findOneOrThrow(ws, projectId);
    const workflow = await this.prisma.workflow.findFirst({ where: { id: workflowId, projectId } });
    if (!workflow) throw notFound("Workflow");
    return workflow;
  }

  private assertActive(workflow: Workflow): void {
    if (workflow.status === "ARCHIVED") throw conflict(ErrorCodes.WORKFLOW_ARCHIVED, "This workflow is archived and can no longer be changed");
  }

  private async latestVersionNumber(workflowId: string): Promise<number | null> {
    const latest = await this.prisma.workflowVersion.findFirst({ where: { workflowId }, orderBy: { version: "desc" }, select: { version: true } });
    return latest?.version ?? null;
  }

  private toDetail(workflow: Workflow, latestVersion: number | null): WorkflowDetailDto {
    return { ...toSummary(workflow, latestVersion), definition: workflow.draftDefinition as unknown as WorkflowDraftDefinition };
  }
}
