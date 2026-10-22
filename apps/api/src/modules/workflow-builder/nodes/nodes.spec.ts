import { WorkflowDefinition, defaultProspectingDefinition } from "@prospect/shared";
import { ConditionNode } from "./prospect-nodes";
import { HumanApprovalNode, SimulatedSendNode } from "./review-and-send-nodes";
import { DataSourceNode, NormalizeNode } from "./source-nodes";

const def = WorkflowDefinition.parse(defaultProspectingDefinition());
const run = { id: "abcdef1234567890", projectId: "proj1", icpProfileId: "icp1" };

function ctx(nodeId: string, input: string[], definition = def): never {
  const logs: string[] = [];
  const c = {
    run,
    workspaceId: "ws1",
    nodeRunId: "nr1",
    attempt: 1,
    node: definition.nodes.find((n) => n.id === nodeId)!,
    definition,
    input,
    budget: { used: 0, max: 10 },
    log: async (_level: string, message: string) => void logs.push(message),
  };
  return Object.assign(c, { logs }) as never;
}

describe("ConditionNode", () => {
  function setup(prospects: object[], messages: object[] = []) {
    const prisma = { prospect: { findMany: jest.fn(async () => prospects) }, message: { findMany: jest.fn(async () => messages) } };
    return { prisma, node: new ConditionNode(prisma as never) };
  }

  it("splits prospects by whether they have missing fields, reading the saved summary", async () => {
    const { node, prisma } = setup([
      { id: "p1", status: "NEEDS_REVIEW", score: 50, coverage: 40, summary: { missingFields: ["firmographics.employeeCount"] } },
      { id: "p2", status: "QUALIFIED", score: 90, coverage: 100, summary: { missingFields: [] } },
      { id: "p3", status: "QUALIFIED", score: 80, coverage: 90, summary: {} },
    ]);
    const result = await node.run(ctx("missing", ["p1", "p2", "p3"]));
    expect(result).toMatchObject({ kind: "done", outputs: { true: ["p1"], false: ["p2", "p3"] }, summary: { evaluated: 3, true: 1, false: 2, notFound: 0 } });
    expect(prisma.prospect.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workflowRunId: "abcdef1234567890", id: { in: ["p1", "p2", "p3"] } } }));
  });

  it("only looks at prospects of this run, drops unknown ids, and reports them", async () => {
    const { node } = setup([{ id: "p1", status: "QUALIFIED", score: 1, coverage: 1, summary: {} }]);
    const c = ctx("missing", ["p1", "from-another-run"]);
    const result = await node.run(c);
    expect(result).toMatchObject({ outputs: { true: [], false: ["p1"] }, summary: { notFound: 1 } });
    expect((c as never as { logs: string[] }).logs[0]).toContain("1 item(s) were not found");
  });

  it("uses the newest email's QA status for qaStatus rules", async () => {
    const custom = WorkflowDefinition.parse({
      ...defaultProspectingDefinition(),
      nodes: defaultProspectingDefinition().nodes.map((n) => (n.id === "missing" ? { ...n, config: { field: "qaStatus", operator: "EQ", value: "PASS" } } : n)),
    });
    const { node } = setup(
      [
        { id: "p1", status: "QUALIFIED", score: 1, coverage: 1, summary: {} },
        { id: "p2", status: "QUALIFIED", score: 1, coverage: 1, summary: {} },
      ],
      [
        { prospectId: "p1", qaStatus: "PASS" },
        { prospectId: "p1", qaStatus: "FAIL" },
      ],
    );
    const result = await node.run(ctx("missing", ["p1", "p2"], custom));
    expect(result).toMatchObject({ outputs: { true: ["p1"], false: ["p2"] } });
  });
});

