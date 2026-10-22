import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { ProviderRegistryService } from "../../../providers/provider-registry.service";
import { EnrichmentService } from "../../enrichment/enrichment.service";
import { MessagesService } from "../../messages/messages.service";
import { QualificationService } from "../../qualification/qualification.service";
import { enrichOperation } from "../../workflow/operations/enrich.operation";
import { generateEmailOperation } from "../../workflow/operations/generate-email.operation";
import { qaOperation } from "../../workflow/operations/qa.operation";
import { qualifyOperation } from "../../workflow/operations/qualify.operation";
import { requalifyOperation } from "../../workflow/operations/requalify.operation";
import { splitByCondition, type ProspectFacts } from "../engine/condition-evaluator";
import type { NodeContext, NodeHandler, NodeResult } from "../engine/node-handler.interface";

@Injectable()
export class QualifyNode implements NodeHandler<"QUALIFY"> {
  readonly type = "QUALIFY" as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly qualification: QualificationService,
  ) {}

  async run(ctx: NodeContext<"QUALIFY">): Promise<NodeResult> {
    const outcome = await qualifyOperation({ prisma: this.prisma, qualification: this.qualification }, ctx.run, ctx.input);
    return { kind: "done", outputs: { out: outcome.itemIds }, summary: outcome.summary };
  }
}

@Injectable()
export class ConditionNode implements NodeHandler<"CONDITION"> {
  readonly type = "CONDITION" as const;

  constructor(private readonly prisma: PrismaService) {}

  async run(ctx: NodeContext<"CONDITION">): Promise<NodeResult> {
    const prospects = await this.prisma.prospect.findMany({
      where: { workflowRunId: ctx.run.id, id: { in: ctx.input } },
      select: { id: true, status: true, score: true, coverage: true, summary: true },
    });
    const messages = await this.prisma.message.findMany({
      where: { projectId: ctx.run.projectId, prospectId: { in: prospects.map((p) => p.id) } },
      select: { prospectId: true, qaStatus: true },
      orderBy: { createdAt: "desc" },
    });
    const qaByProspect = new Map<string, string>();
    for (const m of messages) if (m.prospectId && !qaByProspect.has(m.prospectId)) qaByProspect.set(m.prospectId, m.qaStatus);

    const items = prospects.map((p) => {
      const summary = (p.summary ?? {}) as { missingFields?: string[]; requiredFails?: string[] };
      const facts: ProspectFacts = {
        status: p.status,
        score: p.score,
        coverage: p.coverage,
        missingFields: summary.missingFields ?? [],
        requiredFails: summary.requiredFails ?? [],
        qaStatus: qaByProspect.get(p.id) ?? null,
      };
      return { id: p.id, facts };
    });

    const branches = splitByCondition(ctx.node.config, items);
    const notFound = ctx.input.length - prospects.length;
    if (notFound > 0) await ctx.log("warn", `${notFound} item(s) were not found in this run and were dropped`);
    return { kind: "done", outputs: branches, summary: { evaluated: items.length, true: branches.true.length, false: branches.false.length, notFound } };
  }
}

@Injectable()
export class EnrichNode implements NodeHandler<"ENRICH"> {
  readonly type = "ENRICH" as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistryService,
    private readonly enrichment: EnrichmentService,
  ) {}

  async run(ctx: NodeContext<"ENRICH">): Promise<NodeResult> {
    const outcome = await enrichOperation({ prisma: this.prisma, registry: this.registry, enrichment: this.enrichment }, ctx.run, ctx.input);
    return { kind: "done", outputs: { out: outcome.itemIds }, summary: outcome.summary, skipped: outcome.skipped, skipReason: outcome.skipReason };
  }
}

@Injectable()
export class RequalifyNode implements NodeHandler<"REQUALIFY"> {
  readonly type = "REQUALIFY" as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly qualification: QualificationService,
  ) {}

  async run(ctx: NodeContext<"REQUALIFY">): Promise<NodeResult> {
    const before = ctx.budget.used;
    const outcome = await requalifyOperation({ prisma: this.prisma, qualification: this.qualification }, ctx.run, ctx.input, ctx.budget);
    return {
      kind: "done",
      outputs: { out: outcome.itemIds },
      summary: outcome.summary,
      skipped: outcome.skipped,
      skipReason: outcome.skipReason,
      llmUnits: ctx.budget.used - before,
    };
  }
}

@Injectable()
export class GenerateEmailNode implements NodeHandler<"GENERATE_EMAIL"> {
  readonly type = "GENERATE_EMAIL" as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
  ) {}

  async run(ctx: NodeContext<"GENERATE_EMAIL">): Promise<NodeResult> {
    const cap = Math.max(0, ctx.budget.max - ctx.budget.used);
    const outcome = await generateEmailOperation({ prisma: this.prisma, messages: this.messages }, ctx.run, { prospectIds: ctx.input, cap, adoptExisting: true });
    const drafted = typeof outcome.summary.drafted === "number" ? outcome.summary.drafted : 0;
    return { kind: "done", outputs: { out: outcome.itemIds }, summary: outcome.summary, skipped: outcome.skipped, skipReason: outcome.skipReason, llmUnits: drafted };
  }
}

@Injectable()
export class AiQaNode implements NodeHandler<"AI_QA"> {
  readonly type = "AI_QA" as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
  ) {}

  async run(ctx: NodeContext<"AI_QA">): Promise<NodeResult> {
    const outcome = await qaOperation({ prisma: this.prisma, messages: this.messages }, ctx.run, ctx.input);
    const s = outcome.summary as { pass?: number; warn?: number; fail?: number };
    return {
      kind: "done",
      outputs: { out: outcome.itemIds },
      summary: outcome.summary,
      skipped: outcome.skipped,
      skipReason: outcome.skipReason,
      llmUnits: (s.pass ?? 0) + (s.warn ?? 0) + (s.fail ?? 0),
    };
  }
}
