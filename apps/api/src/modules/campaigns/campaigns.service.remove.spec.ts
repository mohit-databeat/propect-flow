import { CampaignsService } from "./campaigns.service";
import { AppException } from "../../common/errors";

const ws = { id: "ws1", role: "OWNER" as const };

function makeProjectsStub() {
  return { findOneOrThrow: async () => ({ id: "proj1", workspaceId: "ws1" }) };
}

function makeCampaignRow() {
  return { id: "camp1", projectId: "proj1", name: "Q1", status: "DRAFT", outboundProviderKey: "simulated", senderConfig: {}, createdAt: new Date(), updatedAt: new Date() };
}

describe("CampaignsService.removeMessage", () => {
  it("detaches a not-yet-sent message from the campaign (campaignId -> null), leaving the draft itself intact", async () => {
    let updateData: Record<string, unknown> | undefined;
    const prisma = {
      campaign: { findFirst: async () => makeCampaignRow(), findFirstOrThrow: async () => ({ ...makeCampaignRow(), messages: [] }) },
      message: {
        findFirst: async () => ({ id: "msg1", sendStatus: "NOT_SENT" }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updateData = data;
          return {};
        },
      },
    };
    const service = new CampaignsService(prisma as never, makeProjectsStub() as never, {} as never);

    await service.removeMessage(ws, "proj1", "camp1", "msg1");

    expect(updateData).toEqual({ campaignId: null });
  });

  it("refuses to remove a message that was already sent — it's the campaign's send history", async () => {
    const prisma = {
      campaign: { findFirst: async () => makeCampaignRow() },
      message: { findFirst: async () => ({ id: "msg1", sendStatus: "SENT_SIMULATED" }) },
    };
    const service = new CampaignsService(prisma as never, makeProjectsStub() as never, {} as never);

    const err = await service.removeMessage(ws, "proj1", "camp1", "msg1").catch((e: AppException) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe("MESSAGE_ALREADY_SENT");
  });

  it("404s when the message isn't actually in this campaign", async () => {
    const prisma = { campaign: { findFirst: async () => makeCampaignRow() }, message: { findFirst: async () => null } };
    const service = new CampaignsService(prisma as never, makeProjectsStub() as never, {} as never);

    await expect(service.removeMessage(ws, "proj1", "camp1", "msg-not-here")).rejects.toBeInstanceOf(AppException);
  });
});

describe("CampaignsService.clearMessages", () => {
  it("detaches every not-yet-sent message but keeps already-sent ones attached", async () => {
    let updateManyWhere: unknown;
    const prisma = {
      campaign: { findFirst: async () => makeCampaignRow() },
      message: {
        findMany: async () => [
          { id: "m1", sendStatus: "NOT_SENT" },
          { id: "m2", sendStatus: "SENT_SIMULATED" },
          { id: "m3", sendStatus: "FAILED" },
        ],
        updateMany: async ({ where }: { where: unknown }) => {
          updateManyWhere = where;
          return { count: 2 };
        },
      },
    };
    const service = new CampaignsService(prisma as never, makeProjectsStub() as never, {} as never);

    const report = await service.clearMessages(ws, "proj1", "camp1");

    expect(report).toEqual({ removed: 2, kept: 1 });
    expect((updateManyWhere as { id: { in: string[] } }).id.in.sort()).toEqual(["m1", "m3"]);
  });

  it("is a no-op (no updateMany call) when every message is already sent", async () => {
    const updateMany = jest.fn();
    const prisma = { campaign: { findFirst: async () => makeCampaignRow() }, message: { findMany: async () => [{ id: "m1", sendStatus: "SENT" }], updateMany } };
    const service = new CampaignsService(prisma as never, makeProjectsStub() as never, {} as never);

    const report = await service.clearMessages(ws, "proj1", "camp1");

    expect(updateMany).not.toHaveBeenCalled();
    expect(report).toEqual({ removed: 0, kept: 1 });
  });
});
