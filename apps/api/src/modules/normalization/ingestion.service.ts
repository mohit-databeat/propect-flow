import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type { NewAttribute } from "@prospect/shared";
import { POLICIES, withPolicy } from "../../common/resilience";
import { ProviderRegistryService } from "../../providers/provider-registry.service";
import { PrismaService } from "../../prisma/prisma.service";
import { CompanyMatcherService } from "./company-matcher.service";
import { AttributeWriterService } from "./attribute-writer.service";
import { PersonWriterService } from "./person-writer.service";
import { ResolverService } from "./resolver.service";
import { NormalizersService } from "./normalizers";

export interface SyncOutcome {
  fetched: number;
  created: number;
  skipped: number;
  normalizationErrors: { externalId: string | null; error: string }[];
  possibleDuplicates: number;

  newCompanies: number;
  mergedIntoExisting: number;
}

const sha256 = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistryService,
    private readonly matcher: CompanyMatcherService,
    private readonly attributeWriter: AttributeWriterService,
    private readonly personWriter: PersonWriterService,
    private readonly resolver: ResolverService,
    private readonly normalizers: NormalizersService,
  ) {}

  async syncDataSource(dataSourceId: string): Promise<SyncOutcome> {
    const dataSource = await this.prisma.dataSource.findUniqueOrThrow({ where: { id: dataSourceId }, include: { project: true } });
    const connector = this.registry.getConnector(dataSource.providerKey);
    const ctx = this.registry.ctxFor(dataSource.project.workspaceId, connector, dataSource.projectId);

    let fetched = 0;
    let created = 0;
    let skipped = 0;
    let cursor: string | undefined;

    await this.prisma.dataSource.update({ where: { id: dataSourceId }, data: { status: "SYNCING" } });

    try {
      do {
        const page = await withPolicy(POLICIES.connector, connector.key, (signal) =>
          connector.fetchRecords({ ...ctx, signal }, dataSource.config, { limit: 100, cursor }),
        );
        fetched += page.records.length;

        for (const record of page.records) {
          const payloadHash = sha256(record.payload);
          const existing = await this.prisma.sourceRecord.findUnique({ where: { dataSourceId_payloadHash: { dataSourceId, payloadHash } } });
          if (existing) {
            skipped++;
            continue;
          }
          await this.prisma.sourceRecord.create({
            data: {
              dataSourceId,
              externalId: record.externalId ?? null,
              rawPayload: record.payload as never,
              payloadHash,
            },
          });
          created++;
        }
        cursor = page.nextCursor;
      } while (cursor);

      const normalizeResult = await this.normalizePending({ dataSourceId });

      await this.prisma.dataSource.update({
        where: { id: dataSourceId },
        data: { status: "SYNCED", lastSyncedAt: new Date(), lastError: null, recordCount: { increment: created } },
      });

      return {
        fetched,
        created,
        skipped,
        normalizationErrors: normalizeResult.normalizationErrors,
        possibleDuplicates: normalizeResult.possibleDuplicates,
        newCompanies: normalizeResult.newCompanies,
        mergedIntoExisting: normalizeResult.mergedIntoExisting,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown sync error";
      await this.prisma.dataSource.update({ where: { id: dataSourceId }, data: { status: "ERROR", lastError: message } });
      throw err;
    }
  }

  async normalizePending(
    scope: { dataSourceId?: string; projectId?: string },
  ): Promise<{ normalizationErrors: { externalId: string | null; error: string }[]; possibleDuplicates: number; newCompanies: number; mergedIntoExisting: number }> {
    const dataSources = scope.dataSourceId
      ? [await this.prisma.dataSource.findUniqueOrThrow({ where: { id: scope.dataSourceId }, include: { project: true } })]
      : await this.prisma.dataSource.findMany({ where: { projectId: scope.projectId, status: { not: "ARCHIVED" } }, include: { project: true } });

    const normalizationErrors: { externalId: string | null; error: string }[] = [];
    const affectedCompanyIds = new Set<string>();
    let possibleDuplicates = 0;
    let newCompanies = 0;
    let mergedIntoExisting = 0;

    for (const dataSource of dataSources) {
      const connector = this.registry.getConnector(dataSource.providerKey);
      const pending = await this.prisma.sourceRecord.findMany({ where: { dataSourceId: dataSource.id, normalizedCompanyId: null } });

      for (const record of pending) {
        try {
          const mapping = (dataSource.config as { mapping?: import("@prospect/shared").FieldMappingDto })?.mapping;
          const mapped = connector.mapToCanonical({ externalId: record.externalId ?? undefined, payload: record.rawPayload as Record<string, unknown> }, mapping ?? undefined);

          if (!mapped.canonical.identity?.name?.trim()) {
            throw new Error("mapped record has no identity.name — cannot create a company");
          }

          const { company, isNew } = await this.matcher.findOrCreate(dataSource.project.workspaceId, dataSource.projectId, {
            name: mapped.canonical.identity.name,
            domain: mapped.canonical.identity.domain,
            website: mapped.canonical.identity.website,
          });
          if (company.possibleDuplicate) possibleDuplicates++;
          if (isNew) newCompanies++;
          else mergedIntoExisting++;

          const normalizedAttributes = this.applyNormalizers(mapped.attributes);

          await this.attributeWriter.append(normalizedAttributes, {
            companyId: company.id,
            sourceType: "SOURCE",
            providerKey: dataSource.providerKey,
            sourceRecordId: record.id,
          });
          await this.personWriter.upsert(company.id, mapped.people, dataSource.providerKey);

          await this.prisma.sourceRecord.update({ where: { id: record.id }, data: { normalizedCompanyId: company.id, normalizationError: null } });
          affectedCompanyIds.add(company.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown normalization error";
          this.logger.warn(`normalization failed for source_record=${record.id}: ${message}`);
          await this.prisma.sourceRecord.update({ where: { id: record.id }, data: { normalizationError: message } });
          normalizationErrors.push({ externalId: record.externalId, error: message });
        }
      }
    }

    for (const companyId of affectedCompanyIds) {
      await this.resolver.resolveCompany(companyId);
    }

    return { normalizationErrors, possibleDuplicates, newCompanies, mergedIntoExisting };
  }

  resolveCompany(companyId: string): Promise<void> {
    return this.resolver.resolveCompany(companyId);
  }

  private applyNormalizers(attributes: NewAttribute[]): NewAttribute[] {
    const out: NewAttribute[] = [];
    for (const attr of attributes) {
      if (attr.field === "firmographics.industry" && typeof attr.value === "string") {
        const raw = attr.value;
        const normalized = this.normalizers.normalizeIndustry(raw);
        out.push({ ...attr, value: normalized ?? raw });

        out.push({ field: "firmographics.industryRaw" as unknown as NewAttribute["field"], value: raw, confidence: attr.confidence, observedAt: attr.observedAt });
        continue;
      }
      if (attr.field === "firmographics.country" && typeof attr.value === "string") {
        const normalized = this.normalizers.normalizeCountry(attr.value);
        out.push({ ...attr, value: normalized ?? attr.value });
        continue;
      }
      if (attr.field === "technographics.stack" && attr.value && typeof attr.value === "object") {
        const group = attr.value as { items: { key: string; raw: string; category?: string }[]; authoritative?: boolean; checkedAt?: string };
        const items = group.items.map((item) => ({ ...item, key: this.normalizers.normalizeTechnology(item.raw) ?? item.key }));
        out.push({ ...attr, value: { ...group, items } });
        continue;
      }
      out.push(attr);
    }
    return out;
  }
}
