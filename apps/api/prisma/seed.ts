/* eslint-disable no-console */
/**
 * Demo seed – see docs/schema.prisma.md "Seed data" and docs/canonical-model.md "Demo companies".
 *
 * Creates: demo user + workspace + project, the active demo ICP, a mock_apollo data source with 8 raw
 * source records, normalized companies with an append-only attribute ledger + provenance, people, and one
 * completed workflow run with prospects, qualification results (INITIAL + POST_ENRICHMENT), evidence,
 * enrichment runs and mock AI runs – so the Phase 1 UI has realistic data from day one.
 *
 * Idempotent: re-running deletes the demo workspace/user first.
 *
 * Fixture figures are illustrative and chosen to exercise every code path; they are not claims
 * about the real companies.
 */
import { createHash } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  CANONICAL_SCHEMA_VERSION,
  employeeRangeFor,
  revenueRangeFor,
  personDedupeKey,
  type CanonicalCompany,
  type CanonicalPerson,
  type IcpDefinition,
} from "@prospect/shared";

const prisma = new PrismaClient();

const DEMO_EMAIL = "demo@databeat.io";
const DEMO_PASSWORD = "Demo1234!";
const WORKSPACE_SLUG = "databeat-demo";

const sha256 = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
const iso = (d: Date) => d.toISOString();

// ─── Demo ICP (matches docs/icp-schema.md) ───────────────────

const demoIcp: IcpDefinition = {
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
  clarifications: [
    {
      id: "clar:revenue_gt_10m:required_or_soft",
      criterionId: "revenue_gt_10m",
      type: "required_or_soft",
      severity: "MINOR",
      question: "Is revenue above $10M a hard requirement or a preference?",
      answer: null,
      proposedDefault: "Treated as a preference (soft criterion) because revenue data is often missing.",
      resolvedBy: "DEFAULT",
    },
    {
      id: "clar:hiring_salespeople:recency_window",
      criterionId: "hiring_salespeople",
      type: "recency_window",
      severity: "BLOCKING",
      question: "How recent should sales job postings be to count?",
      answer: "Last 90 days",
      resolvedBy: "USER",
    },
  ],
};

const criterionById = Object.fromEntries(demoIcp.criteria.map((c) => [c.id, c]));

// ─── Company fixtures ─────────────────────────────────────────

type Status = "PASS" | "FAIL" | "UNKNOWN";

interface Fixture {
  name: string;
  domain: string;
  industryRaw: string;
  industry: string;
  country: string;
  countryRaw: string;
  hqCity: string;
  hqState?: string;
  description: string;
  employeeCount?: number;
  revenueUsd?: number;
  enrichedRevenueUsd?: number; // supplied by mock_enrichment
  enrichmentUnavailable?: string[]; // requested but not supplied
  foundedYear: number;
  fundingStage: string;
  totalFundingUsd: number;
  stack: { raw: string; key: string; category?: string }[];
  stackAuthoritative: boolean;
  hiring: { title: string; department: string; daysAgo: number }[];
  hiringAuthoritative: boolean;
  people: CanonicalPerson[];
  // qualification outcome (POST_ENRICHMENT) – deliberately hardcoded fixture, not engine output
  results: Record<string, { status: Status; reason: string; confidence?: number; evaluator?: "LLM" }>;
  initialOverrides?: Record<string, { status: Status; reason: string }>;
  finalStatus: "QUALIFIED" | "DISQUALIFIED" | "NEEDS_REVIEW";
}

