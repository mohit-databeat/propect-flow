import { Injectable } from "@nestjs/common";
import type {
  AssessmentBatchRequest,
  AssessmentOutput,
  EmailGenerationOutput,
  EmailGenerationRequest,
  EmailQaOutput,
  EmailQaRequest,
  FieldMappingSuggestion,
  IcpCriterion,
  IcpDraftDefinition,
  IcpExtractionOutput,
} from "@prospect/shared";
import { HEURISTIC_ALIASES } from "../../connectors/csv.connector";
import type { AiProviderAdapter, AiTier, GenerateStructuredRequest, GenerateStructuredResult } from "../ai-provider.interface";

const norm = (s: string) => s.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

@Injectable()
export class MockAiProvider implements AiProviderAdapter {
  readonly key = "mock";
  readonly displayName = "Mock (offline)";
  readonly isMock = true;
  readonly available = true;
  readonly requiredCredentials: string[] = [];

  defaultModel(tier: AiTier): string {
    return tier === "fast" ? "mock-fast" : "mock-strong";
  }

  async generateStructured(req: GenerateStructuredRequest): Promise<GenerateStructuredResult> {
    let data: unknown;
    switch (req.meta.promptKey) {
      case "icp.extract":
        data = mockIcpExtract(req.system, req.messages);
        break;
      case "csv.mapping":
        data = mockCsvMapping(req.system);
        break;
      case "qualify.assess":
        data = mockAssessBatch(req.system);
        break;
      case "email.generate":
        data = mockGenerateEmail(req.system);
        break;
      case "email.qa":
        data = mockQaEmail(req.system);
        break;
      default:
        throw new Error(`mock provider: no canned response configured for promptKey "${req.meta.promptKey}"`);
    }
    const rawText = JSON.stringify(data);
    return {
      data,
      rawText,
      usage: { inputTokens: Math.ceil(rawText.length / 4) + 200, outputTokens: Math.ceil(rawText.length / 4) },
      model: req.model,
    };
  }
}

function emptyDraft(): Omit<IcpDraftDefinition, "clarifications"> {
  return {
    schemaVersion: 1,
    name: "Untitled ICP",
    summary: "",
    targetPersonas: [],
    criteria: [],
    scoring: { qualifiedThreshold: 70, needsReviewThreshold: 40, minCoverage: 60, unknownRequiredPolicy: "NEEDS_REVIEW" },
  };
}

function extractPreviousDraft(system: string): IcpDraftDefinition | null {
  const marker = "PREVIOUS_DRAFT_JSON:";
  const idx = system.indexOf(marker);
  if (idx === -1) return null;
  const rest = system.slice(idx + marker.length).trim();

  const end = rest.indexOf("\n\n");
  const jsonStr = (end === -1 ? rest : rest.slice(0, end)).trim();
  if (jsonStr === "null" || jsonStr === "") return null;
  try {
    return JSON.parse(jsonStr) as IcpDraftDefinition;
  } catch {
    return null;
  }
}

function reproposeOpen(previousDraft: IcpDraftDefinition | null): IcpExtractionOutput["clarifications"] {
  if (!previousDraft) return [];
  return previousDraft.clarifications
    .filter((c) => c.resolvedBy !== "USER")
    .map((c) => ({ criterionId: c.criterionId, type: c.type, question: c.question, severity: c.severity, proposedDefault: c.proposedDefault }));
}

