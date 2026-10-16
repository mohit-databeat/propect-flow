import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ErrorCodes, type CreateProjectDto, type ProjectSummary, type UpdateProjectDto } from "@prospect/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { conflict, notFound } from "../../common/errors";
import type { WorkspaceContext } from "../../common/decorators/current-user.decorator";

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertNameAvailable(workspaceId: string, name: string, excludeProjectId?: string): Promise<void> {
    const existing = await this.prisma.project.findFirst({
      where: { workspaceId, name: { equals: name, mode: "insensitive" }, ...(excludeProjectId ? { id: { not: excludeProjectId } } : {}) },
      select: { id: true },
    });
    if (existing) throw conflict(ErrorCodes.PROJECT_NAME_TAKEN, `A project named "${name}" already exists in this workspace — project names must be unique.`);
  }

  async list(ws: WorkspaceContext): Promise<ProjectSummary[]> {
    const projects = await this.prisma.project.findMany({
      where: { workspaceId: ws.id },
      orderBy: { updatedAt: "desc" },
      include: {
        icpProfiles: { where: { status: "ACTIVE" }, take: 1 },
        workflowRuns: { orderBy: { createdAt: "desc" }, take: 1 },
        _count: { select: { dataSources: true, companies: true } },
      },
    });

    return Promise.all(
      projects.map(async (p) => {
        const [qualified, needsReview, disqualified, prospectTotal] = await Promise.all([
          this.prisma.prospect.count({ where: { projectId: p.id, status: "QUALIFIED" } }),
          this.prisma.prospect.count({ where: { projectId: p.id, status: "NEEDS_REVIEW" } }),
          this.prisma.prospect.count({ where: { projectId: p.id, status: "DISQUALIFIED" } }),
          this.prisma.prospect.count({ where: { projectId: p.id } }),
        ]);
        const activeIcp = p.icpProfiles[0];
        const lastRun = p.workflowRuns[0];
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          status: p.status,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
          counts: {
            dataSources: p._count.dataSources,
            companies: p._count.companies,
            prospects: prospectTotal,
            qualified,
            needsReview,
            disqualified,
          },
          activeIcp: activeIcp ? { id: activeIcp.id, name: (activeIcp.definition as { name?: string }).name ?? "Untitled ICP", version: activeIcp.version } : null,
          lastRun: lastRun ? { id: lastRun.id, status: lastRun.status, startedAt: lastRun.startedAt?.toISOString() ?? null, finishedAt: lastRun.finishedAt?.toISOString() ?? null } : null,
        } satisfies ProjectSummary;
      }),
    );
  }

  async create(ws: WorkspaceContext, dto: CreateProjectDto): Promise<ProjectSummary> {
    await this.assertNameAvailable(ws.id, dto.name);
    const project = await this.prisma.project
      .create({ data: { workspaceId: ws.id, name: dto.name, description: dto.description ?? null, status: "DRAFT" } })
      .catch((err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw conflict(ErrorCodes.PROJECT_NAME_TAKEN, `A project named "${dto.name}" already exists in this workspace — project names must be unique.`);
        }
        throw err;
      });
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      counts: { dataSources: 0, companies: 0, prospects: 0, qualified: 0, needsReview: 0, disqualified: 0 },
      activeIcp: null,
      lastRun: null,
    };
  }

  async findOneOrThrow(ws: WorkspaceContext, id: string) {
    const project = await this.prisma.project.findFirst({ where: { id, workspaceId: ws.id } });
    if (!project) throw notFound("Project");
    return project;
  }

  async get(ws: WorkspaceContext, id: string): Promise<ProjectSummary> {
    await this.findOneOrThrow(ws, id);
    const list = await this.list(ws);
    return list.find((p) => p.id === id)!;
  }

  async update(ws: WorkspaceContext, id: string, dto: UpdateProjectDto): Promise<ProjectSummary> {
    await this.findOneOrThrow(ws, id);
    if (dto.name) await this.assertNameAvailable(ws.id, dto.name, id);
    await this.prisma.project.update({ where: { id }, data: dto }).catch((err) => {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw conflict(ErrorCodes.PROJECT_NAME_TAKEN, `A project named "${dto.name}" already exists in this workspace — project names must be unique.`);
      }
      throw err;
    });
    return this.get(ws, id);
  }

  async archive(ws: WorkspaceContext, id: string): Promise<void> {
    await this.findOneOrThrow(ws, id);
    await this.prisma.project.update({ where: { id }, data: { status: "ARCHIVED" } });
  }

  async unarchive(ws: WorkspaceContext, id: string): Promise<void> {
    const project = await this.findOneOrThrow(ws, id);
    if (project.status !== "ARCHIVED") return;
    await this.prisma.project.update({ where: { id }, data: { status: "DRAFT" } });
  }

  async delete(ws: WorkspaceContext, id: string): Promise<void> {
    await this.findOneOrThrow(ws, id);
    await this.prisma.project.delete({ where: { id } });
  }
}
