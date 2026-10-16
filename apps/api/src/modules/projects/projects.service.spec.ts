import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ProjectsService } from "./projects.service";

const ws = { id: "ws1", role: "OWNER" as const };

interface FakeProject {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

function makeFakePrisma(seed: Omit<FakeProject, "createdAt" | "updatedAt">[] = []) {
  const now = new Date();
  const projects: FakeProject[] = seed.map((p) => ({ ...p, createdAt: now, updatedAt: now }));
  return {
    project: {
      findFirst: async ({ where }: { where: { workspaceId: string; id?: { not?: string }; name?: { equals: string; mode: string } } }) => {
        const nameLower = where.name?.equals.toLowerCase();
        return (
          projects.find(
            (p) =>
              p.workspaceId === where.workspaceId &&
              (where.id?.not === undefined || p.id !== where.id.not) &&
              (nameLower === undefined || p.name.toLowerCase() === nameLower),
          ) ?? null
        );
      },
      create: async ({ data }: { data: Omit<FakeProject, "id" | "createdAt" | "updatedAt"> }) => {
        if (projects.some((p) => p.workspaceId === data.workspaceId && p.name === data.name)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
        }
        const row: FakeProject = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...data };
        projects.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeProject> }) => {
        const row = projects.find((p) => p.id === where.id)!;
        if (data.name && projects.some((p) => p.id !== row.id && p.workspaceId === row.workspaceId && p.name === data.name)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
        }
        Object.assign(row, data);
        return row;
      },
      findMany: async ({ where }: { where: { workspaceId: string } }) => projects.filter((p) => p.workspaceId === where.workspaceId).map((p) => ({ ...p, icpProfiles: [], workflowRuns: [], _count: { dataSources: 0, companies: 0 } })),
      delete: async ({ where }: { where: { id: string } }) => {
        const idx = projects.findIndex((p) => p.id === where.id);
        const [row] = projects.splice(idx, 1);
        return row;
      },
    },
    prospect: { count: async () => 0 },
    __projects: projects,
  };
}

describe("ProjectsService", () => {
  it("rejects creating a project whose name already exists in the same workspace", async () => {
    const prisma = makeFakePrisma([{ id: "p1", workspaceId: "ws1", name: "CSV Test", description: null, status: "DRAFT" }]);
    const service = new ProjectsService(prisma as never);

    await expect(service.create(ws, { name: "CSV Test" })).rejects.toMatchObject({ code: "PROJECT_NAME_TAKEN" });
  });

  it("rejects a duplicate name that only differs by case", async () => {
    const prisma = makeFakePrisma([{ id: "p1", workspaceId: "ws1", name: "CSV Test", description: null, status: "DRAFT" }]);
    const service = new ProjectsService(prisma as never);

    await expect(service.create(ws, { name: "csv test" })).rejects.toMatchObject({ code: "PROJECT_NAME_TAKEN" });
  });

  it("allows the same project name in a different workspace", async () => {
    const prisma = makeFakePrisma([{ id: "p1", workspaceId: "other-ws", name: "CSV Test", description: null, status: "DRAFT" }]);
    const service = new ProjectsService(prisma as never);

    const created = await service.create(ws, { name: "CSV Test" });
    expect(created.name).toBe("CSV Test");
  });

  it("rejects renaming a project to a name another project in the same workspace already has", async () => {
    const prisma = makeFakePrisma([
      { id: "p1", workspaceId: "ws1", name: "Alpha", description: null, status: "DRAFT" },
      { id: "p2", workspaceId: "ws1", name: "Beta", description: null, status: "DRAFT" },
    ]);
    const service = new ProjectsService(prisma as never);

    await expect(service.update(ws, "p2", { name: "Alpha" })).rejects.toMatchObject({ code: "PROJECT_NAME_TAKEN" });
  });

  it("allows renaming a project to its own current name (no-op)", async () => {
    const prisma = makeFakePrisma([{ id: "p1", workspaceId: "ws1", name: "Alpha", description: null, status: "DRAFT" }]);
    const service = new ProjectsService(prisma as never);

    const updated = await service.update(ws, "p1", { name: "Alpha" });
    expect(updated.name).toBe("Alpha");
  });

  it("permanently deletes a project", async () => {
    const prisma = makeFakePrisma([{ id: "p1", workspaceId: "ws1", name: "Alpha", description: null, status: "DRAFT" }]);
    const service = new ProjectsService(prisma as never);

    await service.delete(ws, "p1");

    expect(prisma.__projects).toHaveLength(0);
  });

  it("refuses to delete a project belonging to a different workspace", async () => {
    const prisma = makeFakePrisma([{ id: "p1", workspaceId: "other-ws", name: "Alpha", description: null, status: "DRAFT" }]);
    const service = new ProjectsService(prisma as never);

    await expect(service.delete(ws, "p1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(prisma.__projects).toHaveLength(1);
  });

  it("frees up the name for reuse once a project with that name is deleted", async () => {
    const prisma = makeFakePrisma([{ id: "p1", workspaceId: "ws1", name: "Alpha", description: null, status: "DRAFT" }]);
    const service = new ProjectsService(prisma as never);

    await service.delete(ws, "p1");
    const created = await service.create(ws, { name: "Alpha" });

    expect(created.name).toBe("Alpha");
  });

  it("unarchive reverses archive, going back to DRAFT", async () => {
    const prisma = makeFakePrisma([{ id: "p1", workspaceId: "ws1", name: "Alpha", description: null, status: "ARCHIVED" }]);
    const service = new ProjectsService(prisma as never);

    await service.unarchive(ws, "p1");

    expect(prisma.__projects[0]!.status).toBe("DRAFT");
  });

  it("unarchive is a no-op on a project that isn't archived", async () => {
    const prisma = makeFakePrisma([{ id: "p1", workspaceId: "ws1", name: "Alpha", description: null, status: "ACTIVE" }]);
    const service = new ProjectsService(prisma as never);

    await service.unarchive(ws, "p1");

    expect(prisma.__projects[0]!.status).toBe("ACTIVE");
  });
});