const DEMO_ICP_DRAFT: Omit<IcpDraftDefinition, "clarifications"> = {
  schemaVersion: 1,
  name: "US mid-market SaaS on Salesforce",
  summary:
    "United States SaaS companies with 100-500 employees and over $10M in revenue that run Salesforce, prioritising those currently hiring sales roles.",
  targetPersonas: [
    { title: "VP Sales", seniority: "vp", department: "sales" },
    { title: "Head of Revenue Operations", seniority: "director", department: "sales" },
  ],
  criteria: [
    { id: "industry_saas", label: "Industry is SaaS / B2B software", kind: "DETERMINISTIC", field: "firmographics.industry", operator: "IN", value: ["software_saas"], weight: 8, required: true, enrichIfMissing: true },
    { id: "country_us", label: "Headquartered in the United States", kind: "DETERMINISTIC", field: "firmographics.country", operator: "EQ", value: "US", weight: 8, required: true, enrichIfMissing: true },
    { id: "employees_100_500", label: "100 to 500 employees", kind: "DETERMINISTIC", field: "firmographics.employeeCount", operator: "BETWEEN", value: { min: 100, max: 500 }, weight: 7, required: true, enrichIfMissing: true },
    { id: "revenue_gt_10m", label: "Revenue above $10M", kind: "DETERMINISTIC", field: "firmographics.revenueUsd", operator: "GTE", value: 10_000_000, weight: 6, required: false, enrichIfMissing: true },
    { id: "uses_salesforce", label: "Uses Salesforce", kind: "DETERMINISTIC", field: "technographics.stack", operator: "CONTAINS_ANY", value: ["salesforce"], weight: 7, required: false, enrichIfMissing: true },
    {
      id: "hiring_salespeople",
      label: "Actively hiring salespeople",
      kind: "QUALITATIVE",
      operator: "LLM_ASSESS",
      question: "Is this company currently hiring for sales or revenue roles (AE, SDR/BDR, sales leadership, revenue operations)?",
      passRubric: "PASS if at least one open role in the evidence is clearly a sales or revenue role and was posted within the recency window.",
      failRubric: "FAIL if the hiring evidence is authoritative and contains no sales or revenue roles.",
      evidenceFields: ["signals.hiring", "signals.news", "firmographics.description"],
      requiredEvidenceFields: ["signals.hiring"],
      minConfidence: 60,
      recencyDays: 90,
      weight: 6,
      required: false,
      enrichIfMissing: true,
    },
  ],
  scoring: { qualifiedThreshold: 70, needsReviewThreshold: 40, minCoverage: 60, unknownRequiredPolicy: "NEEDS_REVIEW" },
};

function isDemoIcpMessage(text: string): boolean {
  return text.includes("saas") && text.includes("salesforce") && text.includes("100") && text.includes("500") && (text.includes("hiring") || text.includes("hire"));
}

const RANGE_RE = /(\d{1,6})\s*(?:-|to|–)\s*(\d{1,6})/;

function mockIcpExtract(system: string, messages: { role: "user" | "assistant"; content: string }[]): IcpExtractionOutput {
  const previousDraft = extractPreviousDraft(system);
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const text = (lastUser?.content ?? "").toLowerCase();

  if (isDemoIcpMessage(text)) {
    return {
      draft: DEMO_ICP_DRAFT,
      clarifications: [
        {
          type: "required_or_soft",
          criterionId: "revenue_gt_10m",
          question: "Is revenue above $10M a hard requirement or a preference?",
          severity: "MINOR",
          proposedDefault: "Treated as a preference (soft criterion) because revenue data is often missing.",
        },
        {
          type: "recency_window",
          criterionId: "hiring_salespeople",
          question: "How recent should sales job postings be to count?",
          severity: "BLOCKING",
          proposedDefault: "Last 90 days",
        },
      ],
      unsupported: [],
      assistantMessage:
        "I drafted six criteria for US mid-market SaaS companies on Salesforce that are hiring sales roles. One question: how recent should sales job postings be to count? I suggest the last 90 days.",
    };
  }

  const rangeMatch = text.match(RANGE_RE);
  if (rangeMatch && text.includes("employee")) {
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);
    const base = previousDraft ?? emptyDraft();
    const criteria: IcpCriterion[] = [...base.criteria];
    const idx = criteria.findIndex((c) => c.id === "employees_range");
    const criterion: IcpCriterion = {
      id: "employees_range",
      label: `${min} to ${max} employees`,
      kind: "DETERMINISTIC",
      field: "firmographics.employeeCount",
      operator: "BETWEEN",
      value: { min, max },
      weight: 7,
      required: true,
      enrichIfMissing: true,
    };
    if (idx >= 0) criteria[idx] = criterion;
    else criteria.push(criterion);

    return {
      draft: {
        ...base,
        name: base.name === "Untitled ICP" ? "Mid-size company ICP" : base.name,
        summary: base.summary || `Companies with ${min}-${max} employees.`,
        criteria,
      },

      clarifications: reproposeOpen(previousDraft),
      unsupported: [],
      assistantMessage: `Got it — I've set the employee range to ${min}-${max}. Let me know if there's anything else to add (industry, location, tools they use, or hiring signals), or you can activate this ICP now.`,
    };
  }

  if (text.includes("mid-size") || text.includes("mid size") || text.includes("midsize")) {
    const base = previousDraft ?? emptyDraft();
    return {
      draft: base,
      clarifications: [
        ...reproposeOpen(previousDraft).filter((c) => c.type !== "ambiguous_scope"),
        {
          type: "ambiguous_scope",
          question: "What employee range do you mean by mid-size?",
          severity: "BLOCKING",
          proposedDefault: "100-500 employees",
        },
      ],
      unsupported: [],
      assistantMessage: "Got it. What employee range do you mean by mid-size? A common definition is 100–500 employees. Also, which industries and countries should I include?",
    };
  }

  return {
    draft: previousDraft ?? emptyDraft(),
    clarifications: reproposeOpen(previousDraft),
    unsupported: [],
    assistantMessage: "Could you tell me more about your ideal customer — industry, location, company size, or any tools they should already use?",
  };
}

