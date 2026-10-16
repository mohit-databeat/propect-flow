import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AssessmentBatchRequest, AssessmentCompanyInput, AssessmentOutputItem, CanonicalCompany, QualitativeCriterion } from "@prospect/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { AiService, type AiCallerCtx } from "../ai/ai.service";
import { getPath, LIST_GROUP_FIELDS, type EvalResult } from "./deterministic-evaluator";

export interface LlmBudget {
  used: number;
  max: number;
}

export interface AssessmentStats {
  llmCalls: number;
  cacheHits: number;
  capReached: number;
  missingEvidenceUnknown: number;
}

export function newAssessmentStats(): AssessmentStats {
  return { llmCalls: 0, cacheHits: 0, capReached: 0, missingEvidenceUnknown: 0 };
}

export interface AssessBatchOptions {
  workspaceId: string;
  projectId: string;
  icpProfileId: string;
  batchSize: number;
  budget: LlmBudget;
  stats?: AssessmentStats;
}

interface CompanyForAssessment {
  companyId: string;
  canonical: CanonicalCompany;
  resolvedHash: string;
}

function cacheKey(icpProfileId: string, criterionId: string, resolvedHash: string): string {
  return `${icpProfileId}:${criterionId}:${resolvedHash}`;
}

interface ListGroupValue {
  items: Record<string, unknown>[];
  authoritative?: boolean;
}

function isFieldUsable(canonical: CanonicalCompany, field: string): boolean {
  if (LIST_GROUP_FIELDS.has(field)) {
    const group = getPath(canonical, field) as ListGroupValue | undefined;
    if (!group) return false;
    return (group.items?.length ?? 0) > 0 || group.authoritative === true;
  }
  const v = getPath(canonical, field);
  return v !== undefined && v !== null && v !== "";
}

function filterRecency(value: unknown, recencyDays?: number): unknown {
  if (!recencyDays || !value || typeof value !== "object" || !("items" in value)) return value;
  const group = value as ListGroupValue;
  const cutoff = Date.now() - recencyDays * 86_400_000;
  const items = group.items.filter((item) => {
    const dateStr = (item.postedAt ?? item.date ?? item.observedAt) as string | undefined;
    if (!dateStr) return true;
    const t = Date.parse(dateStr);
    return Number.isNaN(t) ? true : t >= cutoff;
  });
  return { ...group, items };
}

@Injectable()
export class QualitativeAssessorService {
  private readonly logger = new Logger(QualitativeAssessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
  ) {}

  async assessForCompanies(opts: AssessBatchOptions, criterion: QualitativeCriterion, companies: CompanyForAssessment[]): Promise<Map<string, EvalResult>> {
    const out = new Map<string, EvalResult>();
    const needsLlm: CompanyForAssessment[] = [];

    for (const c of companies) {
      const missing = criterion.requiredEvidenceFields.filter((f) => !isFieldUsable(c.canonical, f));
      if (missing.length > 0) {
        out.set(c.companyId, { status: "UNKNOWN", reason: `Missing required evidence: ${missing.join(", ")}`, missingFields: missing });
        if (opts.stats) opts.stats.missingEvidenceUnknown++;
        continue;
      }
      const cached = await this.lookupCache(opts.icpProfileId, criterion.id, c.resolvedHash);
      if (cached) {
        out.set(c.companyId, cached);
        if (opts.stats) opts.stats.cacheHits++;
        continue;
      }
      needsLlm.push(c);
    }

    const allowed: CompanyForAssessment[] = [];
    for (const c of needsLlm) {
      if (opts.budget.used >= opts.budget.max) {
        out.set(c.companyId, { status: "UNKNOWN", reason: "LLM assessment cap reached for this workflow run", missingFields: [] });
        if (opts.stats) opts.stats.capReached++;
        continue;
      }
      opts.budget.used++;
      allowed.push(c);
    }

    for (let i = 0; i < allowed.length; i += opts.batchSize) {
      const chunk = allowed.slice(i, i + opts.batchSize);
      await this.assessChunk(opts, criterion, chunk, out);
      if (opts.stats) opts.stats.llmCalls += chunk.length;
    }

    return out;
  }

