import { Prisma } from "@prisma/client";
import { defaultProspectingDefinition, emptyWorkflowDefinition } from "@prospect/shared";
import { AppException, notFound } from "../../common/errors";
import { checksumOf } from "./definition-checksum";
import { ProjectDefinitionValidator } from "./project-definition-validator.service";
import { WorkflowsService } from "./workflows.service";

const ws = { id: "ws1", role: "OWNER" as const };
const otherWs = { id: "ws2", role: "OWNER" as const };

const uniqueViolation = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });

function makeWorkflow(overrides: Record<string, unknown> = {}) {
  const definition = (overrides.draftDefinition as object) ?? defaultProspectingDefinition();
  return {
    id: "wf1",
    projectId: "proj1",
    name: "Outbound",
    description: null,
    status: "ACTIVE",
    draftDefinition: definition,
    draftChecksum: checksumOf(definition),
    createdById: "user1",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
    ...overrides,
  };
}

function makeVersion(overrides: Record<string, unknown> = {}) {
  return { id: "ver1", workflowId: "wf1", version: 1, checksum: "abc", note: null, createdAt: new Date("2026-01-03"), ...overrides };
}

function setup(opts: { workflow?: ReturnType<typeof makeWorkflow> | null; validatorResult?: { valid: boolean; issues: unknown[] } } = {}) {
  const prisma = {
    workflow: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => (opts.workflow === undefined ? makeWorkflow() : opts.workflow)),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => makeWorkflow({ ...data, id: "new-wf" })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => makeWorkflow(data)),
    },
    workflowVersion: {
      findUnique: jest.fn(async (): Promise<ReturnType<typeof makeVersion> | null> => null),
      findFirst: jest.fn(async (): Promise<{ version: number } | null> => null),
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => makeVersion(data)),
    },
  };
  const projects = {
    findOneOrThrow: jest.fn(async (w: { id: string }, projectId: string) => {
      if (w.id !== "ws1" || projectId !== "proj1") throw notFound("Project");
      return { id: projectId, workspaceId: w.id };
    }),
  };
  const validator = { validate: jest.fn(async () => opts.validatorResult ?? { valid: true, issues: [] }) };
  const service = new WorkflowsService(prisma as never, projects as never, validator as never);
  return { prisma, projects, validator, service };
}

const codeOf = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as AppException).code;

describe("WorkflowsService tenancy", () => {
  it.each([
    ["list", (s: WorkflowsService) => s.list(otherWs, "proj1")],
    ["create", (s: WorkflowsService) => s.create(otherWs, "proj1", "u", { name: "x", template: "EMPTY" })],
    ["get", (s: WorkflowsService) => s.get(otherWs, "proj1", "wf1")],
    ["update", (s: WorkflowsService) => s.update(otherWs, "proj1", "wf1", { name: "x" })],
    ["archive", (s: WorkflowsService) => s.archive(otherWs, "proj1", "wf1")],
    ["validate", (s: WorkflowsService) => s.validate(otherWs, "proj1", "wf1", {})],
    ["publish", (s: WorkflowsService) => s.publish(otherWs, "proj1", "wf1", "u", {})],
    ["listVersions", (s: WorkflowsService) => s.listVersions(otherWs, "proj1", "wf1")],
  ])("%s rejects a project outside the caller's workspace and touches no workflow data", async (_name, call) => {
    const { prisma, service } = setup();
    expect(await codeOf(call(service))).toBe("NOT_FOUND");
    expect(prisma.workflow.findMany).not.toHaveBeenCalled();
    expect(prisma.workflow.findFirst).not.toHaveBeenCalled();
    expect(prisma.workflow.create).not.toHaveBeenCalled();
    expect(prisma.workflow.update).not.toHaveBeenCalled();
    expect(prisma.workflowVersion.create).not.toHaveBeenCalled();
  });

  it("looks workflows up by project, so a workflow id from another project is not found", async () => {
    const { prisma, service } = setup({ workflow: null });
    expect(await codeOf(service.get(ws, "proj1", "wf-from-elsewhere"))).toBe("NOT_FOUND");
    expect(prisma.workflow.findFirst).toHaveBeenCalledWith({ where: { id: "wf-from-elsewhere", projectId: "proj1" } });
  });
});

