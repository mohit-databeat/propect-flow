import { Injectable } from "@nestjs/common";
import { WorkflowDefinition, validateDefinition, type ValidationIssue, type ValidationResult } from "@prospect/shared";
import type { WorkspaceContext } from "../../common/decorators/current-user.decorator";
import { CampaignsService } from "../campaigns/campaigns.service";
import { DataSourcesService } from "../data-sources/data-sources.service";

@Injectable()
export class ProjectDefinitionValidator {
  constructor(
    private readonly dataSources: DataSourcesService,
    private readonly campaigns: CampaignsService,
  ) {}

  async validate(ws: WorkspaceContext, projectId: string, input: unknown): Promise<ValidationResult> {
    const structural = validateDefinition(input);
    if (structural.issues.some((i) => i.code === "SCHEMA")) return structural;

    const definition = WorkflowDefinition.parse(input);
    const issues: ValidationIssue[] = [...structural.issues];

    const referencedSources = definition.nodes.flatMap((n) => (n.type === "DATA_SOURCE" ? n.config.dataSourceIds.map((id) => ({ nodeId: n.id, id })) : []));
    if (referencedSources.length > 0) {
      const available = new Set((await this.dataSources.list(ws, projectId, false)).map((d) => d.id));
      for (const ref of referencedSources) {
        if (!available.has(ref.id)) {
          issues.push({ code: "DATA_SOURCE_NOT_FOUND", nodeId: ref.nodeId, message: "A selected data source does not exist in this project or has been archived" });
        }
      }
    }

    const referencedCampaigns = definition.nodes.flatMap((n) => (n.type === "SIMULATED_SEND" && n.config.campaignId ? [{ nodeId: n.id, id: n.config.campaignId }] : []));
    if (referencedCampaigns.length > 0) {
      const available = new Set((await this.campaigns.list(ws, projectId)).map((c) => c.id));
      for (const ref of referencedCampaigns) {
        if (!available.has(ref.id)) {
          issues.push({ code: "CAMPAIGN_NOT_FOUND", nodeId: ref.nodeId, message: "The selected campaign does not exist in this project" });
        }
      }
    }

    return { valid: issues.length === 0, issues };
  }
}
