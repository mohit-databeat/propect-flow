import { Injectable } from "@nestjs/common";
import type {
  AiUsageEntry,
  CriterionBreakdownEntry,
  DistributionBucket,
  EmailQaBreakdown,
  EnrichmentUsageEntry,
  ProjectAnalyticsOverview,
  ProjectFunnel,
  QualificationBreakdown,
  ReviewBreakdown,
} from "@prospect/shared";
import { PrismaService } from "../../prisma/prisma.service";
import type { WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { ProjectsService } from "../projects/projects.service";

const BUCKET_EDGES = [0, 20, 40, 60, 80, 101];
const BUCKET_LABELS = ["0-19", "20-39", "40-59", "60-79", "80-100"];

function bucketize(values: (number | null)[]): DistributionBucket[] {
  const counts = new Array(BUCKET_LABELS.length).fill(0) as number[];
  let noData = 0;
  for (const v of values) {
    if (v === null) {
      noData++;
      continue;
    }
    for (let i = 0; i < BUCKET_LABELS.length; i++) {
      if (v >= BUCKET_EDGES[i]! && v < BUCKET_EDGES[i + 1]!) {
        counts[i]!++;
        break;
      }
    }
  }
  const buckets = BUCKET_LABELS.map((label, i) => ({ bucket: label, count: counts[i]! }));
  if (noData > 0) buckets.push({ bucket: "No data", count: noData });
  return buckets;
}

function parseQualitativeBatchRefId(refId: string): string[] {
  const idx = refId.indexOf(":");
  if (idx === -1) return [];
  return refId
    .slice(idx + 1)
    .split(",")
    .filter(Boolean);
}

function parseQualitativeCacheIcpProfileId(refId: string): string | undefined {
  return refId.split(":")[0];
}

interface AiRunSlice {
  providerKey: string;
  model: string;
  purpose: string;
  refType: string | null;
  refId: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

@Injectable()
export class ProjectAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  private async projectScope(projectId: string) {
    const [icpProfiles, dataSources, prospects, messages, companies] = await Promise.all([
      this.prisma.icpProfile.findMany({ where: { projectId }, select: { id: true } }),
      this.prisma.dataSource.findMany({ where: { projectId }, select: { id: true } }),
      this.prisma.prospect.findMany({ where: { projectId }, select: { id: true } }),
      this.prisma.message.findMany({ where: { projectId }, select: { id: true } }),
      this.prisma.company.findMany({ where: { projectId }, select: { id: true } }),
    ]);
    return {
      icpProfileIds: new Set(icpProfiles.map((r) => r.id)),
      dataSourceIds: new Set(dataSources.map((r) => r.id)),
      prospectIds: new Set(prospects.map((r) => r.id)),
      messageIds: new Set(messages.map((r) => r.id)),
      companyIds: new Set(companies.map((r) => r.id)),
    };
  }

  async funnel(ws: WorkspaceContext, projectId: string): Promise<ProjectFunnel> {
    await this.projects.findOneOrThrow(ws, projectId);
    const [companies, qualified, needsReview, emailsGenerated, qaPassedOrWarned, approved, sent] = await Promise.all([
      this.prisma.company.count({ where: { projectId } }),
      this.prisma.prospect.count({ where: { projectId, status: "QUALIFIED" } }),
      this.prisma.prospect.count({ where: { projectId, status: "NEEDS_REVIEW" } }),
      this.prisma.message.count({ where: { projectId } }),
      this.prisma.message.count({ where: { projectId, qaStatus: { in: ["PASS", "WARN"] } } }),
      this.prisma.message.count({ where: { projectId, reviewStatus: "APPROVED" } }),
      this.prisma.message.count({ where: { projectId, sendStatus: { in: ["SENT", "SENT_SIMULATED"] } } }),
    ]);
    return {
      stages: [
        { key: "companies", label: "Companies", count: companies },
        { key: "qualified", label: "Qualified", count: qualified },
        { key: "needs_review", label: "Needs Review", count: needsReview },
        { key: "emails_generated", label: "Emails Generated", count: emailsGenerated },
        { key: "qa_passed_or_warned", label: "QA Passed/Warned", count: qaPassedOrWarned },
        { key: "human_approved", label: "Human Approved", count: approved },
        { key: "sent", label: "Sent", count: sent },
      ],
    };
  }

  async qualification(ws: WorkspaceContext, projectId: string): Promise<{ breakdown: QualificationBreakdown; scoreDistribution: DistributionBucket[]; coverageDistribution: DistributionBucket[] }> {
    await this.projects.findOneOrThrow(ws, projectId);
    const [qualified, needsReview, disqualified, pending, rows] = await Promise.all([
      this.prisma.prospect.count({ where: { projectId, status: "QUALIFIED" } }),
      this.prisma.prospect.count({ where: { projectId, status: "NEEDS_REVIEW" } }),
      this.prisma.prospect.count({ where: { projectId, status: "DISQUALIFIED" } }),
      this.prisma.prospect.count({ where: { projectId, status: "PENDING" } }),
      this.prisma.prospect.findMany({ where: { projectId }, select: { score: true, coverage: true } }),
    ]);
    return {
      breakdown: { total: qualified + needsReview + disqualified + pending, qualified, needsReview, disqualified, pending },
      scoreDistribution: bucketize(rows.map((r) => r.score)),
      coverageDistribution: bucketize(rows.map((r) => r.coverage)),
    };
  }

  async criteria(ws: WorkspaceContext, projectId: string): Promise<CriterionBreakdownEntry[]> {
    await this.projects.findOneOrThrow(ws, projectId);
    const rows = await this.prisma.qualificationResult.findMany({
      where: { prospect: { projectId } },
      select: { prospectId: true, criterionId: true, criterionLabel: true, status: true, phase: true },
    });

    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const key = `${r.prospectId}:${r.criterionId}`;
      const existing = latest.get(key);
      if (!existing || (existing.phase === "INITIAL" && r.phase === "POST_ENRICHMENT")) latest.set(key, r);
    }

    const byCriterion = new Map<string, CriterionBreakdownEntry>();
    for (const r of latest.values()) {
      const entry = byCriterion.get(r.criterionId) ?? { criterionId: r.criterionId, label: r.criterionLabel, pass: 0, fail: 0, unknown: 0 };
      if (r.status === "PASS") entry.pass++;
      else if (r.status === "FAIL") entry.fail++;
      else entry.unknown++;
      byCriterion.set(r.criterionId, entry);
    }
    return [...byCriterion.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  async aiUsage(ws: WorkspaceContext, projectId: string): Promise<AiUsageEntry[]> {
    const project = await this.projects.findOneOrThrow(ws, projectId);
    const scope = await this.projectScope(projectId);

    const allRuns = await this.prisma.aiRun.findMany({
      where: { workspaceId: project.workspaceId },
      select: { providerKey: true, model: true, purpose: true, refType: true, refId: true, inputTokens: true, outputTokens: true, costUsd: true },
    });

    const belongsToProject = (r: AiRunSlice): boolean => {
      if (!r.refId) return false;
      switch (r.refType) {
        case "icp_profile":
          return scope.icpProfileIds.has(r.refId);
        case "data_source":
          return scope.dataSourceIds.has(r.refId);
        case "message":
          return scope.prospectIds.has(r.refId) || scope.messageIds.has(r.refId);
        case "qualitative_batch":
          return parseQualitativeBatchRefId(r.refId).some((id) => scope.companyIds.has(id));
        case "qualitative_cache": {
          const icpProfileId = parseQualitativeCacheIcpProfileId(r.refId);
          return icpProfileId !== undefined && scope.icpProfileIds.has(icpProfileId);
        }
        default:
          return false;
      }
    };

    const projectRuns = allRuns.filter(belongsToProject);

    const real = new Map<string, AiUsageEntry>();
    const cache = new Map<string, AiUsageEntry>();
    for (const r of projectRuns) {
      const isCache = r.providerKey === "cache";
      const target = isCache ? cache : real;
      const key = isCache ? r.purpose : `${r.providerKey}:${r.model}:${r.purpose}`;
      const entry = target.get(key) ?? { providerKey: r.providerKey, model: r.model, purpose: r.purpose, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: null, cacheHits: 0 };
      entry.calls++;
      if (isCache) {
        entry.cacheHits = entry.calls;
      } else {
        entry.inputTokens += r.inputTokens;
        entry.outputTokens += r.outputTokens;
        if (r.costUsd !== null) entry.costUsd = (entry.costUsd ?? 0) + r.costUsd;
      }
      target.set(key, entry);
    }

    return [...real.values(), ...cache.values()].sort((a, b) => a.purpose.localeCompare(b.purpose) || a.providerKey.localeCompare(b.providerKey));
  }

  async enrichmentUsage(ws: WorkspaceContext, projectId: string): Promise<EnrichmentUsageEntry[]> {
    await this.projects.findOneOrThrow(ws, projectId);
    const rows = await this.prisma.enrichmentRun.findMany({
      where: { company: { projectId } },
      select: { providerKey: true, requestedFields: true, suppliedFields: true, unavailableFields: true, costUnits: true },
    });

    const byProvider = new Map<string, EnrichmentUsageEntry>();
    for (const r of rows) {
      const entry = byProvider.get(r.providerKey) ?? { providerKey: r.providerKey, calls: 0, fieldsRequested: 0, fieldsSupplied: 0, fieldsUnavailable: 0, costUnits: 0 };
      entry.calls++;
      entry.fieldsRequested += r.requestedFields.length;
      entry.fieldsSupplied += r.suppliedFields.length;
      entry.fieldsUnavailable += r.unavailableFields.length;
      entry.costUnits += r.costUnits;
      byProvider.set(r.providerKey, entry);
    }
    return [...byProvider.values()];
  }

  private async emailQaAndReview(projectId: string): Promise<{ emailQa: EmailQaBreakdown; review: ReviewBreakdown; sentSimulated: number; approvalRate: number | null }> {
    const [qaPending, qaPass, qaWarn, qaFail, revPending, revApproved, revRejected, revEdited, sentSimulated] = await Promise.all([
      this.prisma.message.count({ where: { projectId, qaStatus: "PENDING" } }),
      this.prisma.message.count({ where: { projectId, qaStatus: "PASS" } }),
      this.prisma.message.count({ where: { projectId, qaStatus: "WARN" } }),
      this.prisma.message.count({ where: { projectId, qaStatus: "FAIL" } }),
      this.prisma.message.count({ where: { projectId, reviewStatus: "PENDING" } }),
      this.prisma.message.count({ where: { projectId, reviewStatus: "APPROVED" } }),
      this.prisma.message.count({ where: { projectId, reviewStatus: "REJECTED" } }),
      this.prisma.message.count({ where: { projectId, reviewStatus: "EDITED" } }),
      this.prisma.message.count({ where: { projectId, sendStatus: "SENT_SIMULATED" } }),
    ]);
    const decided = revApproved + revRejected;
    return {
      emailQa: { pending: qaPending, pass: qaPass, warn: qaWarn, fail: qaFail },
      review: { pending: revPending, approved: revApproved, rejected: revRejected, edited: revEdited },
      sentSimulated,
      approvalRate: decided > 0 ? revApproved / decided : null,
    };
  }

  async overview(ws: WorkspaceContext, projectId: string): Promise<ProjectAnalyticsOverview> {
    await this.projects.findOneOrThrow(ws, projectId);
    const [companies, funnel, qual, criteria, aiUsage, enrichmentUsage, rest] = await Promise.all([
      this.prisma.company.count({ where: { projectId } }),
      this.funnel(ws, projectId),
      this.qualification(ws, projectId),
      this.criteria(ws, projectId),
      this.aiUsage(ws, projectId),
      this.enrichmentUsage(ws, projectId),
      this.emailQaAndReview(projectId),
    ]);
    return {
      projectId,
      companies,
      qualification: qual.breakdown,
      funnel,
      scoreDistribution: qual.scoreDistribution,
      coverageDistribution: qual.coverageDistribution,
      criteria,
      aiUsage,
      enrichmentUsage,
      emailQa: rest.emailQa,
      review: rest.review,
      sentSimulated: rest.sentSimulated,
      approvalRate: rest.approvalRate,
    };
  }
}
