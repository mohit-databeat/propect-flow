import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { IcpDefinition, type CanonicalCompany, type IcpCriterion } from "@prospect/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { NormalizersService } from "../normalization/normalizers";
import { evaluateDeterministic, getPath, LIST_GROUP_FIELDS, type EvalResult } from "./deterministic-evaluator";
import { computeScoring, type CriterionOutcome, type ProspectStatus } from "./scoring";
import { QualitativeAssessorService, type AssessmentStats, type LlmBudget } from "./qualitative-assessor.service";

export interface QualifyCompanyInput {
  runId: string;
  companyId: string;
  icpProfileId: string;
  phase: "INITIAL";
}

export interface QualifyCompanyResult {
  prospectId: string;
  status: ProspectStatus;
  score: number | null;
  coverage: number;
  missingFields: string[];
}

export interface RequalifyOptions {
  workspaceId: string;
  projectId: string;
  workflowRunId?: string;
  batchSize: number;
  budget: LlmBudget;
  stats?: AssessmentStats;
}

export interface RequalifyCompanyResult extends QualifyCompanyResult {
  llmCallsMade: number;
}

function isFieldUsable(canonical: CanonicalCompany, field: string): boolean {
  if (LIST_GROUP_FIELDS.has(field)) {
    const group = getPath(canonical, field) as { items?: unknown[]; authoritative?: boolean } | undefined;
    if (!group) return false;
    return (group.items?.length ?? 0) > 0 || group.authoritative === true;
  }
  const v = getPath(canonical, field);
  return v !== undefined && v !== null && v !== "";
}