function extractHeaders(system: string): string[] {
  const match = system.match(/HEADERS_JSON:\s*(\[[\s\S]*?\])\s*\n\nSAMPLE_ROWS_JSON/);
  if (!match) return [];
  try {
    return JSON.parse(match[1]!) as string[];
  } catch {
    return [];
  }
}

function mockCsvMapping(system: string): FieldMappingSuggestion {
  const headers = extractHeaders(system);
  const mapping: FieldMappingSuggestion["mapping"] = {};
  const confidence: FieldMappingSuggestion["confidence"] = {};
  const usedFields = new Set<string>();

  for (const header of headers) {
    const candidates = HEURISTIC_ALIASES[norm(header)];
    const field = candidates?.find((f) => !usedFields.has(f));
    if (field) {
      mapping[header] = field;
      confidence[header] = 85;
      usedFields.add(field);
    } else {
      mapping[header] = null;
      confidence[header] = 0;
    }
  }
  return { mapping, confidence };
}

const SALES_ROLE_RE = /\b(sales|account executive|sdr|bdr|business development|revenue)\b/i;

function extractBatchJson(system: string): AssessmentBatchRequest | null {
  const marker = "BATCH_JSON:";
  const idx = system.indexOf(marker);
  if (idx === -1) return null;
  const rest = system.slice(idx + marker.length).trim();
  const end = rest.indexOf("\n\n");
  const jsonStr = (end === -1 ? rest : rest.slice(0, end)).trim();
  try {
    return JSON.parse(jsonStr) as AssessmentBatchRequest;
  } catch {
    return null;
  }
}

function mockAssessBatch(system: string): AssessmentOutput {
  const batch = extractBatchJson(system);
  if (!batch) return { results: [] };

  const results = batch.companies.map((c) => {
    const hiring = c.evidence["signals.hiring"] as { items?: { title?: string }[]; authoritative?: boolean } | undefined;
    const items = hiring?.items ?? [];
    const authoritative = hiring?.authoritative ?? false;
    const matched = items.find((i) => SALES_ROLE_RE.test(String(i.title ?? "")));

    if (matched) {
      return { companyId: c.companyId, verdict: "PASS" as const, confidence: 88, reason: `Open sales/revenue role found: "${matched.title}".`, evidenceRefs: c.suppliedAttributeIds };
    }
    if (authoritative) {
      return {
        companyId: c.companyId,
        verdict: "FAIL" as const,
        confidence: 85,
        reason: "Hiring evidence is authoritative and contains no sales or revenue roles.",
        evidenceRefs: c.suppliedAttributeIds,
      };
    }
    return {
      companyId: c.companyId,
      verdict: "UNKNOWN" as const,
      confidence: 35,
      reason: "No sales-related postings found and the hiring evidence is not authoritative — absence cannot be confirmed.",
      evidenceRefs: c.suppliedAttributeIds,
    };
  });

  return { results };
}

