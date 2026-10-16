import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { CompanyAttribute, Prisma } from "@prisma/client";
import {
  CANONICAL_SCHEMA_VERSION,
  WorkspaceSettings,
  employeeRangeFor,
  revenueRangeFor,
  type CanonicalCompany,
} from "@prospect/shared";
import { PrismaService } from "../../prisma/prisma.service";

const LIST_GROUP_FIELDS = new Set(["technographics.stack", "signals.hiring", "signals.funding", "signals.news", "signals.expansion"]);
const DEFAULT_PRECEDENCE = ["MANUAL", "ENRICHMENT", "SOURCE", "NORMALIZER", "AI"];

interface ListGroupValue {
  items: unknown[];
  authoritative?: boolean;
  checkedAt?: string;
}

interface ResolvedField {
  value: unknown;
  attributeId: string;
  sourceType: string;
  providerKey: string;
  confidence: number;
  observedAt: Date;
  authoritative: boolean;
  mergedFrom?: string[];
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (typeof cursor[key] !== "object" || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]!] = value;
}

function itemDedupeKey(field: string, item: Record<string, unknown>): string {
  if (field === "technographics.stack") return String(item.key ?? item.raw ?? "");
  if (field === "signals.hiring") return String(item.url ?? `${item.title}|${item.postedAt}`);
  if (field === "signals.news") return String(item.url ?? `${item.headline}|${item.date}`);
  if (field === "signals.funding") return String(`${item.round}|${item.date}`);
  return JSON.stringify(item);
}

