import { Injectable } from "@nestjs/common";
import type { CanonicalPerson } from "@prospect/shared";
import { personDedupeKey } from "@prospect/shared";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class PersonWriterService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(companyId: string, people: CanonicalPerson[], providerKey: string): Promise<void> {
    for (const person of people) {
      await this.upsertOne(companyId, person, providerKey);
    }
  }

  private async upsertOne(companyId: string, person: CanonicalPerson, providerKey: string): Promise<void> {
    const dedupeKey = personDedupeKey(person);
    const data = {
      fullName: person.fullName,
      title: person.title ?? null,
      seniority: person.seniority ?? null,
      department: person.department ?? null,
      email: person.email ?? null,
      phone: person.phone ?? null,
      linkedinUrl: person.linkedinUrl ?? null,
      providerKey,
    };

    const existingByKey = await this.prisma.person.findUnique({ where: { companyId_dedupeKey: { companyId, dedupeKey } } });
    if (existingByKey) {
      await this.prisma.person.update({ where: { id: existingByKey.id }, data });
      return;
    }

    if (person.email) {
      const nameOnlyKey = personDedupeKey({ fullName: person.fullName, title: person.title });
      const existingByName = nameOnlyKey !== dedupeKey ? await this.prisma.person.findUnique({ where: { companyId_dedupeKey: { companyId, dedupeKey: nameOnlyKey } } }) : null;
      if (existingByName) {
        await this.prisma.person.update({ where: { id: existingByName.id }, data: { ...data, dedupeKey } });
        return;
      }
    }

    await this.prisma.person.create({ data: { companyId, dedupeKey, ...data } });
  }
}