function extractRequestJson<T>(system: string): T | null {
  const marker = "REQUEST_JSON:";
  const idx = system.indexOf(marker);
  if (idx === -1) return null;
  const rest = system.slice(idx + marker.length).trim();
  const end = rest.indexOf("\n\n");
  const jsonStr = (end === -1 ? rest : rest.slice(0, end)).trim();
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    return null;
  }
}

const PLACEHOLDER_RE = /\[[^\]]+\]|\{\{[^}]+\}\}/;

function mockGenerateEmail(system: string): EmailGenerationOutput {
  const req = extractRequestJson<EmailGenerationRequest>(system);
  if (!req) return { subject: "Quick question", body: "Hi there, worth a quick call?", personalizationPoints: [] };

  const firstName = req.recipient.fullName ? req.recipient.fullName.split(" ")[0] : null;
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  const topHighlight = req.highlights[0];
  const personalizationPoints: string[] = [];

  const sentences: string[] = [];
  if (topHighlight) {

    const label = topHighlight.criterionLabel;
    sentences.push(`I noticed ${req.company.name} matches what we look for: ${label.charAt(0).toLowerCase()}${label.slice(1)}.`);
    personalizationPoints.push(topHighlight.criterionLabel);
  } else if (req.company.industry) {
    sentences.push(`I've been following ${req.company.name} in the ${req.company.industry} space.`);
    personalizationPoints.push("industry");
  } else {
    sentences.push(`I wanted to reach out to ${req.company.name} directly.`);
  }
  sentences.push(req.icpSummary ? `We work with companies like yours on exactly this: ${req.icpSummary}` : "We help companies like yours grow faster.");
  sentences.push("Would you be open to a quick 15-minute call this week to see if it's a fit?");

  const subject = topHighlight ? `${req.company.name} + a quick idea` : `Quick question for ${req.company.name}`;

  return { subject, body: `${greeting}\n\n${sentences.join(" ")}\n\nBest,\nThe Team`, personalizationPoints };
}

const HYPE_RE = /\b(revolutionary|game-changing|unbelievable|amazing deal)\b/i;

function mockQaEmail(system: string): EmailQaOutput {
  const req = extractRequestJson<EmailQaRequest>(system);
  if (!req) return { verdict: "WARN", issues: [{ severity: "WARN", note: "Could not parse QA request" }], reason: "Could not parse QA request" };

  const issues: EmailQaOutput["issues"] = [];
  const text = `${req.subject}\n${req.body}`;

  if (PLACEHOLDER_RE.test(text)) issues.push({ severity: "FAIL", note: "Unfilled placeholder token found in the draft." });
  if (req.recipient.fullName) {
    const firstName = req.recipient.fullName.split(" ")[0]!;
    if (!text.toLowerCase().includes(firstName.toLowerCase()) && !text.toLowerCase().includes("hi there")) {
      issues.push({ severity: "WARN", note: "Draft does not address the recipient by name." });
    }
  }
  if (HYPE_RE.test(text)) issues.push({ severity: "WARN", note: "Overly hyped language." });
  if (req.subject.length > 60) issues.push({ severity: "WARN", note: "Subject line exceeds 60 characters." });
  if (req.body.split(/[.!?]\s/).length > 8) issues.push({ severity: "WARN", note: "Body is longer than the recommended ~8 sentences." });
  const mentionsCompany = text.toLowerCase().includes(req.company.name.toLowerCase());
  const mentionsHighlight = req.highlights.some((h) => text.toLowerCase().includes(h.criterionLabel.toLowerCase().split(" ")[0] ?? " "));
  if (!mentionsCompany && !mentionsHighlight) issues.push({ severity: "WARN", note: "Draft reads generic — no clear personalization to this company." });

  const verdict = issues.some((i) => i.severity === "FAIL") ? "FAIL" : issues.length > 0 ? "WARN" : "PASS";
  const reason =
    verdict === "PASS"
      ? "No issues found: grounded, on-brand, and addressed to the right recipient."
      : issues.map((i) => i.note).join(" ");
  return { verdict, issues, reason };
}