describe("WorkflowsService.create", () => {
  it("starts from an empty graph by default", async () => {
    const { prisma, service } = setup();
    await service.create(ws, "proj1", "user1", { name: "Blank", template: "EMPTY" });
    const data = prisma.workflow.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ projectId: "proj1", name: "Blank", createdById: "user1", draftDefinition: emptyWorkflowDefinition(), draftChecksum: checksumOf(emptyWorkflowDefinition()) });
  });

  it("can start from the default prospecting template", async () => {
    const { prisma, service } = setup();
    const detail = await service.create(ws, "proj1", "user1", { name: "Standard", template: "DEFAULT_PROSPECTING" });
    expect(prisma.workflow.create.mock.calls[0]![0].data.draftDefinition).toEqual(defaultProspectingDefinition());
    expect(detail.nodeCount).toBe(10);
    expect(detail.latestVersion).toBeNull();
  });

  it("reports a duplicate name through the database constraint", async () => {
    const { prisma, service } = setup();
    prisma.workflow.create.mockRejectedValueOnce(uniqueViolation());
    expect(await codeOf(service.create(ws, "proj1", "user1", { name: "Dup", template: "EMPTY" }))).toBe("WORKFLOW_NAME_TAKEN");
  });

  it("does not hide unexpected database errors", async () => {
    const { prisma, service } = setup();
    prisma.workflow.create.mockRejectedValueOnce(new Error("connection lost"));
    await expect(service.create(ws, "proj1", "user1", { name: "x", template: "EMPTY" })).rejects.toThrow("connection lost");
  });
});

describe("WorkflowsService.update", () => {
  it("saves an incomplete draft and refreshes its checksum", async () => {
    const { prisma, service } = setup();
    const draft = { schemaVersion: 1 as const, nodes: [{ id: "send", type: "SIMULATED_SEND" as const, position: { x: 0, y: 0 }, config: {} }], edges: [] };
    await service.update(ws, "proj1", "wf1", { definition: draft });
    expect(prisma.workflow.update).toHaveBeenCalledWith({ where: { id: "wf1" }, data: { draftDefinition: draft, draftChecksum: checksumOf(draft) } });
  });

  it("refuses to change an archived workflow", async () => {
    const { prisma, service } = setup({ workflow: makeWorkflow({ status: "ARCHIVED" }) });
    expect(await codeOf(service.update(ws, "proj1", "wf1", { name: "x" }))).toBe("WORKFLOW_ARCHIVED");
    expect(prisma.workflow.update).not.toHaveBeenCalled();
  });

  it("reports a rename that collides with another workflow", async () => {
    const { prisma, service } = setup();
    prisma.workflow.update.mockRejectedValueOnce(uniqueViolation());
    expect(await codeOf(service.update(ws, "proj1", "wf1", { name: "Taken" }))).toBe("WORKFLOW_NAME_TAKEN");
  });
});

describe("WorkflowsService.archive", () => {
  it("archives an active workflow and is a no-op the second time", async () => {
    const first = setup();
    await first.service.archive(ws, "proj1", "wf1");
    expect(first.prisma.workflow.update).toHaveBeenCalledWith({ where: { id: "wf1" }, data: { status: "ARCHIVED" } });

    const second = setup({ workflow: makeWorkflow({ status: "ARCHIVED" }) });
    await second.service.archive(ws, "proj1", "wf1");
    expect(second.prisma.workflow.update).not.toHaveBeenCalled();
  });
});

describe("WorkflowsService.validate", () => {
  it("validates the saved draft by default and a posted definition when given", async () => {
    const { validator, service } = setup();
    await service.validate(ws, "proj1", "wf1", {});
    expect(validator.validate).toHaveBeenLastCalledWith(ws, "proj1", defaultProspectingDefinition());

    const posted = emptyWorkflowDefinition();
    await service.validate(ws, "proj1", "wf1", { definition: posted });
    expect(validator.validate).toHaveBeenLastCalledWith(ws, "proj1", posted);
  });

  it("returns the issues it found", async () => {
    const issues = [{ code: "NODE_NO_INPUT", message: "no input", nodeId: "qualify" }];
    const { service } = setup({ validatorResult: { valid: false, issues } });
    expect(await service.validate(ws, "proj1", "wf1", {})).toEqual({ valid: false, issues });
  });
});