@Injectable()
export class ResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveCompany(companyId: string): Promise<void> {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: company.workspaceId } });
    const precedence = WorkspaceSettings.parse(workspace.settings).sourcePrecedence ?? DEFAULT_PRECEDENCE;
    const precedenceIndex = (sourceType: string) => {
      const i = precedence.indexOf(sourceType as (typeof precedence)[number]);
      return i === -1 ? precedence.length : i;
    };

    const attributes = await this.prisma.companyAttribute.findMany({ where: { companyId } });
    const byField = new Map<string, CompanyAttribute[]>();
    for (const a of attributes) {
      const list = byField.get(a.field) ?? [];
      list.push(a);
      byField.set(a.field, list);
    }

    const resolved = new Map<string, ResolvedField>();
    for (const [field, obs] of byField) {
      const sorted = [...obs].sort((a, b) => {
        const p = precedenceIndex(a.sourceType) - precedenceIndex(b.sourceType);
        if (p !== 0) return p;
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        return b.observedAt.getTime() - a.observedAt.getTime();
      });

      if (LIST_GROUP_FIELDS.has(field)) {
        resolved.set(field, resolveListGroup(field, sorted));
      } else {
        const top = sorted[0]!;
        resolved.set(field, {
          value: top.value,
          attributeId: top.id,
          sourceType: top.sourceType,
          providerKey: top.providerKey,
          confidence: top.confidence,
          observedAt: top.observedAt,
          authoritative: false,
        });
      }
    }

    const canonical: Record<string, unknown> = {
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      identity: { name: company.name },
      firmographics: {},
      technographics: { stack: { items: [], authoritative: false } },
      signals: {
        hiring: { items: [], authoritative: false },
        funding: { items: [], authoritative: false },
        news: { items: [], authoritative: false },
        expansion: { items: [], authoritative: false },
      },
      provenance: {} as Record<string, unknown>,
    };

    const provenance: Record<string, unknown> = {};
    for (const [field, r] of resolved) {
      if (LIST_GROUP_FIELDS.has(field)) {
        setPath(canonical, field, { items: r.value, authoritative: r.authoritative, checkedAt: r.observedAt.toISOString() });
      } else if (field === "firmographics.industryRaw") {

        setPath(canonical, field, r.value);
      } else {
        setPath(canonical, field, r.value);
      }
      provenance[field] = {
        attributeId: r.attributeId,
        sourceType: r.sourceType,
        providerKey: r.providerKey,
        confidence: r.confidence,
        observedAt: r.observedAt.toISOString(),
        authoritative: r.authoritative,
        ...(r.mergedFrom ? { mergedFrom: r.mergedFrom } : {}),
      };
    }
    canonical.provenance = provenance;

    const firmo = canonical.firmographics as Record<string, unknown>;
    const employeeCount = typeof firmo.employeeCount === "number" ? firmo.employeeCount : undefined;
    const revenueUsd = typeof firmo.revenueUsd === "number" ? firmo.revenueUsd : undefined;
    if (employeeCount !== undefined) firmo.employeeRange = employeeRangeFor(employeeCount);
    if (revenueUsd !== undefined) firmo.revenueRange = revenueRangeFor(revenueUsd);

    const techStack = ((canonical.technographics as Record<string, unknown>).stack as ListGroupValue).items as { key: string }[];

    const { provenance: _omit, ...hashable } = canonical;
    void _omit;
    const resolvedHash = createHash("sha256").update(JSON.stringify(hashable)).digest("hex");

    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        name: (canonical.identity as Record<string, unknown>).name as string,
        domain: (canonical.identity as Record<string, unknown>).domain as string | undefined,
        industry: firmo.industry as string | undefined,
        industryRaw: firmo.industryRaw as string | undefined,
        subIndustry: firmo.subIndustry as string | undefined,
        description: firmo.description as string | undefined,
        country: firmo.country as string | undefined,
        hqCity: firmo.hqCity as string | undefined,
        hqState: firmo.hqState as string | undefined,
        employeeCount: employeeCount ?? null,
        employeeRange: (firmo.employeeRange as string | undefined) ?? null,
        revenueUsd: revenueUsd !== undefined ? BigInt(Math.round(revenueUsd)) : null,
        revenueRange: (firmo.revenueRange as string | undefined) ?? null,
        foundedYear: (firmo.foundedYear as number | undefined) ?? null,
        fundingStage: (firmo.fundingStage as string | undefined) ?? null,
        totalFundingUsd: firmo.totalFundingUsd !== undefined ? BigInt(Math.round(firmo.totalFundingUsd as number)) : null,
        techStack: techStack.map((t) => t.key),
        canonical: canonical as unknown as Prisma.InputJsonValue,
        canonicalSchemaVersion: CANONICAL_SCHEMA_VERSION,
        resolvedHash,
        normalizedAt: new Date(),
      },
    });
  }
}

function resolveListGroup(field: string, sorted: CompanyAttribute[]): ResolvedField {
  const top = sorted[0]!;
  const topValue = top.value as unknown as ListGroupValue;

  if (topValue.authoritative) {
    return {
      value: topValue.items,
      attributeId: top.id,
      sourceType: top.sourceType,
      providerKey: top.providerKey,
      confidence: top.confidence,
      observedAt: top.observedAt,
      authoritative: true,
    };
  }

  const nonAuthoritative = sorted.filter((o) => !(o.value as unknown as ListGroupValue).authoritative);
  const seen = new Map<string, unknown>();
  const mergedFrom: string[] = [];
  for (const obs of nonAuthoritative) {
    const items = (obs.value as unknown as ListGroupValue).items as Record<string, unknown>[];
    let contributed = false;
    for (const item of items) {
      const key = itemDedupeKey(field, item);
      if (!seen.has(key)) {
        seen.set(key, item);
        contributed = true;
      }
    }
    if (contributed || items.length === 0) mergedFrom.push(obs.id);
  }

  return {
    value: [...seen.values()],
    attributeId: top.id,
    sourceType: top.sourceType,
    providerKey: top.providerKey,
    confidence: top.confidence,
    observedAt: top.observedAt,
    authoritative: false,
    mergedFrom: mergedFrom.length > 0 ? mergedFrom : undefined,
  };
}

export type { CanonicalCompany };
