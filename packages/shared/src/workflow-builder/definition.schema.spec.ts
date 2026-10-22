import { ConditionNodeConfig, WorkflowDraftDefinition, WorkflowDefinition } from "./definition.schema";
import { defaultProspectingDefinition, emptyWorkflowDefinition } from "./templates";
import { NODE_CATALOG, NODE_CATALOG_LIST } from "./node-catalog";
import { WORKFLOW_NODE_TYPES, NODE_CONFIG_SCHEMAS } from "./definition.schema";
import { UpdateWorkflowDto, CreateWorkflowDto, StartWorkflowExecutionDto, PublishWorkflowDto } from "./workflow-builder.dto";

describe("ConditionNodeConfig", () => {
  const ok = (cfg: unknown) => ConditionNodeConfig.safeParse(cfg).success;

  it("accepts boolean fields with IS_TRUE / IS_FALSE and no value", () => {
    expect(ok({ field: "hasMissingFields", operator: "IS_TRUE" })).toBe(true);
    expect(ok({ field: "hasRequiredFail", operator: "IS_FALSE" })).toBe(true);
  });

  it("rejects a value on a boolean field", () => {
    expect(ok({ field: "hasMissingFields", operator: "IS_TRUE", value: "yes" })).toBe(false);
  });

  it("accepts numeric comparisons within 0-100", () => {
    expect(ok({ field: "score", operator: "GTE", value: 70 })).toBe(true);
    expect(ok({ field: "coverage", operator: "LTE", value: 0 })).toBe(true);
  });

  it("rejects out-of-range, non-numeric, or missing numeric values", () => {
    expect(ok({ field: "score", operator: "GTE", value: 101 })).toBe(false);
    expect(ok({ field: "score", operator: "GTE", value: -1 })).toBe(false);
    expect(ok({ field: "score", operator: "GTE", value: "70" })).toBe(false);
    expect(ok({ field: "score", operator: "GTE" })).toBe(false);
  });

  it("accepts enum fields with EQ / NEQ / IN and valid values", () => {
    expect(ok({ field: "status", operator: "EQ", value: "QUALIFIED" })).toBe(true);
    expect(ok({ field: "status", operator: "NEQ", value: "DISQUALIFIED" })).toBe(true);
    expect(ok({ field: "qaStatus", operator: "IN", value: ["PASS", "WARN"] })).toBe(true);
  });

  it("rejects values outside the field's enum", () => {
    expect(ok({ field: "status", operator: "EQ", value: "MAYBE" })).toBe(false);
    expect(ok({ field: "qaStatus", operator: "IN", value: ["PASS", "NOPE"] })).toBe(false);
    expect(ok({ field: "status", operator: "IN", value: "QUALIFIED" })).toBe(false);
  });

  it("rejects operators that do not fit the field", () => {
    expect(ok({ field: "status", operator: "GTE", value: "QUALIFIED" })).toBe(false);
    expect(ok({ field: "score", operator: "IN", value: ["1"] })).toBe(false);
    expect(ok({ field: "hasMissingFields", operator: "EQ", value: "true" })).toBe(false);
  });

  it("rejects unknown fields and unknown keys", () => {
    expect(ok({ field: "company.name", operator: "EQ", value: "x" })).toBe(false);
    expect(ok({ field: "status", operator: "EQ", value: "QUALIFIED", script: "1" })).toBe(false);
  });
});

