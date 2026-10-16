import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  AttributeHistoryEntry,
  AttributeHistoryField,
  AttributeHistoryResponse,
  EnrichProspectDto,
  ProspectDetail,
  ProspectListItem,
  ProspectListQuery,
  ProspectListResponse,
  QualificationResultDto,
} from "@prospect/shared";
import { WorkspaceSettings, type CanonicalFieldPath } from "@prospect/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { notFound, badRequest } from "../../common/errors";
import type { WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { ProjectsService } from "../projects/projects.service";
import { EnrichmentService } from "../enrichment/enrichment.service";
import { QualificationService } from "../qualification/qualification.service";
import { newAssessmentStats } from "../qualification/qualitative-assessor.service";
import { MessagesService } from "../messages/messages.service";
import { env } from "../../config/env";

interface ProspectSummary {
  requiredFails?: string[];
  missingFields?: string[];
}

@Injectable()
export class ProspectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly enrichment: EnrichmentService,
    private readonly qualification: QualificationService,
    private readonly messages: MessagesService,
  ) {}

  async list(ws: WorkspaceContext, projectId: string, query: ProspectListQuery): Promise<ProspectListResponse> {
    await this.projects.findOneOrThrow(ws, projectId);

    const runId = query.runId ?? (await this.prisma.workflowRun.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" }, select: { id: true } }))?.id;
    if (!runId) {
      return { items: [], page: query.page, pageSize: query.pageSize, total: 0, runId: null, statusCounts: { total: 0, qualified: 0, needsReview: 0, disqualified: 0, pending: 0 } };
    }

    const where: Prisma.ProspectWhereInput = { projectId, workflowRunId: runId };
    if (query.status) where.status = query.status;
    if (query.minScore !== undefined) where.score = { gte: query.minScore };
    if (query.q) {
      where.company = { OR: [{ name: { contains: query.q, mode: "insensitive" } }, { domain: { contains: query.q, mode: "insensitive" } }] };
    }
    if (query.criterion) {
      const [criterionId, status] = query.criterion.split(":");
      if (criterionId && status) where.results = { some: { criterionId, status: status as never, phase: "INITIAL" } };
    }

    const [sortField, sortDir] = query.sort.split(":") as [string, "asc" | "desc"];
    const orderBy: Prisma.ProspectOrderByWithRelationInput =
      sortField === "score"
        ? { score: { sort: sortDir, nulls: "last" } }
        : sortField === "name"
          ? { company: { name: sortDir } }
          : sortField === "status"
            ? { status: sortDir }
            : { score: { sort: "desc", nulls: "last" } };

    const [rows, total, statusGroups] = await Promise.all([
      this.prisma.prospect.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { company: { select: { name: true, domain: true, possibleDuplicate: true } }, results: { where: { phase: "INITIAL" }, orderBy: { criterionId: "asc" } } },
      }),
      this.prisma.prospect.count({ where }),

      this.prisma.prospect.groupBy({ by: ["status"], where: { projectId, workflowRunId: runId }, _count: { _all: true } }),
    ]);

    const byStatus = new Map(statusGroups.map((g) => [g.status, g._count._all]));
    const statusCounts = {
      total: [...byStatus.values()].reduce((a, b) => a + b, 0),
      qualified: byStatus.get("QUALIFIED") ?? 0,
      needsReview: byStatus.get("NEEDS_REVIEW") ?? 0,
      disqualified: byStatus.get("DISQUALIFIED") ?? 0,
      pending: byStatus.get("PENDING") ?? 0,
    };

    const items: ProspectListItem[] = rows.map((p) => ({
      id: p.id,
      companyId: p.companyId,
      companyName: p.company.name,
      domain: p.company.domain,
      possibleDuplicate: p.company.possibleDuplicate,
      status: p.status,
      score: p.score,
      coverage: p.coverage,
      requiredFails: (p.summary as { requiredFails?: string[] })?.requiredFails ?? [],
      keyResults: p.results.map((r) => ({ criterionId: r.criterionId, label: r.criterionLabel, status: r.status, required: r.required })),
      createdAt: p.createdAt.toISOString(),
    }));

    return { items, page: query.page, pageSize: query.pageSize, total, runId, statusCounts };
  }

  async getDetail(ws: WorkspaceContext, projectId: string, prospectId: string): Promise<ProspectDetail> {
    await this.projects.findOneOrThrow(ws, projectId);
    const prospect = await this.prisma.prospect.findFirst({
      where: { id: prospectId, projectId },
      include: {
        company: { include: { people: true, sourceRecords: { include: { dataSource: true } } } },
        workflowRun: true,
        results: { include: { evidence: true }, orderBy: { criterionId: "asc" } },
      },
    });
    if (!prospect) throw notFound("Prospect");

    const [enrichmentRuns, aiRunRows, messages] = await Promise.all([
      this.prisma.enrichmentRun.findMany({ where: { companyId: prospect.companyId }, orderBy: { startedAt: "asc" } }),
      this.prisma.aiRun.findMany({
        where: { id: { in: [...new Set(prospect.results.map((r) => r.aiRunId).filter((id): id is string => !!id))] } },
        orderBy: { createdAt: "asc" },
      }),
      this.messages.listForProspect(ws, projectId, prospectId),
    ]);
    const aiRunByCriterion = new Map(prospect.results.filter((r) => r.aiRunId).map((r) => [r.aiRunId!, r.criterionId]));

    const results: QualificationResultDto[] = prospect.results.map((r) => ({
      id: r.id,
      criterionId: r.criterionId,
      criterionLabel: r.criterionLabel,
      phase: r.phase,
      status: r.status,
      weight: r.weight,
      required: r.required,
      evaluator: r.evaluator,
      reason: r.reason,
      confidence: r.confidence,
      missingFields: r.missingFields,
      evidence: r.evidence.map((e) => ({ id: e.id, kind: e.kind, content: e.content as Record<string, unknown>, sourceRef: e.sourceRef, companyAttributeId: e.companyAttributeId })),
    }));

    return {
      id: prospect.id,
      projectId: prospect.projectId,
      workflowRunId: prospect.workflowRunId,
      icpProfileId: prospect.icpProfileId,
      status: prospect.status,
      score: prospect.score,
      coverage: prospect.coverage,
      summary: prospect.summary as Record<string, unknown>,
      aiReasoning: prospect.aiReasoning,
      createdAt: prospect.createdAt.toISOString(),
      updatedAt: prospect.updatedAt.toISOString(),
      company: {
        id: prospect.company.id,
        name: prospect.company.name,
        domain: prospect.company.domain,
        website: prospect.company.website,
        industry: prospect.company.industry,
        industryRaw: prospect.company.industryRaw,
        country: prospect.company.country,
        hqCity: prospect.company.hqCity,
        hqState: prospect.company.hqState,
        employeeCount: prospect.company.employeeCount,
        employeeRange: prospect.company.employeeRange,
        revenueUsd: prospect.company.revenueUsd !== null ? Number(prospect.company.revenueUsd) : null,
        revenueRange: prospect.company.revenueRange,
        foundedYear: prospect.company.foundedYear,
        fundingStage: prospect.company.fundingStage,
        totalFundingUsd: prospect.company.totalFundingUsd !== null ? Number(prospect.company.totalFundingUsd) : null,
        techStack: prospect.company.techStack,
        possibleDuplicate: prospect.company.possibleDuplicate,
        canonical: prospect.company.canonical as Record<string, unknown>,
        resolvedHash: prospect.company.resolvedHash,
        normalizedAt: prospect.company.normalizedAt?.toISOString() ?? null,
      },
      people: prospect.company.people.map((p) => ({
        id: p.id,
        fullName: p.fullName,
        title: p.title,
        seniority: p.seniority,
        department: p.department,
        email: p.email,
        phone: p.phone,
        linkedinUrl: p.linkedinUrl,
        providerKey: p.providerKey,
      })),
      sourceRecords: prospect.company.sourceRecords.map((r) => ({
        id: r.id,
        dataSourceId: r.dataSourceId,
        dataSourceName: r.dataSource.name,
        providerKey: r.dataSource.providerKey,
        externalId: r.externalId,
        rawPayload: r.rawPayload as Record<string, unknown>,
        fetchedAt: r.fetchedAt.toISOString(),
      })),
      results,
      workflowRun: {
        id: prospect.workflowRun.id,
        status: prospect.workflowRun.status,
        icpProfileId: prospect.workflowRun.icpProfileId,
        startedAt: prospect.workflowRun.startedAt?.toISOString() ?? null,
        finishedAt: prospect.workflowRun.finishedAt?.toISOString() ?? null,
      },
      enrichmentRuns: enrichmentRuns.map((r) => ({
        id: r.id,
        providerKey: r.providerKey,
        requestedFields: r.requestedFields,
        suppliedFields: r.suppliedFields,
        unavailableFields: r.unavailableFields,
        status: r.status,
        costUnits: r.costUnits,
        error: r.error,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
        durationMs: r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
      })),
      aiRuns: aiRunRows.map((r) => ({
        id: r.id,
        criterionId: aiRunByCriterion.get(r.id) ?? null,
        providerKey: r.providerKey,
        model: r.model,
        status: r.status,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUsd: r.costUsd,
        latencyMs: r.latencyMs,
        cached: r.providerKey === "cache",
        createdAt: r.createdAt.toISOString(),
      })),
      messages,
    };
  }

  async enrichOne(ws: WorkspaceContext, projectId: string, prospectId: string, dto: EnrichProspectDto): Promise<ProspectDetail> {
    const project = await this.projects.findOneOrThrow(ws, projectId);
    const prospect = await this.prisma.prospect.findFirst({ where: { id: prospectId, projectId } });
    if (!prospect) throw notFound("Prospect");

    const summary = (prospect.summary as ProspectSummary) ?? {};
    if ((summary.requiredFails?.length ?? 0) > 0) {
      throw badRequest("PROSPECT_HARD_DISQUALIFIED", "This prospect already failed a required criterion — enrichment would not change its outcome");
    }
    const missing = (dto.fields ?? summary.missingFields ?? []) as CanonicalFieldPath[];
    if (missing.length === 0) {
      throw badRequest("NO_MISSING_FIELDS", "This prospect has no missing fields to enrich");
    }

    const settings = WorkspaceSettings.parse((await this.prisma.workspace.findUniqueOrThrow({ where: { id: project.workspaceId } })).settings);
    const providerKey = this.enrichment.resolveProviderKey(settings, env.ENRICHMENT_PROVIDER);

    await this.enrichment.enrichCompany({
      workspaceId: project.workspaceId,
      projectId,
      companyId: prospect.companyId,
      workflowRunId: prospect.workflowRunId,
      providerKey,
      missingFields: missing,
    });

    return this.getDetail(ws, projectId, prospectId);
  }

  async requalifyOne(ws: WorkspaceContext, projectId: string, prospectId: string): Promise<ProspectDetail> {
    const project = await this.projects.findOneOrThrow(ws, projectId);
    const prospect = await this.prisma.prospect.findFirst({ where: { id: prospectId, projectId } });
    if (!prospect) throw notFound("Prospect");

    await this.qualification.requalifyCompanies([prospect.companyId], prospect.icpProfileId, prospect.workflowRunId, {
      workspaceId: project.workspaceId,
      projectId,
      workflowRunId: prospect.workflowRunId,
      batchSize: env.AI_ASSESS_BATCH_SIZE,
      budget: { used: 0, max: env.MAX_LLM_PROSPECTS_PER_RUN },
      stats: newAssessmentStats(),
    });

    return this.getDetail(ws, projectId, prospectId);
  }

  async getAttributeHistory(ws: WorkspaceContext, projectId: string, prospectId: string): Promise<AttributeHistoryResponse> {
    await this.projects.findOneOrThrow(ws, projectId);
    const prospect = await this.prisma.prospect.findFirst({ where: { id: prospectId, projectId }, select: { companyId: true, company: { select: { canonical: true } } } });
    if (!prospect) throw notFound("Prospect");

    const attributes = await this.prisma.companyAttribute.findMany({ where: { companyId: prospect.companyId }, orderBy: { observedAt: "desc" } });
    const provenance = (prospect.company.canonical as { provenance?: Record<string, { attributeId?: string }> })?.provenance ?? {};

    const byField = new Map<string, typeof attributes>();
    for (const a of attributes) {
      const list = byField.get(a.field) ?? [];
      list.push(a);
      byField.set(a.field, list);
    }

    const fields: AttributeHistoryField[] = [...byField.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([field, obs]) => {
        const winnerId = provenance[field]?.attributeId;
        const observations: AttributeHistoryEntry[] = obs.map((o) => ({
          id: o.id,
          value: o.value,
          sourceType: o.sourceType,
          providerKey: o.providerKey,
          confidence: o.confidence,
          observedAt: o.observedAt.toISOString(),
          isCurrentWinner: o.id === winnerId,
        }));
        const winner = observations.find((o) => o.isCurrentWinner) ?? observations[0];
        return { field, currentValue: winner?.value ?? null, observations };
      });

    return { companyId: prospect.companyId, fields };
  }
}