describe("HumanApprovalNode", () => {
  function setup(messages: { prospectId: string; reviewStatus: string }[]) {
    const findMany = jest.fn(async () => messages);
    return { findMany, node: new HumanApprovalNode({ message: { findMany } } as never) };
  }

  it("pauses when drafted emails exist and reports how many still need review", async () => {
    const { node } = setup([
      { prospectId: "p1", reviewStatus: "PENDING" },
      { prospectId: "p2", reviewStatus: "APPROVED" },
      { prospectId: "p3", reviewStatus: "EDITED" },
    ]);
    const result = await node.run(ctx("approval", ["p1", "p2", "p3", "p4"]));
    expect(result).toEqual({ kind: "wait", summary: { total: 4, withDraft: 3, pendingReview: 2, approved: 1, rejected: 3 } });
  });

  it("does not wait forever when no prospect has an email: everything leaves through Rejected", async () => {
    const { node } = setup([]);
    const result = await node.run(ctx("approval", ["p1", "p2"]));
    expect(result).toMatchObject({ kind: "done", skipped: true, outputs: { approved: [], rejected: ["p1", "p2"] } });
  });

  it("blocks resume while emails are undecided, unless the node allows partial review", async () => {
    const strict = setup([{ prospectId: "p1", reviewStatus: "PENDING" }, { prospectId: "p2", reviewStatus: "APPROVED" }]);
    expect(await strict.node.resumeBlocker(ctx("approval", ["p1", "p2"]))).toContain("1 email(s) still need a decision");

    const lenientDef = WorkflowDefinition.parse({
      ...defaultProspectingDefinition(),
      nodes: defaultProspectingDefinition().nodes.map((n) => (n.id === "approval" ? { ...n, config: { requireAllReviewed: false } } : n)),
    });
    const lenient = setup([{ prospectId: "p1", reviewStatus: "PENDING" }]);
    expect(await lenient.node.resumeBlocker(ctx("approval", ["p1"], lenientDef))).toBeNull();
  });

  it("allows resume once everything has a decision", async () => {
    const { node } = setup([{ prospectId: "p1", reviewStatus: "APPROVED" }, { prospectId: "p2", reviewStatus: "REJECTED" }]);
    expect(await node.resumeBlocker(ctx("approval", ["p1", "p2"]))).toBeNull();
  });

  it("sends only approved prospects on, and the rest (rejected, unreviewed, no email) to Rejected", async () => {
    const { node, findMany } = setup([
      { prospectId: "p1", reviewStatus: "APPROVED" },
      { prospectId: "p2", reviewStatus: "REJECTED" },
      { prospectId: "p3", reviewStatus: "PENDING" },
    ]);
    const result = await node.resume(ctx("approval", ["p1", "p2", "p3", "p4"]));
    expect(result).toMatchObject({ kind: "done", outputs: { approved: ["p1"], rejected: ["p2", "p3", "p4"] } });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "proj1", prospectId: { in: ["p1", "p2", "p3", "p4"] } } }));
  });

  it("uses the newest email when a prospect has been redrafted", async () => {
    const { node } = setup([
      { prospectId: "p1", reviewStatus: "PENDING" },
      { prospectId: "p1", reviewStatus: "APPROVED" },
    ]);
    const result = await node.resume(ctx("approval", ["p1"]));
    expect(result).toMatchObject({ outputs: { approved: [], rejected: ["p1"] } });
  });
});

describe("SimulatedSendNode", () => {
  const sendReport = { total: 2, sent: 2, skipped: 0, failed: 0, skippedMessages: [] };

  function setup(opts: { messages?: { id: string }[]; campaigns?: { id: string; name: string; outboundProviderKey: string }[]; existing?: { id: string; outboundProviderKey: string } } = {}) {
    const prisma = { message: { findMany: jest.fn(async () => opts.messages ?? [{ id: "m1" }, { id: "m2" }]) } };
    const campaigns = {
      get: jest.fn(async () => opts.existing ?? { id: "camp-existing", outboundProviderKey: "simulated" }),
      list: jest.fn(async () => opts.campaigns ?? []),
      create: jest.fn(async (_ws: unknown, _p: string, dto: { name: string }) => ({ id: "camp-new", name: dto.name, outboundProviderKey: "simulated" })),
      addMessages: jest.fn(async () => ({ added: 2, alreadyInCampaign: 0, skipped: 0, skippedMessages: [] })),
      send: jest.fn(async () => sendReport),
    };
    return { prisma, campaigns, node: new SimulatedSendNode(prisma as never, campaigns as never) };
  }

  it("never calls the campaign with an empty list, which would attach every eligible email in the project", async () => {
    const { node, campaigns } = setup({ messages: [] });
    const result = await node.run(ctx("send", ["p1"]));
    expect(result).toMatchObject({ kind: "done", skipped: true });
    expect(campaigns.addMessages).not.toHaveBeenCalled();
    expect(campaigns.send).not.toHaveBeenCalled();
    expect(campaigns.create).not.toHaveBeenCalled();
  });

  it("only picks approved, unsent emails of the prospects that reached it", async () => {
    const { node, prisma } = setup();
    await node.run(ctx("send", ["p1", "p2"]));
    expect(prisma.message.findMany).toHaveBeenCalledWith({
      where: { projectId: "proj1", prospectId: { in: ["p1", "p2"] }, reviewStatus: "APPROVED", sendStatus: "NOT_SENT" },
      select: { id: true },
    });
  });

  it("creates a simulated campaign named for this run, attaches exactly those emails, and sends", async () => {
    const { node, campaigns } = setup();
    const result = await node.run(ctx("send", ["p1", "p2"]));

    expect(campaigns.create).toHaveBeenCalledWith({ id: "ws1", role: "OWNER" }, "proj1", { name: "Workflow campaign (run abcdef12)", outboundProviderKey: "simulated" });
    expect(campaigns.addMessages).toHaveBeenCalledWith({ id: "ws1", role: "OWNER" }, "proj1", "camp-new", { messageIds: ["m1", "m2"] });
    expect(campaigns.send).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ kind: "done", outputs: {}, summary: { campaignId: "camp-new", eligible: 2, added: 2, sent: 2, failed: 0 } });
  });

  it("reuses this run's campaign on retry instead of creating a second one", async () => {
    const { node, campaigns } = setup({ campaigns: [{ id: "camp-prev", name: "Workflow campaign (run abcdef12)", outboundProviderKey: "simulated" }] });
    await node.run(ctx("send", ["p1"]));
    expect(campaigns.create).not.toHaveBeenCalled();
    expect(campaigns.addMessages).toHaveBeenCalledWith(expect.anything(), "proj1", "camp-prev", expect.anything());
  });

  it("refuses a campaign that would send through a real provider", async () => {
    const withId = WorkflowDefinition.parse({
      ...defaultProspectingDefinition(),
      nodes: defaultProspectingDefinition().nodes.map((n) => (n.id === "send" ? { ...n, config: { campaignId: "3f1c2a4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b" } } : n)),
    });
    const { node, campaigns } = setup({ existing: { id: "camp-real", outboundProviderKey: "smtp" } });
    await expect(node.run(ctx("send", ["p1"], withId))).rejects.toThrow('"smtp" provider');
    expect(campaigns.addMessages).not.toHaveBeenCalled();
    expect(campaigns.send).not.toHaveBeenCalled();
  });

  it("uses a chosen existing campaign when it is simulated", async () => {
    const withId = WorkflowDefinition.parse({
      ...defaultProspectingDefinition(),
      nodes: defaultProspectingDefinition().nodes.map((n) => (n.id === "send" ? { ...n, config: { campaignId: "3f1c2a4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b" } } : n)),
    });
    const { node, campaigns } = setup();
    await node.run(ctx("send", ["p1"], withId));
    expect(campaigns.get).toHaveBeenCalledWith({ id: "ws1", role: "OWNER" }, "proj1", "3f1c2a4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b");
    expect(campaigns.create).not.toHaveBeenCalled();
    expect(campaigns.addMessages).toHaveBeenCalledWith(expect.anything(), "proj1", "camp-existing", { messageIds: ["m1", "m2"] });
  });
});

