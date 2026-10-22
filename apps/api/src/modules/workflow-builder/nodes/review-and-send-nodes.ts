import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { systemWorkspace } from "../../workflow/operations/run-control";
import { CampaignsService } from "../../campaigns/campaigns.service";
import type { NodeContext, NodeHandler, NodeResult } from "../engine/node-handler.interface";

interface ReviewCounts {
  withDraft: number;
  pendingReview: number;
  approved: number;
  rejected: number;
  approvedProspectIds: string[];
  rejectedProspectIds: string[];
}

@Injectable()
export class HumanApprovalNode implements NodeHandler<"HUMAN_APPROVAL"> {
  readonly type = "HUMAN_APPROVAL" as const;

  constructor(private readonly prisma: PrismaService) {}

  async run(ctx: NodeContext<"HUMAN_APPROVAL">): Promise<NodeResult> {
    const counts = await this.count(ctx);
    if (counts.withDraft === 0) {
      return {
        kind: "done",
        outputs: { approved: [], rejected: ctx.input },
        summary: { total: ctx.input.length, withDraft: 0 },
        skipped: true,
        skipReason: "None of these prospects has a drafted email to review",
      };
    }
    return { kind: "wait", summary: this.summaryOf(ctx, counts) };
  }

  async resumeBlocker(ctx: NodeContext<"HUMAN_APPROVAL">): Promise<string | null> {
    if (!ctx.node.config.requireAllReviewed) return null;
    const counts = await this.count(ctx);
    return counts.pendingReview > 0 ? `${counts.pendingReview} email(s) still need a decision. Approve or reject them first.` : null;
  }

  async resume(ctx: NodeContext<"HUMAN_APPROVAL">): Promise<NodeResult> {
    const counts = await this.count(ctx);
    return {
      kind: "done",
      outputs: { approved: counts.approvedProspectIds, rejected: counts.rejectedProspectIds },
      summary: this.summaryOf(ctx, counts),
    };
  }

  private summaryOf(ctx: NodeContext<"HUMAN_APPROVAL">, c: ReviewCounts): Record<string, unknown> {
    return { total: ctx.input.length, withDraft: c.withDraft, pendingReview: c.pendingReview, approved: c.approved, rejected: c.rejected };
  }

  private async count(ctx: NodeContext<"HUMAN_APPROVAL">): Promise<ReviewCounts> {
    const rows = await this.prisma.message.findMany({
      where: { projectId: ctx.run.projectId, prospectId: { in: ctx.input } },
      select: { prospectId: true, reviewStatus: true },
      orderBy: { createdAt: "desc" },
    });
    const latest = new Map<string, string>();
    for (const r of rows) if (r.prospectId && !latest.has(r.prospectId)) latest.set(r.prospectId, r.reviewStatus);

    const approvedProspectIds = ctx.input.filter((id) => latest.get(id) === "APPROVED");
    const rejectedProspectIds = ctx.input.filter((id) => latest.get(id) !== "APPROVED");
    const pendingReview = [...latest.values()].filter((s) => s === "PENDING" || s === "EDITED").length;
    return {
      withDraft: latest.size,
      pendingReview,
      approved: approvedProspectIds.length,
      rejected: rejectedProspectIds.length,
      approvedProspectIds,
      rejectedProspectIds,
    };
  }
}

@Injectable()
export class SimulatedSendNode implements NodeHandler<"SIMULATED_SEND"> {
  readonly type = "SIMULATED_SEND" as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
  ) {}

  async run(ctx: NodeContext<"SIMULATED_SEND">): Promise<NodeResult> {
    const ws = systemWorkspace(ctx.workspaceId);
    const projectId = ctx.run.projectId;

    const messages = await this.prisma.message.findMany({
      where: { projectId, prospectId: { in: ctx.input }, reviewStatus: "APPROVED", sendStatus: "NOT_SENT" },
      select: { id: true },
    });
    if (messages.length === 0) {
      return { kind: "done", outputs: {}, summary: { approved: ctx.input.length, eligible: 0 }, skipped: true, skipReason: "No approved email is waiting to be sent" };
    }

    const campaign = await this.resolveCampaign(ctx);
    const added = await this.campaigns.addMessages(ws, projectId, campaign.id, { messageIds: messages.map((m) => m.id) });
    await ctx.log("info", `Added ${added.added} email(s) to campaign ${campaign.id}`);
    const sent = await this.campaigns.send(ws, projectId, campaign.id);
    if (sent.failed > 0) await ctx.log("warn", `${sent.failed} email(s) failed to send`);

    return {
      kind: "done",
      outputs: {},
      summary: {
        campaignId: campaign.id,
        eligible: messages.length,
        added: added.added,
        alreadyInCampaign: added.alreadyInCampaign,
        sent: sent.sent,
        skipped: sent.skipped,
        failed: sent.failed,
      },
    };
  }

  private async resolveCampaign(ctx: NodeContext<"SIMULATED_SEND">): Promise<{ id: string }> {
    const ws = systemWorkspace(ctx.workspaceId);
    const projectId = ctx.run.projectId;
    const { campaignId, campaignName } = ctx.node.config;

    if (campaignId) {
      const existing = await this.campaigns.get(ws, projectId, campaignId);
      this.assertSimulated(existing.outboundProviderKey);
      return existing;
    }

    const name = `${campaignName} (run ${ctx.run.id.slice(0, 8)})`;
    const found = (await this.campaigns.list(ws, projectId)).find((c) => c.name === name);
    if (found) {
      this.assertSimulated(found.outboundProviderKey);
      return found;
    }
    return this.campaigns.create(ws, projectId, { name, outboundProviderKey: "simulated" });
  }

  private assertSimulated(providerKey: string): void {
    if (providerKey !== "simulated") {
      throw new Error(`This campaign uses the "${providerKey}" provider. Workflows can only send through the simulated provider.`);
    }
  }
}