const fixtures: Fixture[] = [
  {
    name: "Databricks", domain: "databricks.com", industryRaw: "Software", industry: "software_saas",
    country: "US", countryRaw: "United States", hqCity: "San Francisco", hqState: "CA",
    description: "Data intelligence platform unifying data, analytics and AI.",
    employeeCount: 7000, revenueUsd: 1_600_000_000, foundedYear: 2013, fundingStage: "series_d_plus", totalFundingUsd: 4_000_000_000,
    stack: [{ raw: "Salesforce CRM", key: "salesforce", category: "crm" }, { raw: "Marketo", key: "marketo", category: "marketing_automation" }, { raw: "Workday", key: "workday", category: "hr" }],
    stackAuthoritative: true,
    hiring: [{ title: "Enterprise Account Executive", department: "sales", daysAgo: 12 }, { title: "Sales Development Representative", department: "sales", daysAgo: 20 }],
    hiringAuthoritative: true,
    people: [{ fullName: "Priya Raman", title: "VP Sales, Enterprise", seniority: "vp", department: "sales", email: "priya.raman@databricks.example" }],
    results: {
      industry_saas: { status: "PASS", reason: "industry 'software_saas' is in [software_saas]" },
      country_us: { status: "PASS", reason: "country 'US' equals 'US'" },
      employees_100_500: { status: "FAIL", reason: "employeeCount 7000 is outside 100-500" },
      revenue_gt_10m: { status: "PASS", reason: "revenueUsd 1,600,000,000 >= 10,000,000" },
      uses_salesforce: { status: "PASS", reason: "stack contains 'salesforce' (Salesforce CRM)" },
      hiring_salespeople: { status: "UNKNOWN", reason: "skipped: a required criterion failed, LLM assessment not run" },
    },
    finalStatus: "DISQUALIFIED",
  },
  {
    name: "Notion", domain: "notion.so", industryRaw: "SaaS", industry: "software_saas",
    country: "US", countryRaw: "USA", hqCity: "San Francisco", hqState: "CA",
    description: "Connected workspace for docs, wikis and projects.",
    employeeCount: 480, enrichedRevenueUsd: 250_000_000, foundedYear: 2013, fundingStage: "series_c", totalFundingUsd: 343_000_000,
    stack: [{ raw: "Salesforce", key: "salesforce", category: "crm" }, { raw: "Gong", key: "gong", category: "revenue_intelligence" }, { raw: "Outreach", key: "outreach", category: "sales_engagement" }],
    stackAuthoritative: true,
    hiring: [{ title: "Account Executive, Mid-Market", department: "sales", daysAgo: 9 }, { title: "Sales Manager, SMB", department: "sales", daysAgo: 31 }],
    hiringAuthoritative: true,
    people: [
      { fullName: "Daniel Okafor", title: "VP Sales", seniority: "vp", department: "sales", email: "daniel.okafor@notion.example" },
      { fullName: "Mei Tanaka", title: "Head of Revenue Operations", seniority: "director", department: "sales", email: "mei.tanaka@notion.example" },
    ],
    results: {
      industry_saas: { status: "PASS", reason: "industry 'software_saas' is in [software_saas]" },
      country_us: { status: "PASS", reason: "country 'US' equals 'US'" },
      employees_100_500: { status: "PASS", reason: "employeeCount 480 is within 100-500" },
      revenue_gt_10m: { status: "PASS", reason: "revenueUsd 250,000,000 >= 10,000,000 (enriched by mock_enrichment)" },
      uses_salesforce: { status: "PASS", reason: "stack contains 'salesforce' (Salesforce)" },
      hiring_salespeople: { status: "PASS", reason: "Two open sales roles posted within 90 days: Account Executive, Mid-Market (9 days ago) and Sales Manager, SMB (31 days ago).", confidence: 88, evaluator: "LLM" },
    },
    initialOverrides: { revenue_gt_10m: { status: "UNKNOWN", reason: "missing: firmographics.revenueUsd" } },
    finalStatus: "QUALIFIED",
  },
  {
    name: "Figma", domain: "figma.com", industryRaw: "Computer Software", industry: "software_saas",
    country: "US", countryRaw: "United States", hqCity: "San Francisco", hqState: "CA",
    description: "Collaborative interface design platform.",
    employeeCount: 1300, revenueUsd: 600_000_000, foundedYear: 2012, fundingStage: "series_d_plus", totalFundingUsd: 333_000_000,
    stack: [{ raw: "Salesforce Sales Cloud", key: "salesforce", category: "crm" }, { raw: "Gainsight", key: "gainsight", category: "customer_success" }],
    stackAuthoritative: true,
    hiring: [{ title: "Account Executive, Enterprise", department: "sales", daysAgo: 5 }],
    hiringAuthoritative: true,
    people: [{ fullName: "Lucas Moreau", title: "Director of Sales", seniority: "director", department: "sales", email: "lucas.moreau@figma.example" }],
    results: {
      industry_saas: { status: "PASS", reason: "industry 'software_saas' is in [software_saas]" },
      country_us: { status: "PASS", reason: "country 'US' equals 'US'" },
      employees_100_500: { status: "FAIL", reason: "employeeCount 1300 is outside 100-500" },
      revenue_gt_10m: { status: "PASS", reason: "revenueUsd 600,000,000 >= 10,000,000" },
      uses_salesforce: { status: "PASS", reason: "stack contains 'salesforce' (Salesforce Sales Cloud)" },
      hiring_salespeople: { status: "UNKNOWN", reason: "skipped: a required criterion failed, LLM assessment not run" },
    },
    finalStatus: "DISQUALIFIED",
  },
  {
    name: "Canva", domain: "canva.com", industryRaw: "SaaS", industry: "software_saas",
    country: "AU", countryRaw: "Australia", hqCity: "Sydney", hqState: "NSW",
    description: "Online visual communication and design platform.",
    employeeCount: 4500, revenueUsd: 2_000_000_000, foundedYear: 2013, fundingStage: "series_d_plus", totalFundingUsd: 580_000_000,
    stack: [{ raw: "HubSpot CRM", key: "hubspot_crm", category: "crm" }, { raw: "Zendesk", key: "zendesk", category: "support" }],
    stackAuthoritative: true,
    hiring: [{ title: "Enterprise Account Executive", department: "sales", daysAgo: 14 }],
    hiringAuthoritative: true,
    people: [{ fullName: "Sophie Nguyen", title: "Head of Sales, APAC", seniority: "director", department: "sales", email: "sophie.nguyen@canva.example" }],
    results: {
      industry_saas: { status: "PASS", reason: "industry 'software_saas' is in [software_saas]" },
      country_us: { status: "FAIL", reason: "country 'AU' does not equal 'US'" },
      employees_100_500: { status: "FAIL", reason: "employeeCount 4500 is outside 100-500" },
      revenue_gt_10m: { status: "PASS", reason: "revenueUsd 2,000,000,000 >= 10,000,000" },
      uses_salesforce: { status: "FAIL", reason: "authoritative stack [hubspot_crm, zendesk] does not contain 'salesforce'" },
      hiring_salespeople: { status: "UNKNOWN", reason: "skipped: a required criterion failed, LLM assessment not run" },
    },
    finalStatus: "DISQUALIFIED",
  },
  {
    name: "Stripe", domain: "stripe.com", industryRaw: "Financial Services", industry: "fintech_payments",
    country: "US", countryRaw: "U.S.", hqCity: "San Francisco", hqState: "CA",
    description: "Financial infrastructure platform for the internet.",
    employeeCount: 8000, revenueUsd: 5_000_000_000, foundedYear: 2010, fundingStage: "series_d_plus", totalFundingUsd: 8_700_000_000,
    stack: [{ raw: "Salesforce", key: "salesforce", category: "crm" }, { raw: "Marketo", key: "marketo", category: "marketing_automation" }],
    stackAuthoritative: true,
    hiring: [{ title: "Account Executive, Startups", department: "sales", daysAgo: 3 }],
    hiringAuthoritative: true,
    people: [{ fullName: "Amara Osei", title: "VP Sales, Americas", seniority: "vp", department: "sales", email: "amara.osei@stripe.example" }],
    results: {
      industry_saas: { status: "FAIL", reason: "industry 'fintech_payments' is not in [software_saas]" },
      country_us: { status: "PASS", reason: "country 'US' equals 'US'" },
      employees_100_500: { status: "FAIL", reason: "employeeCount 8000 is outside 100-500" },
      revenue_gt_10m: { status: "PASS", reason: "revenueUsd 5,000,000,000 >= 10,000,000" },
      uses_salesforce: { status: "PASS", reason: "stack contains 'salesforce' (Salesforce)" },
      hiring_salespeople: { status: "UNKNOWN", reason: "skipped: a required criterion failed, LLM assessment not run" },
    },
    finalStatus: "DISQUALIFIED",
  },
  {
    name: "Linear", domain: "linear.app", industryRaw: "B2B SaaS", industry: "software_saas",
    country: "US", countryRaw: "United States", hqCity: "San Francisco", hqState: "CA",
    description: "Issue tracking and product planning for modern software teams.",
    // employeeCount intentionally missing and unavailable from enrichment -> required UNKNOWN -> NEEDS_REVIEW
    enrichmentUnavailable: ["firmographics.employeeCount", "firmographics.revenueUsd"],
    foundedYear: 2019, fundingStage: "series_b", totalFundingUsd: 52_000_000,
    stack: [], stackAuthoritative: false,
    hiring: [], hiringAuthoritative: true,
    people: [{ fullName: "Jonas Lindqvist", title: "Head of Go-to-Market", seniority: "director", department: "sales", email: "jonas.lindqvist@linear.example" }],
    results: {
      industry_saas: { status: "PASS", reason: "industry 'software_saas' is in [software_saas]" },
      country_us: { status: "PASS", reason: "country 'US' equals 'US'" },
      employees_100_500: { status: "UNKNOWN", reason: "missing: firmographics.employeeCount (enrichment: unavailable from mock_enrichment)" },
      revenue_gt_10m: { status: "UNKNOWN", reason: "missing: firmographics.revenueUsd (enrichment: unavailable from mock_enrichment)" },
      uses_salesforce: { status: "UNKNOWN", reason: "stack is empty and not authoritative; absence cannot be inferred" },
      hiring_salespeople: { status: "FAIL", reason: "Hiring evidence is authoritative and contains no open roles; no sales or revenue positions are being hired for.", confidence: 90, evaluator: "LLM" },
    },
    initialOverrides: {
      employees_100_500: { status: "UNKNOWN", reason: "missing: firmographics.employeeCount" },
      revenue_gt_10m: { status: "UNKNOWN", reason: "missing: firmographics.revenueUsd" },
    },
    finalStatus: "NEEDS_REVIEW",
  },
  {
    name: "Webflow", domain: "webflow.com", industryRaw: "SaaS", industry: "software_saas",
    country: "US", countryRaw: "United States of America", hqCity: "San Francisco", hqState: "CA",
    description: "Visual web development platform for designers and marketers.",
    employeeCount: 450, enrichedRevenueUsd: 150_000_000, foundedYear: 2013, fundingStage: "series_c", totalFundingUsd: 335_000_000,
    stack: [{ raw: "Salesforce", key: "salesforce", category: "crm" }, { raw: "HubSpot Marketing Hub", key: "hubspot_marketing_hub", category: "marketing_automation" }, { raw: "6sense", key: "6sense", category: "abm" }],
    stackAuthoritative: true,
    hiring: [{ title: "Account Executive, Enterprise", department: "sales", daysAgo: 7 }, { title: "Sales Development Representative", department: "sales", daysAgo: 18 }],
    hiringAuthoritative: true,
    people: [
      { fullName: "Hannah Cole", title: "VP Sales", seniority: "vp", department: "sales", email: "hannah.cole@webflow.example" },
      { fullName: "Ravi Menon", title: "Director, Revenue Operations", seniority: "director", department: "sales", email: "ravi.menon@webflow.example" },
    ],
    results: {
      industry_saas: { status: "PASS", reason: "industry 'software_saas' is in [software_saas]" },
      country_us: { status: "PASS", reason: "country 'US' equals 'US'" },
      employees_100_500: { status: "PASS", reason: "employeeCount 450 is within 100-500" },
      revenue_gt_10m: { status: "PASS", reason: "revenueUsd 150,000,000 >= 10,000,000 (enriched by mock_enrichment)" },
      uses_salesforce: { status: "PASS", reason: "stack contains 'salesforce' (Salesforce)" },
      hiring_salespeople: { status: "PASS", reason: "Two open sales roles posted within 90 days: Account Executive, Enterprise (7 days ago) and Sales Development Representative (18 days ago).", confidence: 91, evaluator: "LLM" },
    },
    initialOverrides: { revenue_gt_10m: { status: "UNKNOWN", reason: "missing: firmographics.revenueUsd" } },
    finalStatus: "QUALIFIED",
  },
  {
    name: "Slack", domain: "slack.com", industryRaw: "Software", industry: "software_saas",
    country: "US", countryRaw: "United States", hqCity: "San Francisco", hqState: "CA",
    description: "Messaging platform for teams.",
    employeeCount: 2500, revenueUsd: 1_500_000_000, foundedYear: 2009, fundingStage: "acquired", totalFundingUsd: 1_400_000_000,
    stack: [{ raw: "Salesforce", key: "salesforce", category: "crm" }, { raw: "Marketo", key: "marketo", category: "marketing_automation" }],
    stackAuthoritative: true,
    hiring: [{ title: "Senior Software Engineer, Infrastructure", department: "engineering", daysAgo: 4 }, { title: "Staff Engineer, Search", department: "engineering", daysAgo: 11 }],
    hiringAuthoritative: true,
    people: [{ fullName: "Grace Whitfield", title: "VP Sales", seniority: "vp", department: "sales", email: "grace.whitfield@slack.example" }],
    results: {
      industry_saas: { status: "PASS", reason: "industry 'software_saas' is in [software_saas]" },
      country_us: { status: "PASS", reason: "country 'US' equals 'US'" },
      employees_100_500: { status: "FAIL", reason: "employeeCount 2500 is outside 100-500" },
      revenue_gt_10m: { status: "PASS", reason: "revenueUsd 1,500,000,000 >= 10,000,000" },
      uses_salesforce: { status: "PASS", reason: "stack contains 'salesforce' (Salesforce)" },
      hiring_salespeople: { status: "UNKNOWN", reason: "skipped: a required criterion failed, LLM assessment not run" },
    },
    finalStatus: "DISQUALIFIED",
  },
];

