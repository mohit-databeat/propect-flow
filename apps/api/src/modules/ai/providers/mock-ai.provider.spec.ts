import type { EmailGenerationOutput, EmailGenerationRequest, IcpDraftDefinition, IcpExtractionOutput } from "@prospect/shared";
import { MockAiProvider } from "./mock-ai.provider";
import type { GenerateStructuredMessage } from "../ai-provider.interface";

const PROMPT_BODY = "You extract ICPs.\n\nPREVIOUS_DRAFT_JSON:\n{{previousDraftJson}}\n\nRest of the instructions.";

function render(previousDraft: IcpDraftDefinition | null): string {
  return PROMPT_BODY.replace("{{previousDraftJson}}", JSON.stringify(previousDraft ?? null));
}

async function extract(previousDraft: IcpDraftDefinition | null, lastUserMessage: string): Promise<IcpExtractionOutput> {
  const provider = new MockAiProvider();
  const messages: GenerateStructuredMessage[] = [{ role: "user", content: lastUserMessage }];
  const result = await provider.generateStructured({
    model: "mock-strong",
    system: render(previousDraft),
    messages,
    jsonSchema: {},
    meta: { purpose: "ICP_EXTRACTION", promptKey: "icp.extract", promptVersion: 1 },
  });
  return result.data as IcpExtractionOutput;
}

describe("MockAiProvider — works fully offline, no credentials required", () => {
  it("declares itself as a mock with no required credentials", () => {
    const provider = new MockAiProvider();
    expect(provider.isMock).toBe(true);
    expect(provider.available).toBe(true);
    expect(provider.requiredCredentials).toEqual([]);
  });

  it("turns the demo ICP sentence into the full six-criterion structured ICP", async () => {
    const out = await extract(
      null,
      "We sell to US-based SaaS companies with 100 to 500 employees and more than $10M revenue. They should already use Salesforce. Ideally they are hiring salespeople right now.",
    );
    expect(out.draft.criteria).toHaveLength(6);
    expect(out.draft.criteria.map((c) => c.id)).toEqual(
      expect.arrayContaining(["industry_saas", "country_us", "employees_100_500", "revenue_gt_10m", "uses_salesforce", "hiring_salespeople"]),
    );
    expect(out.clarifications.some((c) => c.severity === "BLOCKING")).toBe(true);
  });

  it("turns 'target mid-size companies' into a zero-criteria draft with a BLOCKING employee-range clarification", async () => {
    const out = await extract(null, "target mid-size companies");
    expect(out.draft.criteria).toHaveLength(0);
    expect(out.clarifications).toHaveLength(1);
    expect(out.clarifications[0]).toMatchObject({ type: "ambiguous_scope", severity: "BLOCKING" });
    expect(out.clarifications[0]!.proposedDefault).toMatch(/100-500/);
  });

  it("turns a resolved employee-range answer into a BETWEEN criterion", async () => {
    const previousDraft: IcpDraftDefinition = {
      schemaVersion: 1,
      name: "Untitled ICP",
      summary: "",
      targetPersonas: [],
      criteria: [],
      scoring: { qualifiedThreshold: 70, needsReviewThreshold: 40, minCoverage: 60, unknownRequiredPolicy: "NEEDS_REVIEW" },
      clarifications: [
        {
          id: "clar:general:ambiguous_scope",
          type: "ambiguous_scope",
          question: "What employee range do you mean by mid-size?",
          severity: "BLOCKING",
          answer: "100-500 employees",
          proposedDefault: "100-500 employees",
          resolvedBy: "USER",
        },
      ],
    };
    const out = await extract(previousDraft, 'Regarding "What employee range do you mean by mid-size?": 100-500 employees');
    expect(out.draft.criteria).toHaveLength(1);
    expect(out.draft.criteria[0]).toMatchObject({
      id: "employees_range",
      operator: "BETWEEN",
      field: "firmographics.employeeCount",
      value: { min: 100, max: 500 },
      required: true,
    });

    expect(out.clarifications).toHaveLength(0);
  });

  it("re-proposes still-open (non-USER) clarifications on an unrelated follow-up turn so they are not silently dropped", async () => {
    const previousDraft: IcpDraftDefinition = {
      schemaVersion: 1,
      name: "Untitled ICP",
      summary: "",
      targetPersonas: [],
      criteria: [],
      scoring: { qualifiedThreshold: 70, needsReviewThreshold: 40, minCoverage: 60, unknownRequiredPolicy: "NEEDS_REVIEW" },
      clarifications: [
        {
          id: "clar:general:ambiguous_scope",
          type: "ambiguous_scope",
          question: "What employee range do you mean by mid-size?",
          severity: "BLOCKING",
          answer: null,
          proposedDefault: "100-500 employees",
          resolvedBy: "UNRESOLVED",
        },
      ],
    };
    const out = await extract(previousDraft, "also they use HubSpot");
    expect(out.clarifications).toHaveLength(1);
    expect(out.clarifications[0]!.type).toBe("ambiguous_scope");
  });
});

describe("MockAiProvider — email generation", () => {
  async function generateEmail(request: EmailGenerationRequest): Promise<EmailGenerationOutput> {
    const provider = new MockAiProvider();
    const result = await provider.generateStructured({
      model: "mock-strong",
      system: `Instructions.\n\nREQUEST_JSON:\n${JSON.stringify(request)}\n\nMore instructions.`,
      messages: [{ role: "user", content: "Write the outreach email for this request." }],
      jsonSchema: {},
      meta: { purpose: "EMAIL_GENERATE", promptKey: "email.generate", promptVersion: 1 },
    });
    return result.data as EmailGenerationOutput;
  }

  it("never splices a DETERMINISTIC criterion's raw evaluator reason into the email body", async () => {
    const request: EmailGenerationRequest = {
      company: { name: "Notion", domain: "notion.so", industry: "software_saas", country: "US", employeeCount: 480, description: null },
      recipient: { fullName: "Daniel Okafor", title: "VP Sales", seniority: "vp" },
      icpSummary: "United States SaaS companies with 100-500 employees.",
      highlights: [{ criterionLabel: "Industry is SaaS / B2B software", reason: 'firmographics.industry "software_saas" is in [software_saas]' }],
      senderContext: null,
    };

    const output = await generateEmail(request);

    expect(output.body).not.toContain("firmographics.industry");
    expect(output.body).not.toContain("[software_saas]");
    expect(output.body).toContain("industry is SaaS / B2B software");
  });
});
