import { CampaignsService } from "./campaigns.service";
import { AppException } from "../../common/errors";

const ws = { id: "ws1", role: "OWNER" as const };

function makeProjectsStub() {
  return { findOneOrThrow: async () => ({ id: "proj1", workspaceId: "ws1" }) };
}

function makeRegistryStub(overrides: Partial<{ available: boolean; configured: boolean }> = {}) {
  const available = overrides.available ?? true;
  const configured = overrides.configured ?? true;
  return {
    getOutbound: (key: string) => {
      if (!available) {
        throw new AppException(409 as never, "PROVIDER_UNAVAILABLE", `${key} is unavailable`);
      }
      return { key, available: true, send: jest.fn() };
    },
    ctxFor: () => {
      if (!configured) {
        throw new AppException(424 as never, "PROVIDER_NOT_CONFIGURED", "not configured");
      }
      return { workspaceId: "ws1", credentials: {}, logger: { debug() {}, info() {}, warn() {}, error() {} } };
    },
  };
}

function makeCampaignRow(overrides: Partial<{ id: string; status: string; outboundProviderKey: string }> = {}) {
  return {
    id: overrides.id ?? "camp1",
    projectId: "proj1",
    name: "Q1 Outreach",
    status: overrides.status ?? "DRAFT",
    outboundProviderKey: overrides.outboundProviderKey ?? "simulated",
    senderConfig: {},
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

describe("CampaignsService.create", () => {
  it("rejects creating a campaign against an unavailable (stub) outbound provider", async () => {
    const prisma = { workspace: { findUniqueOrThrow: async () => ({ settings: {} }) } };
    const service = new CampaignsService(prisma as never, makeProjectsStub() as never, makeRegistryStub({ available: false }) as never);

    const err = await service.create(ws, "proj1", { name: "Test", outboundProviderKey: "smtp" }).catch((e: AppException) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("rejects creating a campaign against an available but unconfigured provider", async () => {
    const prisma = { workspace: { findUniqueOrThrow: async () => ({ settings: {} }) } };
    const service = new CampaignsService(prisma as never, makeProjectsStub() as never, makeRegistryStub({ configured: false }) as never);

    const err = await service.create(ws, "proj1", { name: "Test" }).catch((e: AppException) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe("PROVIDER_NOT_CONFIGURED");
  });

  it("creates a campaign with the workspace default outbound provider when none is specified", async () => {
    let created: Record<string, unknown> | undefined;
    const prisma = {
      workspace: { findUniqueOrThrow: async () => ({ settings: { outboundProviderKey: "simulated" } }) },
      campaign: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created = data;
          return { ...makeCampaignRow(), ...data, messages: [] };
        },
      },
    };
    const service = new CampaignsService(prisma as never, makeProjectsStub() as never, makeRegistryStub() as never);

    const result = await service.create(ws, "proj1", { name: "Q1 Outreach" });

    expect(created).toMatchObject({ name: "Q1 Outreach", outboundProviderKey: "simulated" });
    expect(result.counts).toEqual({ total: 0, approved: 0, sent: 0, skipped: 0, failed: 0 });
  });
});

describe("CampaignsService.addMessages", () => {
  it("auto-adds every currently-eligible message when no messageIds are given", async () => {
    let updateManyWhere: unknown;
    const prisma = {
      campaign: { findFirst: async () => makeCampaignRow() },
      message: {
        findMany: async () => [{ id: "m1" }, { id: "m2" }],
        updateMany: async ({ where }: { where: unknown }) => {
          updateManyWhere = where;
          return { count: 2 };
        },
      },
    };
    const service = new CampaignsService(prisma as never, makeProjectsStub() as never, makeRegistryStub() as never);

    const report = await service.addMessages(ws, "proj1", "camp1", {});

    expect(report).toEqual({ added: 2, alreadyInCampaign: 0, skipped: 0, skippedMessages: [] });
    expect((updateManyWhere as { id: { in: string[] } }).id.in).toEqual(["m1", "m2"]);
  });

  it("skips explicitly-requested messages that are not eligible, with a reason, and still adds the eligible ones", async () => {
    const rows = [
      { id: "m1", campaignId: null, reviewStatus: "APPROVED", qaStatus: "PASS", sendStatus: "NOT_SENT", toAddress: "a@b.com", company: { name: "Acme" } },
      { id: "m2", campaignId: null, reviewStatus: "PENDING", qaStatus: "PENDING", sendStatus: "NOT_SENT", toAddress: null, company: { name: "Beta" } },
    ];
    const prisma = {
      campaign: { findFirst: async () => makeCampaignRow() },
      message: {
        findMany: async () => rows,
        updateMany: async () => ({ count: 1 }),
      },
    };
    const service = new CampaignsService(prisma as never, makeProjectsStub() as never, makeRegistryStub() as never);

    const report = await service.addMessages(ws, "proj1", "camp1", { messageIds: ["m1", "m2"] });

    expect(report.added).toBe(1);
    expect(report.skippedMessages).toEqual([{ messageId: "m2", companyName: "Beta", reason: "Not approved (review status: PENDING)" }]);
  });
});

describe("CampaignsService.send", () => {
  it("sends only sendable messages, skips the rest with reasons, and one send failure does not abort the campaign", async () => {
    const messages = [
      { id: "m1", reviewStatus: "APPROVED", qaStatus: "PASS", sendStatus: "NOT_SENT", toAddress: "a@b.com", subject: "Hi", body: "Body", company: { name: "Acme" } },
      { id: "m2", reviewStatus: "PENDING", qaStatus: "PENDING", sendStatus: "NOT_SENT", toAddress: "b@b.com", subject: "Hi", body: "Body", company: { name: "Beta" } },
      { id: "m3", reviewStatus: "APPROVED", qaStatus: "FAIL", sendStatus: "NOT_SENT", toAddress: "c@b.com", subject: "Hi", body: "Body", company: { name: "Gamma" } },
      { id: "m4", reviewStatus: "APPROVED", qaStatus: "WARN", sendStatus: "NOT_SENT", toAddress: "d@b.com", subject: "Hi", body: "Body", company: { name: "Delta" } },
    ];
    const updates: Record<string, unknown>[] = [];
    const prisma = {
      campaign: { findFirst: async () => makeCampaignRow(), update: async () => ({}) },
      message: {
        findMany: async () => messages,
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push({ id: where.id, ...data });
          return {};
        },
      },
    };
    let callCount = 0;
    const registry = {
      getOutbound: () => ({
        key: "simulated",
        available: true,
        send: async () => {
          callCount++;
          if (callCount === 1) throw new Error("simulated network blip");
          return { providerMessageId: "sim_x", status: "SENT_SIMULATED" as const };
        },
      }),
      ctxFor: () => ({ workspaceId: "ws1", credentials: {}, logger: { debug() {}, info() {}, warn() {}, error() {} } }),
    };
    const service = new CampaignsService(prisma as never, makeProjectsStub() as never, registry as never);

    const report = await service.send(ws, "proj1", "camp1");

    expect(report.total).toBe(4);
    expect(report.sent).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.skipped).toBe(2);
    expect(report.skippedMessages).toEqual([
      { messageId: "m2", companyName: "Beta", reason: "Not approved (review status: PENDING)" },
      { messageId: "m3", companyName: "Gamma", reason: "QA has not passed (QA status: FAIL)" },
    ]);
    expect(updates.find((u) => u.id === "m1")).toMatchObject({ sendStatus: "FAILED", sendError: "simulated network blip" });
    expect(updates.find((u) => u.id === "m4")).toMatchObject({ sendStatus: "SENT_SIMULATED", providerMessageId: "sim_x" });
  });

  it("never re-sends an already-sent message on a second send() call (idempotent retry)", async () => {
    const messages = [{ id: "m1", reviewStatus: "APPROVED", qaStatus: "PASS", sendStatus: "SENT_SIMULATED", toAddress: "a@b.com", subject: "Hi", body: "Body", company: { name: "Acme" } }];
    const send = jest.fn();
    const prisma = {
      campaign: { findFirst: async () => makeCampaignRow(), update: async () => ({}) },
      message: { findMany: async () => messages, update: async () => ({}) },
    };
    const registry = { getOutbound: () => ({ key: "simulated", available: true, send }), ctxFor: () => ({ workspaceId: "ws1", credentials: {}, logger: { debug() {}, info() {}, warn() {}, error() {} } }) };
    const service = new CampaignsService(prisma as never, makeProjectsStub() as never, registry as never);

    const report = await service.send(ws, "proj1", "camp1");

    expect(send).not.toHaveBeenCalled();
    expect(report).toMatchObject({ total: 1, sent: 0, failed: 0, skipped: 1 });
    expect(report.skippedMessages[0]).toMatchObject({ reason: expect.stringContaining("Already") });
  });
});