// ─── Scoring helper (mirrors docs/icp-schema.md "Scoring") ───

function computeScore(results: Record<string, { status: Status }>) {
  let known = 0;
  let pass = 0;
  let all = 0;
  for (const c of demoIcp.criteria) {
    all += c.weight;
    const s = results[c.id]?.status;
    if (s === "PASS" || s === "FAIL") {
      known += c.weight;
      if (s === "PASS") pass += c.weight;
    }
  }
  if (known === 0) return { score: null as number | null, coverage: 0 };
  return { score: Math.round((100 * pass) / known), coverage: Math.round((100 * known) / all) };
}

// ─── Raw payload (Apollo-like shape, stored verbatim) ────────

function rawPayloadFor(f: Fixture) {
  return {
    id: `mock_${f.domain.replace(/\W/g, "_")}`,
    name: f.name,
    website_url: `https://www.${f.domain}`,
    primary_domain: f.domain,
    industry: f.industryRaw,
    short_description: f.description,
    country: f.countryRaw,
    city: f.hqCity,
    state: f.hqState ?? null,
    estimated_num_employees: f.employeeCount ?? null,
    annual_revenue: f.revenueUsd ?? null,
    founded_year: f.foundedYear,
    latest_funding_stage: f.fundingStage,
    total_funding: f.totalFundingUsd,
    technologies: f.stack.map((s) => ({ name: s.raw, category: s.category })),
    technologies_complete: f.stackAuthoritative,
    job_postings: f.hiring.map((h) => ({ title: h.title, department: h.department, posted_at: iso(daysAgo(h.daysAgo)), url: `https://jobs.${f.domain}/${h.title.toLowerCase().replace(/[^a-z]+/g, "-")}` })),
    job_postings_complete: f.hiringAuthoritative,
    people: f.people.map((p) => ({ name: p.fullName, title: p.title, email: p.email, seniority: p.seniority, department: p.department })),
  };
}

