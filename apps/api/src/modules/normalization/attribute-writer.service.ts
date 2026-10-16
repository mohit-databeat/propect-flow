import { Injectable } from "@nestjs/common";
import type { AttributeSourceType, Prisma } from "@prisma/client";
import type { NewAttribute } from "@prospect/shared";
import { PrismaService } from "../../prisma/prisma.service";

export interface WriteAttributesOptions {
  companyId: string;
  sourceType: AttributeSourceType;
  providerKey: string;
  sourceRecordId?: string;
  enrichmentRunId?: string;
}

@Injectable()
export class AttributeWriterService {
  constructor(private readonly prisma: PrismaService) {}

  async append(attributes: NewAttribute[], opts: WriteAttributesOptions): Promise<void> {
    if (attributes.length === 0) return;
    const now = new Date();
    await this.prisma.companyAttribute.createMany({
      data: attributes.map((a) => ({
        companyId: opts.companyId,
        field: a.field,
        value: a.value as Prisma.InputJsonValue,
        sourceType: opts.sourceType,
        providerKey: opts.providerKey,
        sourceRecordId: opts.sourceRecordId ?? null,
        enrichmentRunId: opts.enrichmentRunId ?? null,
        confidence: Math.max(0, Math.min(100, Math.round(a.confidence))),
        observedAt: a.observedAt ? new Date(a.observedAt) : now,
      })),
    });
  }
}
