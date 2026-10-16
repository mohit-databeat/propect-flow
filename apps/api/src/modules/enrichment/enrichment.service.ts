import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CanonicalCompany, CanonicalFieldPath } from "@prospect/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { ProviderRegistryService } from "../../providers/provider-registry.service";
import { POLICIES, withPolicy } from "../../common/resilience";
import { AttributeWriterService } from "../normalization/attribute-writer.service";
import { IngestionService } from "../normalization/ingestion.service";

export interface EnrichCompanyOutcome {
  ran: boolean;
  skippedReason?: string;
  requested: CanonicalFieldPath[];
  supplied: CanonicalFieldPath[];
  unavailable: CanonicalFieldPath[];
  enrichmentRunId?: string;
}

@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistryService,
    private readonly attributeWriter: AttributeWriterService,
    private readonly ingestion: IngestionService,
  ) {}

  resolveProviderKey(workspaceSettings: { enrichmentProviderKey?: string } | null, envDefault: string): string {
    return workspaceSettings?.enrichmentProviderKey || envDefault;
  }

  async enrichCompany(opts: {
    workspaceId: string;
    projectId: string;
    companyId: string;
    workflowRunId?: string;
    providerKey: string;
    missingFields: CanonicalFieldPath[];
  }): Promise<EnrichCompanyOutcome> {
    const provider = this.registry.getEnricher(opts.providerKey);
    const requested = intersect(opts.missingFields, provider.supportedFields());

    if (requested.length === 0) {
      return { ran: false, skippedReason: "no missing field is supported by this enrichment provider", requested: [], supplied: [], unavailable: [] };
    }

    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: opts.companyId } });
    const ctx = this.registry.ctxFor(opts.workspaceId, provider, opts.projectId);

    const run = await this.prisma.enrichmentRun.create({
      data: {
        companyId: opts.companyId,
        workflowRunId: opts.workflowRunId ?? null,
        providerKey: provider.key,
        requestedFields: requested,
        status: "PENDING",
        startedAt: new Date(),
      },
    });

    try {
      const result = await withPolicy(POLICIES.enrichment, provider.key, (signal) =>
        provider.enrich({ ...ctx, signal }, company.canonical as unknown as CanonicalCompany, requested),
      );

      const suppliedFields = result.attributes.map((a) => a.field);

      const unavailable = [...new Set([...result.unavailable, ...requested.filter((f) => !suppliedFields.includes(f))])];

      await this.attributeWriter.append(result.attributes, {
        companyId: opts.companyId,
        sourceType: "ENRICHMENT",
        providerKey: provider.key,
        enrichmentRunId: run.id,
      });

      await this.prisma.enrichmentRun.update({
        where: { id: run.id },
        data: {
          suppliedFields,
          unavailableFields: unavailable,
          costUnits: Math.round(result.costUnits),
          rawResponse: (result.raw ?? null) as unknown as Prisma.InputJsonValue,
          status: unavailable.length === 0 ? "SUCCEEDED" : suppliedFields.length > 0 ? "PARTIAL" : "PARTIAL",
          finishedAt: new Date(),
        },
      });

      await this.ingestion.resolveCompany(opts.companyId);

      return { ran: true, requested, supplied: suppliedFields, unavailable, enrichmentRunId: run.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown enrichment error";
      this.logger.warn(`enrichment failed company=${opts.companyId} provider=${provider.key}: ${message}`);
      await this.prisma.enrichmentRun.update({ where: { id: run.id }, data: { status: "FAILED", error: message, finishedAt: new Date() } });

      return { ran: true, requested, supplied: [], unavailable: requested, enrichmentRunId: run.id };
    }
  }
}

function intersect(a: CanonicalFieldPath[], b: CanonicalFieldPath[]): CanonicalFieldPath[] {
  const set = new Set(b);
  return [...new Set(a)].filter((f) => set.has(f));
}