// ─── Seed ─────────────────────────────────────────────────────

async function main() {
  console.log("Seeding demo data …");

  // Idempotent reset of demo tenant
  await prisma.workspace.deleteMany({ where: { slug: WORKSPACE_SLUG } });
  await prisma.user.deleteMany({ where: { email: DEMO_EMAIL } });

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = await prisma.user.create({ data: { email: DEMO_EMAIL, passwordHash, name: "Demo User" } });

  const workspace = await prisma.workspace.create({
    data: {
      name: "Databeat Demo",
      slug: WORKSPACE_SLUG,
      settings: {
        aiProviderKey: "mock",
        enrichmentProviderKey: "mock_enrichment",
        outboundProviderKey: "simulated",
        sourcePrecedence: ["MANUAL", "ENRICHMENT", "SOURCE", "NORMALIZER", "AI"],
      },
      members: { create: { userId: user.id, role: "OWNER" } },
    },
  });

  const project = await prisma.project.create({
    data: {
      workspaceId: workspace.id,
      name: "US SaaS Sales Expansion",
      description: "Mid-market US SaaS companies running Salesforce that are actively hiring sales roles.",
      status: "ACTIVE",
    },
  });

  const secondProject = await prisma.project.create({
    data: {
      workspaceId: workspace.id,
      name: "EU Fintech Pilot",
      description: "Draft project – ICP not yet defined.",
      status: "DRAFT",
    },
  });
  void secondProject;

  const icp = await prisma.icpProfile.create({
    data: {
      projectId: project.id,
      version: 1,
      status: "ACTIVE",
      naturalLanguage:
        "We sell to US-based SaaS companies with 100 to 500 employees and more than $10M revenue. They should already use Salesforce. Ideally they are hiring salespeople right now.",
      definition: demoIcp as unknown as Prisma.InputJsonValue,
      chatTranscript: [
        { role: "user", content: "We sell to US-based SaaS companies with 100 to 500 employees and more than $10M revenue. They should already use Salesforce. Ideally they are hiring salespeople right now.", at: iso(daysAgo(6)) },
        { role: "assistant", content: "I drafted six criteria. One question: how recent should sales job postings be to count? I suggest the last 90 days.", at: iso(daysAgo(6)) },
        { role: "user", content: "Last 90 days.", at: iso(daysAgo(6)) },
        { role: "assistant", content: "Done. Revenue above $10M is treated as a preference rather than a hard requirement because revenue data is often missing; you can change that in the editor.", at: iso(daysAgo(6)) },
      ] as Prisma.InputJsonValue,
      blockingOpenCount: 0,
      createdById: user.id,
      activatedAt: daysAgo(6),
    },
  });

  const dataSource = await prisma.dataSource.create({
    data: {
      projectId: project.id,
      type: "API",
      providerKey: "mock_apollo",
      name: "Mock Apollo – US SaaS list",
      config: { filters: { domains: fixtures.map((f) => f.domain) }, pageSize: 25, maxRecords: 200 },
      status: "SYNCED",
      lastSyncedAt: daysAgo(2),
      recordCount: fixtures.length,
    },
  });

  const run = await prisma.workflowRun.create({
    data: {
      projectId: project.id,
      icpProfileId: icp.id,
      status: "COMPLETED",
      triggeredById: user.id,
      options: { dataSourceIds: [dataSource.id], refreshSources: false, enrich: true, generateEmails: false, maxLlmProspects: 50 },
      currentStep: "AWAIT_REVIEW",
      startedAt: daysAgo(2),
      finishedAt: new Date(daysAgo(2).getTime() + 95_000),
    },
  });

  const stepKeys = ["INGEST", "NORMALIZE", "QUALIFY", "ENRICH", "REQUALIFY", "GENERATE_EMAIL", "QA", "AWAIT_REVIEW"] as const;
  let t = daysAgo(2).getTime();
  for (const [i, key] of stepKeys.entries()) {
    const skipped = key === "GENERATE_EMAIL" || key === "QA";
    const dur = key === "REQUALIFY" ? 32_000 : key === "ENRICH" ? 21_000 : 6_000;
    await prisma.workflowStep.create({
      data: {
        workflowRunId: run.id,
        stepKey: key,
        order: i,
        status: skipped ? "SKIPPED" : "SUCCEEDED",
        inputHash: sha256([run.id, key]),
        output: skipped ? { reason: "options.generateEmails = false" } : { ok: true },
        startedAt: new Date(t),
        finishedAt: new Date(t + (skipped ? 50 : dur)),
      },
    });
    t += skipped ? 50 : dur;
  }

  let qualified = 0;
  let disqualified = 0;
  let needsReview = 0;
  let enriched = 0;
  let llmCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const f of fixtures) {
    const raw = rawPayloadFor(f);
    const observedAt = daysAgo(2);

    const record = await prisma.sourceRecord.create({
      data: {
        dataSourceId: dataSource.id,
        externalId: raw.id,
        rawPayload: raw as unknown as Prisma.InputJsonValue,
        payloadHash: sha256(raw),
        fetchedAt: observedAt,
      },
    });

    const company = await prisma.company.create({
      data: {
        workspaceId: workspace.id,
        projectId: project.id,
        name: f.name,
        domain: f.domain,
        website: `https://www.${f.domain}`,
        industry: f.industry,
        industryRaw: f.industryRaw,
        description: f.description,
        country: f.country,
        hqCity: f.hqCity,
        hqState: f.hqState ?? null,
        foundedYear: f.foundedYear,
        fundingStage: f.fundingStage,
        totalFundingUsd: BigInt(f.totalFundingUsd),
        techStack: f.stack.map((s) => s.key),
      },
    });

    // ── Append-only attribute ledger (SOURCE observations) ──
    const attrIds: Record<string, string> = {};
    const addAttr = async (
      field: string,
      value: unknown,
      sourceType: "SOURCE" | "NORMALIZER" | "ENRICHMENT",
      providerKey: string,
      extra: { enrichmentRunId?: string; observedAt?: Date; confidence?: number } = {},
    ) => {
      const a = await prisma.companyAttribute.create({
        data: {
          companyId: company.id,
          field,
          value: value as Prisma.InputJsonValue,
          sourceType,
          providerKey,
          sourceRecordId: sourceType === "SOURCE" || sourceType === "NORMALIZER" ? record.id : null,
          enrichmentRunId: extra.enrichmentRunId ?? null,
          confidence: extra.confidence ?? (sourceType === "ENRICHMENT" ? 85 : 100),
          observedAt: extra.observedAt ?? observedAt,
        },
      });
      attrIds[field] = a.id;
      return a;
    };

    await addAttr("identity.name", f.name, "SOURCE", "mock_apollo");
    await addAttr("identity.domain", f.domain, "SOURCE", "mock_apollo");
    await addAttr("firmographics.industry", f.industry, "SOURCE", "mock_apollo");
    await addAttr("firmographics.description", f.description, "SOURCE", "mock_apollo");
    await addAttr("firmographics.country", f.country, "SOURCE", "mock_apollo");
    await addAttr("firmographics.hqCity", f.hqCity, "SOURCE", "mock_apollo");
    await addAttr("firmographics.foundedYear", f.foundedYear, "SOURCE", "mock_apollo");
    await addAttr("firmographics.fundingStage", f.fundingStage, "SOURCE", "mock_apollo");
    await addAttr("firmographics.totalFundingUsd", f.totalFundingUsd, "SOURCE", "mock_apollo");
    if (f.employeeCount !== undefined) {
      await addAttr("firmographics.employeeCount", f.employeeCount, "SOURCE", "mock_apollo");
      await addAttr("firmographics.employeeRange", employeeRangeFor(f.employeeCount), "NORMALIZER", "normalizer");
    }
    if (f.revenueUsd !== undefined) {
      await addAttr("firmographics.revenueUsd", f.revenueUsd, "SOURCE", "mock_apollo");
      await addAttr("firmographics.revenueRange", revenueRangeFor(f.revenueUsd), "NORMALIZER", "normalizer");
    }
    const stackGroup = { items: f.stack.map((s) => ({ key: s.key, raw: s.raw, category: s.category })), authoritative: f.stackAuthoritative, checkedAt: iso(observedAt) };
    await addAttr("technographics.stack", stackGroup, "SOURCE", "mock_apollo");
    const hiringGroup = {
      items: f.hiring.map((h) => ({ title: h.title, department: h.department, postedAt: iso(daysAgo(h.daysAgo)), url: `https://jobs.${f.domain}/${h.title.toLowerCase().replace(/[^a-z]+/g, "-")}` })),
      authoritative: f.hiringAuthoritative,
      checkedAt: iso(observedAt),
    };
    await addAttr("signals.hiring", hiringGroup, "SOURCE", "mock_apollo");

    // ── People (authoritative contact store) ──
    for (const p of f.people) {
      await prisma.person.create({
        data: {
          companyId: company.id,
          dedupeKey: personDedupeKey(p),
          fullName: p.fullName,
          title: p.title ?? null,
          seniority: p.seniority ?? null,
          department: p.department ?? null,
          email: p.email ?? null,
          providerKey: "mock_apollo",
        },
      });
    }

    // ── Enrichment (only where the workflow requested missing fields) ──
    const requested: string[] = [];
    if (f.employeeCount === undefined) requested.push("firmographics.employeeCount");
    if (f.revenueUsd === undefined) requested.push("firmographics.revenueUsd");
    const hardFailed = demoIcp.criteria.some((c) => c.required && f.results[c.id]?.status === "FAIL");

    let finalRevenue = f.revenueUsd;
    if (requested.length > 0 && !hardFailed) {
      const supplied = f.enrichedRevenueUsd !== undefined ? ["firmographics.revenueUsd"] : [];
      const unavailable = requested.filter((r) => !supplied.includes(r));
      const enrichmentRun = await prisma.enrichmentRun.create({
        data: {
          companyId: company.id,
          workflowRunId: run.id,
          providerKey: "mock_enrichment",
          requestedFields: requested,
          suppliedFields: supplied,
          unavailableFields: unavailable,
          status: supplied.length === requested.length ? "SUCCEEDED" : supplied.length > 0 ? "PARTIAL" : "PARTIAL",
          costUnits: 1,
          rawResponse: { domain: f.domain, supplied: supplied.length ? { revenueUsd: f.enrichedRevenueUsd } : {}, unavailable },
          startedAt: new Date(daysAgo(2).getTime() + 20_000),
          finishedAt: new Date(daysAgo(2).getTime() + 20_400),
        },
      });
      if (f.enrichedRevenueUsd !== undefined) {
        await addAttr("firmographics.revenueUsd", f.enrichedRevenueUsd, "ENRICHMENT", "mock_enrichment", { enrichmentRunId: enrichmentRun.id, observedAt: new Date(daysAgo(2).getTime() + 20_400), confidence: 85 });
        await addAttr("firmographics.revenueRange", revenueRangeFor(f.enrichedRevenueUsd), "NORMALIZER", "normalizer", { observedAt: new Date(daysAgo(2).getTime() + 20_500) });
        finalRevenue = f.enrichedRevenueUsd;
        enriched++;
      }
    }

    // ── Resolve: canonical snapshot + provenance (resolver output) ──
    const allAttrs = await prisma.companyAttribute.findMany({ where: { companyId: company.id }, orderBy: { observedAt: "desc" } });
    const provenance: CanonicalCompany["provenance"] = {};
    for (const a of allAttrs) {
      if (provenance[a.field]) continue; // newest first; precedence handled by construction in the seed
      const isList = a.field === "technographics.stack" || a.field === "signals.hiring";
      const authoritative = isList ? Boolean((a.value as { authoritative?: boolean }).authoritative) : false;
      provenance[a.field] = {
        attributeId: a.id,
        sourceType: a.sourceType,
        providerKey: a.providerKey,
        confidence: a.confidence,
        observedAt: iso(a.observedAt),
        authoritative,
      };
    }

    const canonical: CanonicalCompany = {
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      identity: { name: f.name, domain: f.domain, website: `https://www.${f.domain}` },
      firmographics: {
        industry: f.industry,
        industryRaw: f.industryRaw,
        description: f.description,
        country: f.country,
        hqCity: f.hqCity,
        hqState: f.hqState,
        employeeCount: f.employeeCount,
        employeeRange: f.employeeCount !== undefined ? employeeRangeFor(f.employeeCount) : undefined,
        revenueUsd: finalRevenue,
        revenueRange: finalRevenue !== undefined ? revenueRangeFor(finalRevenue) : undefined,
        foundedYear: f.foundedYear,
        fundingStage: f.fundingStage as CanonicalCompany["firmographics"]["fundingStage"],
        totalFundingUsd: f.totalFundingUsd,
      },
      technographics: { stack: stackGroup },
      signals: { hiring: hiringGroup, funding: { items: [], authoritative: false }, news: { items: [], authoritative: false }, expansion: { items: [], authoritative: false } },
      provenance,
    };

    await prisma.company.update({
      where: { id: company.id },
      data: {
        employeeCount: f.employeeCount ?? null,
        employeeRange: f.employeeCount !== undefined ? employeeRangeFor(f.employeeCount) : null,
        revenueUsd: finalRevenue !== undefined ? BigInt(finalRevenue) : null,
        revenueRange: finalRevenue !== undefined ? revenueRangeFor(finalRevenue) : null,
        canonical: canonical as unknown as Prisma.InputJsonValue,
        resolvedHash: sha256({ ...canonical, provenance: undefined }),
        normalizedAt: observedAt,
      },
    });
    await prisma.sourceRecord.update({ where: { id: record.id }, data: { normalizedCompanyId: company.id } });

    // ── Prospect + qualification results ──
    const { score, coverage } = computeScore(f.results);
    const passCount = Object.values(f.results).filter((r) => r.status === "PASS").length;
    const failCount = Object.values(f.results).filter((r) => r.status === "FAIL").length;
    const unknownCount = Object.values(f.results).filter((r) => r.status === "UNKNOWN").length;
    const requiredFails = demoIcp.criteria.filter((c) => c.required && f.results[c.id]?.status === "FAIL").map((c) => c.id);
    const missingFields = Object.entries(f.results)
      .filter(([, r]) => r.status === "UNKNOWN" && r.reason.startsWith("missing:"))
      .map(([id]) => (criterionById[id] as { field?: string }).field ?? id);

    const reasoningLines = demoIcp.criteria.map((c) => `• ${c.label}: ${f.results[c.id]!.status} — ${f.results[c.id]!.reason}`);
    const headline =
      f.finalStatus === "QUALIFIED"
        ? `Qualified with score ${score}/100 (coverage ${coverage}%). All required criteria pass.`
        : f.finalStatus === "DISQUALIFIED"
          ? `Disqualified: required criteria failed (${requiredFails.join(", ")}).`
          : `Needs review: a required criterion could not be evaluated (${Object.entries(f.results).filter(([id, r]) => r.status === "UNKNOWN" && criterionById[id]!.required).map(([id]) => id).join(", ")}).`;

    const prospect = await prisma.prospect.create({
      data: {
        projectId: project.id,
        workflowRunId: run.id,
        companyId: company.id,
        icpProfileId: icp.id,
        status: f.finalStatus,
        score,
        coverage,
        summary: { passCount, failCount, unknownCount, requiredFails, missingFields, enrichedFields: finalRevenue !== f.revenueUsd ? ["firmographics.revenueUsd"] : [], llmCalls: Object.values(f.results).filter((r) => r.evaluator === "LLM").length },
        aiReasoning: [headline, "", ...reasoningLines].join("\n"),
      },
    });

    if (f.finalStatus === "QUALIFIED") qualified++;
    else if (f.finalStatus === "DISQUALIFIED") disqualified++;
    else needsReview++;

    for (const phase of ["INITIAL", "POST_ENRICHMENT"] as const) {
      for (const c of demoIcp.criteria) {
        const finalR = f.results[c.id]!;
        const r = phase === "INITIAL" ? f.initialOverrides?.[c.id] ?? finalR : finalR;
        const isLlm = finalR.evaluator === "LLM" && phase === "POST_ENRICHMENT";
        // INITIAL phase never runs the LLM
        const status: Status = phase === "INITIAL" && c.kind === "QUALITATIVE" ? "UNKNOWN" : r.status;
        const reason = phase === "INITIAL" && c.kind === "QUALITATIVE" ? "qualitative criteria are assessed after enrichment" : r.reason;

        let aiRunId: string | null = null;
        if (isLlm) {
          const aiRun = await prisma.aiRun.create({
            data: {
              workspaceId: workspace.id,
              purpose: "QUALITATIVE_ASSESS",
              providerKey: "mock",
              model: "mock-fast",
              promptKey: "qualify.assess",
              promptVersion: 1,
              inputTokens: 640,
              outputTokens: 120,
              costUsd: 0,
              latencyMs: 310,
              input: { criterionId: c.id, question: (c as { question: string }).question, evidence: { "signals.hiring": { attributeId: attrIds["signals.hiring"], value: hiringGroup } } },
              output: { verdict: finalR.status, confidence: finalR.confidence, reason: finalR.reason, evidenceRefs: [attrIds["signals.hiring"]].filter((id): id is string => Boolean(id)) },
              status: "SUCCEEDED",
              refType: "prospect",
              refId: prospect.id,
            },
          });
          aiRunId = aiRun.id;
          llmCalls++;
          inputTokens += 640;
          outputTokens += 120;
        }

        const qr = await prisma.qualificationResult.create({
          data: {
            prospectId: prospect.id,
            criterionId: c.id,
            criterionLabel: c.label,
            phase,
            status,
            weight: c.weight,
            required: c.required,
            evaluator: c.kind === "QUALITATIVE" ? "LLM" : "DETERMINISTIC",
            reason,
            confidence: isLlm ? finalR.confidence ?? null : null,
            missingFields: status === "UNKNOWN" && reason.startsWith("missing:") ? [(c as { field?: string }).field ?? ""] : [],
            aiRunId,
          },
        });

        // Evidence for KNOWN verdicts, linked to the attribute that was used
        if (status !== "UNKNOWN") {
          const field = c.kind === "QUALITATIVE" ? "signals.hiring" : (c as { field: string }).field;
          const attributeId = attrIds[field];
          if (attributeId) {
            const attr = allAttrs.find((a) => a.id === attributeId);
            await prisma.evidence.create({
              data: {
                qualificationResultId: qr.id,
                companyAttributeId: attributeId,
                kind: field === "signals.hiring" ? "JOB_POSTING" : "FIELD_VALUE",
                content: { field, value: attr?.value ?? null, observedAt: attr ? iso(attr.observedAt) : null },
                sourceRef: `${attr?.providerKey ?? "mock_apollo"}:${field}`,
              },
            });
          }
        }
      }
    }
  }

  await prisma.workflowRun.update({
    where: { id: run.id },
    data: {
      summary: { ingested: fixtures.length, normalized: fixtures.length, evaluated: fixtures.length, qualified, disqualified, needsReview, enriched, llmCalls, inputTokens, outputTokens },
    },
  });

  await prisma.campaign.create({
    data: {
      projectId: project.id,
      name: "Q4 Salesforce mid-market outreach",
      status: "DRAFT",
      outboundProviderKey: "simulated",
      senderConfig: { fromName: "Databeat Sales", fromEmail: "sales@databeat.example", replyTo: "sales@databeat.example" },
    },
  });

  console.log(`Seed complete.
  user:       ${DEMO_EMAIL} / ${DEMO_PASSWORD}
  workspace:  ${workspace.name} (${workspace.id})
  project:    ${project.name} (${project.id})
  companies:  ${fixtures.length}  →  qualified ${qualified}, needs review ${needsReview}, disqualified ${disqualified}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