describe("source nodes", () => {
  it("DataSourceNode fails clearly when every selected source is gone", async () => {
    const withSource = WorkflowDefinition.parse({
      ...defaultProspectingDefinition(),
      nodes: defaultProspectingDefinition().nodes.map((n) => (n.id === "source" ? { ...n, config: { dataSourceIds: ["3f1c2a4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b"], refresh: false } } : n)),
    });
    const prisma = { dataSource: { findMany: jest.fn(async () => []) }, company: { findMany: jest.fn(async () => []) } };
    const node = new DataSourceNode(prisma as never, {} as never);
    await expect(node.run(ctx("source", [], withSource))).rejects.toThrow("None of the selected data sources are available");
    expect(prisma.company.findMany).not.toHaveBeenCalled();
  });

  it("DataSourceNode outputs the companies of the project's sources, scoped to the project", async () => {
    const prisma = { dataSource: { findMany: jest.fn(async () => []) }, company: { findMany: jest.fn(async () => [{ id: "c1" }, { id: "c2" }]) } };
    const node = new DataSourceNode(prisma as never, {} as never);
    const result = await node.run(ctx("source", []));
    expect(result).toMatchObject({ kind: "done", outputs: { out: ["c1", "c2"] }, summary: { companies: 2, refresh: false } });
    const where = (prisma.company.findMany.mock.calls[0] as unknown as [{ where: { projectId: string } }])[0].where;
    expect(where.projectId).toBe("proj1");
  });

  it("NormalizeNode runs on empty input, scoped to the Data Source node's sources", async () => {
    const SRC = "3f1c2a4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b";
    const withSource = WorkflowDefinition.parse({
      ...defaultProspectingDefinition(),
      nodes: defaultProspectingDefinition().nodes.map((n) => (n.id === "source" ? { ...n, config: { dataSourceIds: [SRC], refresh: false } } : n)),
    });
    const prisma = { dataSource: { findMany: jest.fn(async () => [{ id: SRC }]) }, company: { findMany: jest.fn(async () => [{ id: "c1" }]) } };
    const normalizePending = jest.fn(async () => ({ normalizationErrors: [], possibleDuplicates: 0, newCompanies: 1, mergedIntoExisting: 0 }));
    const node = new NormalizeNode(prisma as never, { normalizePending } as never);

    expect(node.runsOnEmptyInput).toBe(true);
    const result = await node.run(ctx("normalize", [], withSource));
    expect(normalizePending).toHaveBeenCalledWith({ dataSourceId: SRC });
    expect(result).toMatchObject({ outputs: { out: ["c1"] }, summary: { newCompanies: 1, companies: 1 } });
  });
});
