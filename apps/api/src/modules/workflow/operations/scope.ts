import type { PrismaService } from "../../../prisma/prisma.service";

export async function verifiedDataSourceIds(prisma: Pick<PrismaService, "dataSource">, projectId: string, requestedIds: readonly string[]): Promise<string[]> {
  if (requestedIds.length === 0) return [];
  const rows = await prisma.dataSource.findMany({
    where: { id: { in: [...requestedIds] }, projectId, status: { not: "ARCHIVED" } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function companyIdsForSources(prisma: Pick<PrismaService, "company">, projectId: string, dataSourceIds: readonly string[]): Promise<string[]> {
  const rows = await prisma.company.findMany({
    where: {
      projectId,
      sourceRecords: {
        some: {
          dataSource: { projectId, status: { not: "ARCHIVED" }, ...(dataSourceIds.length > 0 ? { id: { in: [...dataSourceIds] } } : {}) },
        },
      },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.id);
}