describe("node catalog", () => {
  it("has one entry per node type, keyed correctly", () => {
    expect(NODE_CATALOG_LIST).toHaveLength(WORKFLOW_NODE_TYPES.length);
    for (const type of WORKFLOW_NODE_TYPES) expect(NODE_CATALOG[type].type).toBe(type);
  });

  it("has a config schema for every node type that accepts its own default config", () => {
    for (const type of WORKFLOW_NODE_TYPES) {
      const parsed = NODE_CONFIG_SCHEMAS[type].safeParse(NODE_CATALOG[type].defaultConfig);
      expect({ type, ok: parsed.success }).toEqual({ type, ok: true });
    }
  });

  it("gives branching nodes more than one output and Simulated Send none", () => {
    expect(NODE_CATALOG.CONDITION.outputHandles.map((h) => h.id)).toEqual(["true", "false"]);
    expect(NODE_CATALOG.HUMAN_APPROVAL.outputHandles.map((h) => h.id)).toEqual(["approved", "rejected"]);
    expect(NODE_CATALOG.SIMULATED_SEND.outputHandles).toEqual([]);
  });

  it("declares required branches and upstream steps", () => {
    expect(NODE_CATALOG.CONDITION.requiredBranches).toEqual(["true", "false"]);
    expect(NODE_CATALOG.REQUALIFY.requiresUpstream).toBe("ENRICH");
    expect(NODE_CATALOG.AI_QA.requiresUpstream).toBe("GENERATE_EMAIL");
    expect(NODE_CATALOG.HUMAN_APPROVAL.requiresUpstream).toBe("GENERATE_EMAIL");
    for (const entry of NODE_CATALOG_LIST) {
      for (const branch of entry.requiredBranches) expect(entry.outputHandles.map((h) => h.id)).toContain(branch);
    }
  });

  it("marks the LLM-using nodes", () => {
    const llm = NODE_CATALOG_LIST.filter((n) => n.usesLlm).map((n) => n.type);
    expect(llm.sort()).toEqual(["AI_QA", "GENERATE_EMAIL", "REQUALIFY"]);
  });
});

describe("definitions and DTOs", () => {
  it("parses the template and fills edge handle defaults", () => {
    const parsed = WorkflowDefinition.parse(defaultProspectingDefinition());
    expect(parsed.nodes).toHaveLength(10);
    expect(parsed.edges.every((e) => e.sourceHandle.length > 0)).toBe(true);
  });

  it("lets a draft with incomplete config be saved", () => {
    const draft = {
      schemaVersion: 1,
      nodes: [{ id: "send", type: "SIMULATED_SEND", position: { x: 1, y: 2 }, config: {} }],
      edges: [],
    };
    expect(WorkflowDraftDefinition.safeParse(draft).success).toBe(true);
    expect(WorkflowDefinition.safeParse(draft).success).toBe(false);
  });

  it("still bounds drafts", () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => ({ id: `n${i}`, type: "ENRICH", position: { x: 0, y: 0 }, config: {} }));
    expect(WorkflowDraftDefinition.safeParse({ schemaVersion: 1, nodes: tooMany, edges: [] }).success).toBe(false);
    expect(WorkflowDraftDefinition.safeParse({ schemaVersion: 1, nodes: [{ id: "x", type: "NOPE", position: { x: 0, y: 0 }, config: {} }], edges: [] }).success).toBe(false);
  });

  it("requires something to change on update", () => {
    expect(UpdateWorkflowDto.safeParse({}).success).toBe(false);
    expect(UpdateWorkflowDto.safeParse({ name: "Renamed" }).success).toBe(true);
    expect(UpdateWorkflowDto.safeParse({ description: null }).success).toBe(true);
    expect(UpdateWorkflowDto.safeParse({ definition: emptyWorkflowDefinition() }).success).toBe(true);
  });

  it("defaults the create template to EMPTY and rejects blank names", () => {
    expect(CreateWorkflowDto.parse({ name: "  Outbound  " })).toMatchObject({ name: "Outbound", template: "EMPTY" });
    expect(CreateWorkflowDto.safeParse({ name: "   " }).success).toBe(false);
  });

  it("requires an explicit version id to start an execution", () => {
    expect(StartWorkflowExecutionDto.safeParse({}).success).toBe(false);
    expect(StartWorkflowExecutionDto.safeParse({ versionId: "latest" }).success).toBe(false);
    expect(StartWorkflowExecutionDto.safeParse({ versionId: "3f1c2a4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b" }).success).toBe(true);
    expect(StartWorkflowExecutionDto.safeParse({ versionId: "3f1c2a4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b", extra: 1 }).success).toBe(false);
  });

  it("accepts an optional publish note and rejects unknown keys", () => {
    expect(PublishWorkflowDto.safeParse({}).success).toBe(true);
    expect(PublishWorkflowDto.safeParse({ note: "ready" }).success).toBe(true);
    expect(PublishWorkflowDto.safeParse({ force: true }).success).toBe(false);
  });
});
