import { validateDefinition, type ValidationIssueCode } from "./validate-definition";
import { defaultProspectingDefinition, emptyWorkflowDefinition } from "./templates";
import { MAX_WORKFLOW_EDGES, MAX_WORKFLOW_NODES, type WorkflowDefinition } from "./definition.schema";

type Mutable = WorkflowDefinition;

function template(mutate?: (d: Mutable) => void): Mutable {
  const d = defaultProspectingDefinition();
  mutate?.(d);
  return d;
}

function codes(input: unknown): ValidationIssueCode[] {
  return validateDefinition(input).issues.map((i) => i.code);
}

describe("validateDefinition", () => {
  it("accepts the default prospecting template with no issues", () => {
    expect(validateDefinition(defaultProspectingDefinition())).toEqual({ valid: true, issues: [] });
  });

  it("accepts a minimal source -> normalize -> qualify workflow", () => {
    const d = template((x) => {
      x.nodes = x.nodes.filter((n) => ["source", "normalize", "qualify"].includes(n.id));
      x.edges = x.edges.filter((e) => ["e1", "e2"].includes(e.id));
    });
    expect(validateDefinition(d).valid).toBe(true);
  });

  describe("shape and limits", () => {
    it("rejects non-object input", () => {
      expect(codes(null)).toEqual(["SCHEMA"]);
      expect(codes("nope")).toEqual(["SCHEMA"]);
    });

    it("rejects unknown top-level keys", () => {
      expect(codes({ ...defaultProspectingDefinition(), extra: true })).toContain("SCHEMA");
    });

    it("rejects unknown keys inside a node config and points at the node", () => {
      const d = template((x) => {
        x.nodes.find((n) => n.id === "normalize")!.config = { surprise: 1 } as never;
      });
      const result = validateDefinition(d);
      expect(result.valid).toBe(false);
      expect(result.issues[0]).toMatchObject({ code: "SCHEMA", nodeId: "normalize" });
    });

    it("rejects an unknown node type", () => {
      const d = template() as unknown as { nodes: { type: string }[] };
      d.nodes[1]!.type = "RUN_SCRIPT";
      expect(codes(d)).toContain("SCHEMA");
    });

    it("rejects more than the maximum number of nodes", () => {
      const nodes = Array.from({ length: MAX_WORKFLOW_NODES + 1 }, (_, i) => ({ id: `n${i}`, type: "NORMALIZE", position: { x: 0, y: 0 }, config: {} }));
      expect(codes({ schemaVersion: 1, nodes, edges: [] })).toContain("SCHEMA");
    });

    it("rejects more than the maximum number of edges", () => {
      const edges = Array.from({ length: MAX_WORKFLOW_EDGES + 1 }, (_, i) => ({ id: `e${i}`, source: "a", sourceHandle: "out", target: "b" }));
      expect(codes({ schemaVersion: 1, nodes: [], edges })).toContain("SCHEMA");
    });

    it("rejects node ids with unsafe characters", () => {
      const d = template();
      d.nodes[0]!.id = "bad id; drop table";
      expect(codes(d)).toContain("SCHEMA");
    });

    it("rejects an unsupported schema version", () => {
      expect(codes({ ...defaultProspectingDefinition(), schemaVersion: 2 })).toContain("SCHEMA");
    });
  });

  describe("data source rules", () => {
    it("requires a Data Source node", () => {
      expect(codes(emptyWorkflowDefinition())).toEqual(["DATA_SOURCE_COUNT"]);
    });

    it("rejects two Data Source nodes", () => {
      const d = template((x) => {
        x.nodes.push({ id: "source2", type: "DATA_SOURCE", position: { x: 0, y: 0 }, config: { dataSourceIds: [], refresh: false } });
        x.edges.push({ id: "e11", source: "source2", sourceHandle: "out", target: "normalize" });
      });
      expect(codes(d)).toContain("DATA_SOURCE_COUNT");
    });

    it("rejects an edge into the Data Source", () => {
      const d = template((x) => {
        x.edges.push({ id: "bad", source: "normalize", sourceHandle: "out", target: "source" });
      });
      const issue = validateDefinition(d).issues.find((i) => i.code === "DATA_SOURCE_HAS_INPUT");
      expect(issue).toMatchObject({ edgeId: "bad", nodeId: "source" });
    });
  });

  describe("edges", () => {
    it("rejects duplicate node ids", () => {
      const d = template((x) => {
        x.nodes.push({ ...x.nodes[1]! });
      });
      expect(codes(d)).toContain("DUPLICATE_NODE_ID");
    });

    it("rejects duplicate edge ids", () => {
      const d = template((x) => {
        x.edges.push({ ...x.edges[0]!, target: "qualify" });
      });
      expect(codes(d)).toContain("DUPLICATE_EDGE_ID");
    });

    it("rejects an edge to a node that does not exist", () => {
      const d = template((x) => {
        x.edges.push({ id: "ghost", source: "normalize", sourceHandle: "out", target: "nowhere" });
      });
      expect(validateDefinition(d).issues).toContainEqual(expect.objectContaining({ code: "EDGE_UNKNOWN_NODE", edgeId: "ghost" }));
    });

    it("rejects a self loop", () => {
      const d = template((x) => {
        x.edges.push({ id: "loop", source: "normalize", sourceHandle: "out", target: "normalize" });
      });
      expect(codes(d)).toContain("EDGE_SELF_LOOP");
    });

    it("rejects the same connection drawn twice", () => {
      const d = template((x) => {
        x.edges.push({ id: "again", source: "source", sourceHandle: "out", target: "normalize" });
      });
      expect(codes(d)).toContain("DUPLICATE_EDGE");
    });

    it("rejects an output handle the node does not have", () => {
      const d = template((x) => {
        x.edges.find((e) => e.id === "e4")!.sourceHandle = "maybe";
      });
      expect(codes(d)).toContain("EDGE_INVALID_HANDLE");
    });

    it("rejects an edge leaving Simulated Send", () => {
      const d = template((x) => {
        x.edges.push({ id: "after", source: "send", sourceHandle: "out", target: "qa" });
      });
      expect(codes(d)).toContain("EDGE_INVALID_HANDLE");
    });

    it("rejects feeding companies into a prospect-only step", () => {
      const d = template((x) => {
        x.edges = x.edges.filter((e) => e.id !== "e2" && e.id !== "e3");
        x.edges.push({ id: "skip", source: "normalize", sourceHandle: "out", target: "missing" });
      });
      const issue = validateDefinition(d).issues.find((i) => i.code === "EDGE_KIND_MISMATCH");
      expect(issue).toMatchObject({ edgeId: "skip", nodeId: "missing" });
      expect(issue!.message).toContain("Qualify");
    });

    it("rejects feeding prospects back into Normalize", () => {
      const d = template((x) => {
        x.edges.push({ id: "back", source: "qualify", sourceHandle: "out", target: "normalize" });
      });
      expect(codes(d)).toContain("EDGE_KIND_MISMATCH");
    });
  });

  describe("graph structure", () => {
    it("flags a step with no incoming connection", () => {
      const d = template((x) => {
        x.edges = x.edges.filter((e) => e.id !== "e2");
      });
      const issues = validateDefinition(d).issues;
      expect(issues).toContainEqual(expect.objectContaining({ code: "NODE_NO_INPUT", nodeId: "qualify" }));
    });

    it("flags a cycle", () => {
      const d = template((x) => {
        x.edges.push({ id: "cycle", source: "requalify", sourceHandle: "out", target: "enrich" });
      });
      const cycleNodes = validateDefinition(d)
        .issues.filter((i) => i.code === "CYCLE")
        .map((i) => i.nodeId);
      expect(cycleNodes).toEqual(expect.arrayContaining(["enrich", "requalify"]));
    });

    it("flags a step that only receives input from an island the Data Source cannot reach", () => {
      const d = template((x) => {
        x.nodes.push({ id: "islandA", type: "ENRICH", position: { x: 0, y: 0 }, config: {} });
        x.nodes.push({ id: "islandB", type: "REQUALIFY", position: { x: 0, y: 0 }, config: {} });
        x.edges.push({ id: "i1", source: "islandA", sourceHandle: "out", target: "islandB" });
        x.edges.push({ id: "i2", source: "islandB", sourceHandle: "out", target: "islandA" });
      });
      const found = codes(d);
      expect(found).toContain("CYCLE");
    });

    it("flags an acyclic island fed only by a node with no input as unreachable chain", () => {
      const d = template((x) => {
        x.nodes.push({ id: "orphan", type: "ENRICH", position: { x: 0, y: 0 }, config: {} });
        x.nodes.push({ id: "tail", type: "REQUALIFY", position: { x: 0, y: 0 }, config: {} });
        x.edges.push({ id: "o1", source: "orphan", sourceHandle: "out", target: "tail" });
      });
      const issues = validateDefinition(d).issues;
      expect(issues).toContainEqual(expect.objectContaining({ code: "NODE_NO_INPUT", nodeId: "orphan" }));
      expect(issues).toContainEqual(expect.objectContaining({ code: "UNREACHABLE", nodeId: "tail" }));
    });

    it("allows two branches to merge into one node", () => {
      expect(validateDefinition(defaultProspectingDefinition()).valid).toBe(true);
    });
  });

  describe("approval before send", () => {
    it("rejects Simulated Send reached without a Human Approval step", () => {
      const d = template((x) => {
        x.edges = x.edges.filter((e) => e.id !== "e10");
        x.edges.push({ id: "direct", source: "qa", sourceHandle: "out", target: "send" });
      });
      const issues = validateDefinition(d).issues;
      expect(issues).toContainEqual(expect.objectContaining({ code: "SEND_WITHOUT_APPROVAL", nodeId: "send" }));
    });

    it("rejects Simulated Send wired to the Rejected output", () => {
      const d = template((x) => {
        x.edges.find((e) => e.id === "e10")!.sourceHandle = "rejected";
      });
      expect(codes(d)).toContain("SEND_WITHOUT_APPROVAL");
    });

    it("rejects Simulated Send when only one of two paths is approved", () => {
      const d = template((x) => {
        x.edges.push({ id: "bypass", source: "generate", sourceHandle: "out", target: "send" });
      });
      expect(codes(d)).toContain("SEND_WITHOUT_APPROVAL");
    });

    it("accepts a workflow with no Simulated Send at all", () => {
      const d = template((x) => {
        x.nodes = x.nodes.filter((n) => n.id !== "send");
        x.edges = x.edges.filter((e) => e.id !== "e10");
      });
      expect(validateDefinition(d).valid).toBe(true);
    });
  });

  describe("branches and required ordering", () => {
    it("rejects a Condition whose false output is not connected", () => {
      const d = template((x) => {
        x.edges = x.edges.filter((e) => e.id !== "e7");
      });
      const issue = validateDefinition(d).issues.find((i) => i.code === "BRANCH_NOT_CONNECTED");
      expect(issue).toMatchObject({ nodeId: "missing" });
      expect(issue!.message).toContain("false");
    });

    it("rejects a Condition whose true output is not connected", () => {
      const d = template((x) => {
        x.nodes = x.nodes.filter((n) => n.id !== "enrich" && n.id !== "requalify");
        x.edges = x.edges.filter((e) => !["e4", "e5", "e6"].includes(e.id));
      });
      expect(codes(d)).toContain("BRANCH_NOT_CONNECTED");
    });

    it("allows Human Approval to leave its Rejected output unconnected", () => {
      expect(codes(template())).not.toContain("BRANCH_NOT_CONNECTED");
    });

    it("rejects Requalify when a path reaches it without Enrich", () => {
      const d = template((x) => {
        x.edges.push({ id: "shortcut", source: "missing", sourceHandle: "false", target: "requalify" });
      });
      const issue = validateDefinition(d).issues.find((i) => i.code === "MISSING_REQUIRED_STEP");
      expect(issue).toMatchObject({ nodeId: "requalify" });
      expect(issue!.message).toContain("Enrich");
    });

    it("rejects Requalify placed directly after Qualify", () => {
      const d = template((x) => {
        x.nodes = x.nodes.filter((n) => !["missing", "enrich"].includes(n.id));
        x.edges = x.edges.filter((e) => !["e3", "e4", "e5", "e7"].includes(e.id));
        x.edges.push({ id: "direct", source: "qualify", sourceHandle: "out", target: "requalify" });
        x.edges.push({ id: "tail", source: "qualify", sourceHandle: "out", target: "generate" });
      });
      expect(validateDefinition(d).issues).toContainEqual(expect.objectContaining({ code: "MISSING_REQUIRED_STEP", nodeId: "requalify" }));
    });

    it("rejects AI QA when emails are never generated upstream", () => {
      const d = template((x) => {
        x.edges.push({ id: "skipgen", source: "qualify", sourceHandle: "out", target: "qa" });
      });
      expect(validateDefinition(d).issues).toContainEqual(expect.objectContaining({ code: "MISSING_REQUIRED_STEP", nodeId: "qa" }));
    });

    it("rejects Human Approval with no Generate Email upstream", () => {
      const d = template((x) => {
        x.edges = x.edges.filter((e) => e.id !== "e9");
        x.edges.push({ id: "early", source: "qualify", sourceHandle: "out", target: "approval" });
      });
      expect(validateDefinition(d).issues).toContainEqual(expect.objectContaining({ code: "MISSING_REQUIRED_STEP", nodeId: "approval" }));
    });

    it("accepts the required step on every path, including through a merge", () => {
      expect(validateDefinition(defaultProspectingDefinition()).valid).toBe(true);
    });
  });

  describe("node configuration", () => {
    it("requires a campaign choice on Simulated Send", () => {
      const d = template((x) => {
        x.nodes.find((n) => n.id === "send")!.config = {} as never;
      });
      expect(validateDefinition(d).issues).toContainEqual(expect.objectContaining({ code: "SCHEMA", nodeId: "send" }));
    });

    it("rejects Simulated Send with both a campaign id and a name", () => {
      const d = template((x) => {
        x.nodes.find((n) => n.id === "send")!.config = { campaignId: "3f1c2a4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b", campaignName: "x" } as never;
      });
      expect(codes(d)).toContain("SCHEMA");
    });

    it("rejects a data source id that is not a uuid", () => {
      const d = template((x) => {
        x.nodes.find((n) => n.id === "source")!.config = { dataSourceIds: ["not-a-uuid"], refresh: false };
      });
      expect(validateDefinition(d).issues).toContainEqual(expect.objectContaining({ code: "SCHEMA", nodeId: "source" }));
    });

    it("applies config defaults while validating", () => {
      const d = template() as unknown as { nodes: { id: string; config: unknown }[] };
      d.nodes.find((n) => n.id === "source")!.config = {};
      d.nodes.find((n) => n.id === "approval")!.config = {};
      expect(validateDefinition(d).valid).toBe(true);
    });
  });

  it("reports every problem at once instead of stopping at the first", () => {
    const d = template((x) => {
      x.edges = x.edges.filter((e) => e.id !== "e2");
      x.edges.push({ id: "bypass", source: "generate", sourceHandle: "out", target: "send" });
    });
    const found = codes(d);
    expect(found).toContain("NODE_NO_INPUT");
    expect(found).toContain("SEND_WITHOUT_APPROVAL");
  });
});