  private async assessChunk(opts: AssessBatchOptions, criterion: QualitativeCriterion, chunk: CompanyForAssessment[], out: Map<string, EvalResult>): Promise<void> {
    const inputs = new Map<string, AssessmentCompanyInput>();
    for (const c of chunk) inputs.set(c.companyId, this.buildEvidence(criterion, c.canonical, c.companyId));

    const request: AssessmentBatchRequest = {
      criterionId: criterion.id,
      question: criterion.question,
      passRubric: criterion.passRubric,
      failRubric: criterion.failRubric,
      recencyDays: criterion.recencyDays,
      evidenceFields: criterion.evidenceFields,
      companies: [...inputs.values()],
    };

    const ctx: AiCallerCtx = { workspaceId: opts.workspaceId, projectId: opts.projectId };
    const { data, aiRunId } = await this.ai.assessCriteria(ctx, request, `${criterion.id}:${chunk.map((c) => c.companyId).join(",")}`);

    const byCompany = new Map(data.results.map((r) => [r.companyId, r]));
    for (const c of chunk) {
      const item = byCompany.get(c.companyId);
      const input = inputs.get(c.companyId)!;
      const result = item
        ? this.validate(criterion, input, item, aiRunId)
        : { status: "UNKNOWN" as const, reason: "Model did not return a result for this company", missingFields: [], aiRunId };
      out.set(c.companyId, result);
      await this.writeCache(opts.icpProfileId, criterion.id, c.resolvedHash, opts.workspaceId, aiRunId, result);
    }
  }

  private buildEvidence(criterion: QualitativeCriterion, canonical: CanonicalCompany, companyId: string): AssessmentCompanyInput {
    const evidence: Record<string, unknown> = {};
    const suppliedAttributeIds = new Set<string>();
    for (const field of criterion.evidenceFields) {
      const raw = getPath(canonical, field);
      evidence[field] = filterRecency(raw, criterion.recencyDays) ?? null;
      const prov = (canonical.provenance as Record<string, { attributeId: string; mergedFrom?: string[] }> | undefined)?.[field];
      if (prov) {
        suppliedAttributeIds.add(prov.attributeId);
        for (const m of prov.mergedFrom ?? []) suppliedAttributeIds.add(m);
      }
    }
    return { companyId, evidence, suppliedAttributeIds: [...suppliedAttributeIds] };
  }

  private validate(criterion: QualitativeCriterion, input: AssessmentCompanyInput, item: AssessmentOutputItem, aiRunId: string): EvalResult {
    const supplied = new Set(input.suppliedAttributeIds);
    const invalidRefs = item.evidenceRefs.filter((id) => !supplied.has(id));
    if (item.evidenceRefs.length > 0 && invalidRefs.length > 0) {
      return { status: "UNKNOWN", reason: "invalid evidence citation", confidence: item.confidence, missingFields: [], aiRunId };
    }
    if (item.confidence < criterion.minConfidence) {
      return {
        status: "UNKNOWN",
        reason: `LLM confidence ${item.confidence} is below the required minimum ${criterion.minConfidence}`,
        confidence: item.confidence,
        missingFields: [],
        aiRunId,
      };
    }
    return {
      status: item.verdict,
      reason: item.reason,
      confidence: item.confidence,
      evidenceAttributeIds: item.evidenceRefs.filter((id) => supplied.has(id)),
      evidenceContent: { field: criterion.evidenceFields[0], criterionId: criterion.id, evidenceFields: criterion.evidenceFields },
      missingFields: [],
      aiRunId,
    };
  }

  private async lookupCache(icpProfileId: string, criterionId: string, resolvedHash: string): Promise<EvalResult | null> {
    const key = cacheKey(icpProfileId, criterionId, resolvedHash);
    const hit = await this.prisma.aiRun.findFirst({ where: { purpose: "QUALITATIVE_ASSESS", refType: "qualitative_cache", refId: key }, orderBy: { createdAt: "desc" } });
    if (!hit?.output) return null;
    this.logger.debug(`qualitative assessment cache hit: ${key}`);
    return { ...(hit.output as unknown as EvalResult), aiRunId: hit.id };
  }

  private async writeCache(icpProfileId: string, criterionId: string, resolvedHash: string, workspaceId: string, parentAiRunId: string, result: EvalResult): Promise<void> {
    const key = cacheKey(icpProfileId, criterionId, resolvedHash);

    await this.prisma.aiRun.create({
      data: {
        workspaceId,
        purpose: "QUALITATIVE_ASSESS",
        providerKey: "cache",
        model: "cache",
        promptKey: "qualify.assess",
        promptVersion: 1,
        input: { parentAiRunId } as unknown as Prisma.InputJsonValue,
        output: result as unknown as Prisma.InputJsonValue,
        status: "SUCCEEDED",
        refType: "qualitative_cache",
        refId: key,
      },
    });
  }
}
