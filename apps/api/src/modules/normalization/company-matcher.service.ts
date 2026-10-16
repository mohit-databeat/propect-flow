import { Injectable } from "@nestjs/common";
import type { Company } from "@prisma/client";
import { normalizeName } from "@prospect/shared";
import { PrismaService } from "../../prisma/prisma.service";

export interface MatchIdentity {
  name: string;
  domain?: string | undefined;
  website?: string | undefined;
}

export interface MatchResult {
  company: Company;

  isNew: boolean;
}

@Injectable()
export class CompanyMatcherService {
  constructor(private readonly prisma: PrismaService) {}

  async findOrCreate(workspaceId: string, projectId: string, identity: MatchIdentity): Promise<MatchResult> {
    if (identity.domain) {
      const byDomain = await this.prisma.company.findFirst({ where: { projectId, domain: identity.domain } });
      if (byDomain) return { company: byDomain, isNew: false };
      const company = await this.prisma.company.create({
        data: { workspaceId, projectId, name: identity.name, domain: identity.domain, website: identity.website ?? null },
      });
      return { company, isNew: true };
    }

    const normalized = normalizeName(identity.name);
    const candidates = await this.prisma.company.findMany({ where: { projectId, domain: null } });
    const matches = candidates.filter((c) => normalizeName(c.name) === normalized);

    if (matches.length === 1) return { company: matches[0]!, isNew: false };

    const company = await this.prisma.company.create({
      data: {
        workspaceId,
        projectId,
        name: identity.name,
        website: identity.website ?? null,
        possibleDuplicate: matches.length > 1,
      },
    });
    return { company, isNew: true };
  }
}
