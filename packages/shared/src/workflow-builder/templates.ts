import type { WorkflowDefinition, WorkflowDraftDefinition } from "./definition.schema";
import { WORKFLOW_SCHEMA_VERSION } from "./definition.schema";
import { autoLayout } from "./auto-layout";

export function emptyWorkflowDefinition(): WorkflowDefinition {
  return { schemaVersion: WORKFLOW_SCHEMA_VERSION, nodes: [], edges: [] };
}

export function defaultProspectingDefinition(): WorkflowDefinition {
  const unlaid: WorkflowDefinition = {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    nodes: [
      { id: "source", type: "DATA_SOURCE", position: { x: 0, y: 160 }, config: { dataSourceIds: [], refresh: false } },
      { id: "normalize", type: "NORMALIZE", position: { x: 260, y: 160 }, config: {} },
      { id: "qualify", type: "QUALIFY", position: { x: 520, y: 160 }, config: {} },
      { id: "missing", type: "CONDITION", label: "Has missing fields?", position: { x: 780, y: 160 }, config: { field: "hasMissingFields", operator: "IS_TRUE" } },
      { id: "enrich", type: "ENRICH", position: { x: 1040, y: 40 }, config: {} },
      { id: "requalify", type: "REQUALIFY", position: { x: 1300, y: 40 }, config: {} },
      { id: "generate", type: "GENERATE_EMAIL", position: { x: 1560, y: 160 }, config: {} },
      { id: "qa", type: "AI_QA", position: { x: 1820, y: 160 }, config: {} },
      { id: "approval", type: "HUMAN_APPROVAL", position: { x: 2080, y: 160 }, config: { requireAllReviewed: true } },
      { id: "send", type: "SIMULATED_SEND", position: { x: 2340, y: 80 }, config: { campaignName: "Workflow campaign" } },
    ],
    edges: [
      { id: "e1", source: "source", sourceHandle: "out", target: "normalize" },
      { id: "e2", source: "normalize", sourceHandle: "out", target: "qualify" },
      { id: "e3", source: "qualify", sourceHandle: "out", target: "missing" },
      { id: "e4", source: "missing", sourceHandle: "true", target: "enrich" },
      { id: "e5", source: "enrich", sourceHandle: "out", target: "requalify" },
      { id: "e6", source: "requalify", sourceHandle: "out", target: "generate" },
      { id: "e7", source: "missing", sourceHandle: "false", target: "generate" },
      { id: "e8", source: "generate", sourceHandle: "out", target: "qa" },
      { id: "e9", source: "qa", sourceHandle: "out", target: "approval" },
      { id: "e10", source: "approval", sourceHandle: "approved", target: "send" },
    ],
  };
  return autoLayout(unlaid as unknown as WorkflowDraftDefinition) as unknown as WorkflowDefinition;
}