@Injectable()
export class QualificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly normalizers: NormalizersService,
    private readonly qualitative: QualitativeAssessorService,
  ) {}

  async qualifyCompany(input: QualifyCompanyInput): Promise<QualifyCompanyResult> {
    const [icpProfile, company] = await Promise.all([
      this.prisma.icpProfile.findUniqueOrThrow({ where: { id: input.icpProfileId } }),
      this.prisma.company.findUniqueOrThrow({ where: { id: input.companyId } }),
    ]);
    const icp = IcpDefinition.parse(icpProfile.definition);
    const canonical = company.canonical as unknown as CanonicalCompany;

    const outcomes: CriterionOutcome[] = [];
    const evalByCriterion = new Map<string, EvalResult>();
    const missingFieldSet = new Set<string>();

    for (const criterion of icp.criteria) {
      const result = criterion.kind === "DETERMINISTIC" ? evaluateDeterministic(criterion, canonical, this.normalizers) : this.evaluateQualitativePending(criterion, canonical);
      evalByCriterion.set(criterion.id, result);
      outcomes.push({ criterion, status: result.status });
      if (result.status === "UNKNOWN" && criterion.enrichIfMissing) {
        for (const f of result.missingFields) missingFieldSet.add(f);
      }
    }

    const scoring = computeScoring(icp, outcomes);
    const missingFields = [...missingFieldSet];
    const summary = buildSummary(outcomes, scoring, missingFields);
    const aiReasoning = buildReasoning(icp, outcomes, evalByCriterion, scoring, false);

    const prospect = await this.upsertProspect(input.runId, input.companyId, input.icpProfileId, company.projectId, scoring, summary, aiReasoning);
    for (const criterion of icp.criteria) {
      await this.persistResult(prospect.id, criterion, evalByCriterion.get(criterion.id)!, "INITIAL");
    }

    return { prospectId: prospect.id, status: scoring.status, score: scoring.score, coverage: scoring.coverage, missingFields };
  }

  async requalifyCompanies(companyIds: string[], icpProfileId: string, runId: string, opts: RequalifyOptions): Promise<Map<string, RequalifyCompanyResult>> {
    const icpProfile = await this.prisma.icpProfile.findUniqueOrThrow({ where: { id: icpProfileId } });
    const icp = IcpDefinition.parse(icpProfile.definition);
    const companies = await this.prisma.company.findMany({ where: { id: { in: companyIds } } });

    const perCompanyOutcomes = new Map<string, { outcomes: CriterionOutcome[]; evalByCriterion: Map<string, EvalResult> }>();
    const requiredFailCompanyIds = new Set<string>();

    for (const company of companies) {
      const canonical = company.canonical as unknown as CanonicalCompany;
      const outcomes: CriterionOutcome[] = [];
      const evalByCriterion = new Map<string, EvalResult>();
      for (const criterion of icp.criteria) {
        if (criterion.kind !== "DETERMINISTIC") continue;
        const result = evaluateDeterministic(criterion, canonical, this.normalizers);
        evalByCriterion.set(criterion.id, result);
        outcomes.push({ criterion, status: result.status });
        if (criterion.required && result.status === "FAIL") requiredFailCompanyIds.add(company.id);
      }
      perCompanyOutcomes.set(company.id, { outcomes, evalByCriterion });
    }

    const qualitativeCriteria = icp.criteria.filter((c): c is Extract<IcpCriterion, { kind: "QUALITATIVE" }> => c.kind === "QUALITATIVE");
    const llmCallsBefore = opts.budget.used;
    const llmCallsByCompany = new Map<string, number>();

    for (const criterion of qualitativeCriteria) {
      const eligible = companies.filter((c) => !requiredFailCompanyIds.has(c.id));
      const skipped = companies.filter((c) => requiredFailCompanyIds.has(c.id));

      for (const company of skipped) {
        const entry = perCompanyOutcomes.get(company.id)!;
        const result: EvalResult = { status: "UNKNOWN", reason: "skipped: a required criterion failed, LLM assessment not run", missingFields: [] };
        entry.evalByCriterion.set(criterion.id, result);
        entry.outcomes.push({ criterion, status: result.status });
      }

      if (eligible.length === 0) continue;

      const before = opts.budget.used;
      const results = await this.qualitative.assessForCompanies(
        { workspaceId: opts.workspaceId, projectId: opts.projectId, icpProfileId, batchSize: opts.batchSize, budget: opts.budget, stats: opts.stats },
        criterion,
        eligible.map((c) => ({ companyId: c.id, canonical: c.canonical as unknown as CanonicalCompany, resolvedHash: c.resolvedHash ?? c.id })),
      );
      const consumed = opts.budget.used - before;
      if (consumed > 0) {

        for (const c of eligible) llmCallsByCompany.set(c.id, (llmCallsByCompany.get(c.id) ?? 0) + 1);
      }

      for (const company of eligible) {
        const entry = perCompanyOutcomes.get(company.id)!;
        const result = results.get(company.id)!;
        entry.evalByCriterion.set(criterion.id, result);
        entry.outcomes.push({ criterion, status: result.status });
      }
    }
    void llmCallsBefore;

    const out = new Map<string, RequalifyCompanyResult>();
    for (const company of companies) {
      const { outcomes, evalByCriterion } = perCompanyOutcomes.get(company.id)!;
      const scoring = computeScoring(icp, outcomes);
      const missingFieldSet = new Set<string>();
      for (const { criterion, status } of outcomes) {
        if (status === "UNKNOWN" && criterion.enrichIfMissing) {
          for (const f of evalByCriterion.get(criterion.id)!.missingFields) missingFieldSet.add(f);
        }
      }
      const missingFields = [...missingFieldSet];
      const summary = buildSummary(outcomes, scoring, missingFields);
      const aiReasoning = buildReasoning(icp, outcomes, evalByCriterion, scoring, true);

      const prospect = await this.upsertProspect(runId, company.id, icpProfileId, company.projectId, scoring, summary, aiReasoning);
      for (const { criterion } of outcomes) {
        await this.persistResult(prospect.id, criterion, evalByCriterion.get(criterion.id)!, "POST_ENRICHMENT");
      }

      out.set(company.id, {
        prospectId: prospect.id,
        status: scoring.status,
        score: scoring.score,
        coverage: scoring.coverage,
        missingFields,
        llmCallsMade: llmCallsByCompany.get(company.id) ?? 0,
      });
    }

    return out;
  }

  private async upsertProspect(
    runId: string,
    companyId: string,
    icpProfileId: string,
    projectId: string,
    scoring: ReturnType<typeof computeScoring>,
    summary: Record<string, unknown>,
    aiReasoning: string,
  ) {
    return this.prisma.prospect.upsert({
      where: { workflowRunId_companyId: { workflowRunId: runId, companyId } },
      create: {
        projectId,
        workflowRunId: runId,
        companyId,
        icpProfileId,
        status: scoring.status,
        score: scoring.score,
        coverage: scoring.coverage,
        summary: summary as unknown as Prisma.InputJsonValue,
        aiReasoning,
      },
      update: {
        status: scoring.status,
        score: scoring.score,
        coverage: scoring.coverage,
        summary: summary as unknown as Prisma.InputJsonValue,
        aiReasoning,
      },
    });
  }

  private evaluateQualitativePending(criterion: Extract<IcpCriterion, { kind: "QUALITATIVE" }>, canonical: CanonicalCompany): EvalResult {
    const missing = criterion.requiredEvidenceFields.filter((f) => !isFieldUsable(canonical, f));
    return { status: "UNKNOWN", reason: "Qualitative assessment pending POST_ENRICHMENT evaluation (Phase 5)", missingFields: missing };
  }

  private async persistResult(prospectId: string, criterion: IcpCriterion, result: EvalResult, phase: "INITIAL" | "POST_ENRICHMENT"): Promise<void> {
    const data = {
      criterionLabel: criterion.label,
      status: result.status,
      weight: criterion.weight,
      required: criterion.required,
      evaluator: criterion.kind === "QUALITATIVE" ? ("LLM" as const) : ("DETERMINISTIC" as const),
      reason: result.reason,
      confidence: result.confidence ?? null,
      missingFields: result.missingFields,
      aiRunId: result.aiRunId ?? null,
    };

    const qr = await this.prisma.qualificationResult.upsert({
      where: { prospectId_criterionId_phase: { prospectId, criterionId: criterion.id, phase } },
      create: { prospectId, criterionId: criterion.id, phase, ...data },
      update: data,
    });

    await this.prisma.evidence.deleteMany({ where: { qualificationResultId: qr.id } });
    const attributeIds = result.evidenceAttributeIds ?? (result.evidenceAttributeId ? [result.evidenceAttributeId] : []);
    for (const attributeId of attributeIds) {
      await this.prisma.evidence.create({
        data: {
          qualificationResultId: qr.id,
          companyAttributeId: attributeId,
          kind: criterion.kind === "QUALITATIVE" ? "TEXT_SNIPPET" : LIST_GROUP_FIELDS.has(String(result.evidenceContent?.field)) ? "TEXT_SNIPPET" : "FIELD_VALUE",
          content: (result.evidenceContent ?? {}) as unknown as Prisma.InputJsonValue,
          sourceRef: typeof result.evidenceContent?.field === "string" ? result.evidenceContent.field : null,
        },
      });
    }
  }
}