describe("WorkflowsService.publish", () => {
  it("refuses an invalid draft and reports every issue without creating a version", async () => {
    const issues = [
      { code: "DATA_SOURCE_COUNT", message: "needs one" },
      { code: "NODE_NO_INPUT", message: "no input", nodeId: "qualify" },
    ];
    const { prisma, service } = setup({ validatorResult: { valid: false, issues } });
    const err = (await service.publish(ws, "proj1", "wf1", "user1", {}).catch((e: unknown) => e)) as AppException;
    expect(err.code).toBe("WORKFLOW_INVALID");
    expect(err.details).toEqual(issues);
    expect(prisma.workflowVersion.create).not.toHaveBeenCalled();
  });

  it("refuses to publish an archived workflow", async () => {
    const { service } = setup({ workflow: makeWorkflow({ status: "ARCHIVED" }) });
    expect(await codeOf(service.publish(ws, "proj1", "wf1", "user1", {}))).toBe("WORKFLOW_ARCHIVED");
  });

  it("publishes version 1 with the checksum of the parsed definition", async () => {
    const { prisma, service } = setup();
    const result = await service.publish(ws, "proj1", "wf1", "user1", { note: "first" });
    const data = prisma.workflowVersion.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ workflowId: "wf1", version: 1, note: "first", createdById: "user1" });
    expect(data.checksum).toBe(checksumOf(data.definition));
    expect(result).toMatchObject({ version: 1, alreadyPublished: false });
  });

  it("numbers the next version after the latest", async () => {
    const { prisma, service } = setup();
    prisma.workflowVersion.findFirst.mockResolvedValue({ version: 4 });
    const result = await service.publish(ws, "proj1", "wf1", "user1", {});
    expect(prisma.workflowVersion.create.mock.calls[0]![0].data.version).toBe(5);
    expect(result.version).toBe(5);
  });

  it("returns the existing version instead of duplicating an unchanged draft", async () => {
    const { prisma, service } = setup();
    prisma.workflowVersion.findUnique.mockResolvedValue(makeVersion({ id: "ver-existing", version: 2 }));
    const result = await service.publish(ws, "proj1", "wf1", "user1", {});
    expect(result).toMatchObject({ id: "ver-existing", version: 2, alreadyPublished: true });
    expect(prisma.workflowVersion.create).not.toHaveBeenCalled();
  });

  it("retries with a fresh version number when another publish took the number first", async () => {
    const { prisma, service } = setup();
    prisma.workflowVersion.findFirst.mockResolvedValueOnce({ version: 1 }).mockResolvedValueOnce({ version: 2 });
    prisma.workflowVersion.create.mockRejectedValueOnce(uniqueViolation());
    const result = await service.publish(ws, "proj1", "wf1", "user1", {});
    expect(prisma.workflowVersion.create).toHaveBeenCalledTimes(2);
    expect(result.version).toBe(3);
  });

  it("treats a concurrent identical publish as already published", async () => {
    const { prisma, service } = setup();
    prisma.workflowVersion.create.mockRejectedValueOnce(uniqueViolation());
    prisma.workflowVersion.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(makeVersion({ id: "winner", version: 1 }));
    const result = await service.publish(ws, "proj1", "wf1", "user1", {});
    expect(result).toMatchObject({ id: "winner", alreadyPublished: true });
  });

  it("gives up after repeated collisions instead of looping forever", async () => {
    const { prisma, service } = setup();
    prisma.workflowVersion.create.mockRejectedValue(uniqueViolation());
    await expect(service.publish(ws, "proj1", "wf1", "user1", {})).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(prisma.workflowVersion.create).toHaveBeenCalledTimes(3);
  });
});

describe("ProjectDefinitionValidator", () => {
  const SOURCE = "3f1c2a4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b";
  const CAMPAIGN = "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";

  function make(sources: string[], campaigns: string[]) {
    const dataSources = { list: jest.fn(async () => sources.map((id) => ({ id }))) };
    const campaignService = { list: jest.fn(async () => campaigns.map((id) => ({ id }))) };
    return { dataSources, campaignService, validator: new ProjectDefinitionValidator(dataSources as never, campaignService as never) };
  }

  function withRefs() {
    const d = defaultProspectingDefinition();
    d.nodes.find((n) => n.id === "source")!.config = { dataSourceIds: [SOURCE], refresh: false };
    d.nodes.find((n) => n.id === "send")!.config = { campaignId: CAMPAIGN };
    return d;
  }

  it("accepts a definition whose referenced data source and campaign belong to the project", async () => {
    const { validator } = make([SOURCE], [CAMPAIGN]);
    expect(await validator.validate(ws, "proj1", withRefs())).toEqual({ valid: true, issues: [] });
  });

  it("flags a data source that is not in the project, including one from another project", async () => {
    const { validator } = make(["some-other-source"], [CAMPAIGN]);
    const result = await validator.validate(ws, "proj1", withRefs());
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "DATA_SOURCE_NOT_FOUND", nodeId: "source" }));
  });

  it("flags a campaign that is not in the project", async () => {
    const { validator } = make([SOURCE], []);
    const result = await validator.validate(ws, "proj1", withRefs());
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "CAMPAIGN_NOT_FOUND", nodeId: "send" }));
  });

  it("passes the caller's workspace to the services so their own tenancy checks apply", async () => {
    const { dataSources, campaignService, validator } = make([SOURCE], [CAMPAIGN]);
    await validator.validate(otherWs, "proj1", withRefs());
    expect(dataSources.list).toHaveBeenCalledWith(otherWs, "proj1", false);
    expect(campaignService.list).toHaveBeenCalledWith(otherWs, "proj1");
  });

  it("does not look anything up when the definition references nothing or is structurally invalid", async () => {
    const { dataSources, campaignService, validator } = make([], []);
    await validator.validate(ws, "proj1", defaultProspectingDefinition());
    await validator.validate(ws, "proj1", { nonsense: true });
    expect(dataSources.list).not.toHaveBeenCalled();
    expect(campaignService.list).not.toHaveBeenCalled();
  });

  it("keeps structural problems alongside reference problems", async () => {
    const { validator } = make([], [CAMPAIGN]);
    const d = withRefs();
    d.edges = d.edges.filter((e) => e.id !== "e2");
    const codes = (await validator.validate(ws, "proj1", d)).issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["NODE_NO_INPUT", "DATA_SOURCE_NOT_FOUND"]));
  });
});