function buildSummary(outcomes: CriterionOutcome[], scoring: ReturnType<typeof computeScoring>, missingFields: string[]) {
  return {
    passCount: outcomes.filter((o) => o.status === "PASS").length,
    failCount: outcomes.filter((o) => o.status === "FAIL").length,
    unknownCount: outcomes.filter((o) => o.status === "UNKNOWN").length,
    requiredFails: scoring.requiredFails,
    requiredUnknowns: scoring.requiredUnknowns,
    missingFields,
    knownWeight: scoring.knownWeight,
    totalWeight: scoring.totalWeight,
  };
}

function buildReasoning(icp: IcpDefinition, outcomes: CriterionOutcome[], results: Map<string, EvalResult>, scoring: ReturnType<typeof computeScoring>, postEnrichment: boolean): string {
  const headline =
    scoring.status === "QUALIFIED"
      ? `Qualified with score ${scoring.score}/100 (coverage ${scoring.coverage}%).`
      : scoring.status === "DISQUALIFIED" && scoring.requiredFails.length > 0
        ? `Disqualified: required criteria failed (${scoring.requiredFails.join(", ")}).`
        : scoring.status === "DISQUALIFIED"
          ? `Disqualified: score ${scoring.score}/100 is below the needs-review threshold.`
          : scoring.score === null
            ? "Needs review: no criteria could be evaluated from the data available."
            : `Needs review: score ${scoring.score}/100 (coverage ${scoring.coverage}%)${scoring.requiredUnknowns.length ? `; a required criterion could not be evaluated (${scoring.requiredUnknowns.join(", ")})` : ""}.`;

  const lines = outcomes.map(({ criterion, status }) => `• ${criterion.label}: ${status} — ${results.get(criterion.id)!.reason}`);
  const note = postEnrichment
    ? "\nThis is the final result after targeted enrichment and qualitative (AI-assessed) evaluation."
    : icp.criteria.some((c) => c.kind === "QUALITATIVE")
      ? "\nQualitative (AI-assessed) criteria are evaluated in Phase 5, after enrichment."
      : "";
  return [headline, "", ...lines, note].join("\n").trim();
}
