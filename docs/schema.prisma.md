# Database Schema (Prisma)

Two schemas are described here:

1. **Live POC schema** — exactly what goes into `apps/api/prisma/schema.prisma` and its migrations. Tier 1 models only. No relations to deferred models.
2. **Production extension** — Tier 2 and Tier 3 models documented for the future. They are **not** copied into the live schema and **not** migrated in the POC.

## Implementation tiers

| Tier | Models | POC substitute |
|---|---|---|
| **1 – Live POC schema** | `User`, `Workspace`, `WorkspaceMember`, `Project`, `IcpProfile`, `DataSource`, `SourceRecord`, `Company`, `CompanyAttribute`, `Person`, `Prospect`, `QualificationResult`, `Evidence`, `EnrichmentRun`, `AiRun`, `WorkflowRun`, `WorkflowStep`, `Campaign`, `Message` | – |
| **2 – If time permits (Phase 7)** | `UsageLog`, `AuditLog` | Analytics/usage derived from `AiRun`, `EnrichmentRun`, `Prospect`, `Message`. Review actions recorded on `Message.reviewedById/reviewedAt`. |
| **3 – Production path only** | `DataSourceConnection`, `ProviderConfig`, `Contact`, `UnmappedTerm` | Provider credentials from environment variables. Provider selection in `Workspace.settings`. Contact details inline on `Person.email` / `Person.phone`. Unmapped dictionary terms go to the structured application log. |

Conventions

- Every table has `id` (uuid), `createdAt`, `updatedAt`.
- Tenant-scoped rows carry `workspaceId` and are always queried through it.
- Raw data (`SourceRecord.rawPayload`) is never mutated. Normalized data lives in `Company` and its append-only provenance ledger `CompanyAttribute`.
- **All scores, coverage values, thresholds and confidences are integers 0–100** in the DB, engine, API and UI. Criterion weights are integers 0–10 and are not percentages.
- JSON columns holding structured documents (ICP definition, canonical snapshot, QA result) are validated with the matching Zod schema from `packages/shared` before write.
- Enums are Prisma enums so the DB rejects unknown states.

---

## 1. Live POC schema (`apps/api/prisma/schema.prisma`)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Identity & tenancy ──────────────────────────────────────

model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String
  name         String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  memberships  WorkspaceMember[]
  icpProfiles  IcpProfile[]  @relation("icpCreatedBy")
  reviewedMsgs Message[]     @relation("reviewedBy")
  workflowRuns WorkflowRun[] @relation("triggeredBy")

  @@map("users")
}

model Workspace {
  id        String   @id @default(uuid())
  name      String
  slug      String   @unique
  // Provider selection for the POC. Credentials come from environment variables.
  // { aiProviderKey: "anthropic", enrichmentProviderKey: "mock_enrichment",
  //   outboundProviderKey: "simulated",
  //   sourcePrecedence: ["MANUAL","ENRICHMENT","SOURCE","NORMALIZER","AI"] }
  settings  Json     @default("{}")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  members   WorkspaceMember[]
  projects  Project[]
  companies Company[]
  aiRuns    AiRun[]

  @@map("workspaces")
}

enum WorkspaceRole {
  OWNER
  ADMIN
  MEMBER
}

model WorkspaceMember {
  id          String        @id @default(uuid())
  workspaceId String
  userId      String
  role        WorkspaceRole @default(MEMBER)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, userId])
  @@map("workspace_members")
}

// ─── Projects & ICP ──────────────────────────────────────────

enum ProjectStatus {
  DRAFT
  ACTIVE
  ARCHIVED
}

model Project {
  id          String        @id @default(uuid())
  workspaceId String
  name        String
  description String?
  status      ProjectStatus @default(DRAFT)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  workspace    Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  icpProfiles  IcpProfile[]
  dataSources  DataSource[]
  companies    Company[]
  prospects    Prospect[]
  workflowRuns WorkflowRun[]
  campaigns    Campaign[]
  messages     Message[]

  @@index([workspaceId])
  @@map("projects")
}

enum IcpStatus {
  DRAFT
  ACTIVE
  ARCHIVED
}

model IcpProfile {
  id                String    @id @default(uuid())
  projectId         String
  version           Int
  status            IcpStatus @default(DRAFT)
  naturalLanguage   String                   // consolidated user description
  definition        Json                     // IcpDefinition (Zod-validated, docs/icp-schema.md)
  chatTranscript    Json      @default("[]") // [{ role, content, at }]
  // Activation guard: the service refuses status=ACTIVE while any clarification
  // with severity=BLOCKING has resolvedBy != USER. Denormalized for cheap checks.
  blockingOpenCount Int       @default(0)
  createdById       String?
  activatedAt       DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  project      Project       @relation(fields: [projectId], references: [id], onDelete: Cascade)
  createdBy    User?         @relation("icpCreatedBy", fields: [createdById], references: [id])
  prospects    Prospect[]
  workflowRuns WorkflowRun[]

  @@unique([projectId, version])
  @@index([projectId, status])
  @@map("icp_profiles")
}

// ─── Data sources & raw records ──────────────────────────────

enum DataSourceType {
  CSV
  API
}

enum DataSourceStatus {
  DRAFT    // mapping / config not complete
  READY    // mapping confirmed or provider reachable
  SYNCING
  SYNCED
  ERROR
  ARCHIVED // soft-deleted; SourceRecords and provenance are preserved
}

model DataSource {
  id           String           @id @default(uuid())
  projectId    String
  type         DataSourceType
  providerKey  String           // "csv" | "mock_apollo" | "apollo"
  name         String
  // CSV: { fileName, delimiter, columns[], mapping: { header -> canonicalFieldPath|null }, sampleRows[] }
  // API: { filters: {...}, pageSize, maxRecords }   (credentials come from env)
  config       Json             @default("{}")
  status       DataSourceStatus @default(DRAFT)
  lastSyncedAt DateTime?
  recordCount  Int              @default(0)
  lastError    String?
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt

  project       Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  sourceRecords SourceRecord[]

  @@index([projectId])
  @@map("data_sources")
}

model SourceRecord {
  id                  String   @id @default(uuid())
  dataSourceId        String
  externalId          String?  // provider id or CSV row number
  rawPayload          Json     // never mutated
  payloadHash         String   // sha256(rawPayload) for idempotent re-sync
  fetchedAt           DateTime @default(now())
  normalizedCompanyId String?
  normalizationError  String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  dataSource        DataSource         @relation(fields: [dataSourceId], references: [id], onDelete: Cascade)
  normalizedCompany Company?           @relation(fields: [normalizedCompanyId], references: [id])
  attributes        CompanyAttribute[]

  @@unique([dataSourceId, payloadHash])
  @@index([dataSourceId])
  @@index([normalizedCompanyId])
  @@map("source_records")
}

// ─── Canonical company + provenance ledger ───────────────────

model Company {
  id          String  @id @default(uuid())
  workspaceId String
  projectId   String
  // identity
  name        String
  domain      String?  // lowercased, no protocol, no www
  website     String?
  linkedinUrl String?
  // firmographics – resolved "current" values; provenance in CompanyAttribute
  industry        String?   // normalized key, e.g. "software_saas"
  industryRaw     String?
  subIndustry     String?
  description     String?
  country         String?   // ISO-3166-1 alpha-2
  hqCity          String?
  hqState         String?
  employeeCount   Int?
  employeeRange   String?   // "1-10" | "11-50" | "51-200" | "201-500" | "501-1000" | "1001-5000" | "5001-10000" | "10001+"
  revenueUsd      BigInt?
  revenueRange    String?   // "<1M" | "1M-10M" | "10M-50M" | "50M-100M" | "100M-500M" | "500M-1B" | ">1B"
  foundedYear     Int?
  fundingStage    String?   // "bootstrapped" | "seed" | "series_a" | ... | "public"
  totalFundingUsd BigInt?
  lastFundingDate DateTime?
  // technographics
  techStack       String[]  @default([])  // normalized keys, e.g. ["salesforce","hubspot"]
  // full canonical snapshot: Zod CanonicalCompany (identity, firmographics, technographics,
  // signals with authoritative flags, provenance). People are NOT here; Person table is authoritative.
  canonical              Json      @default("{}")
  canonicalSchemaVersion Int       @default(1)
  resolvedHash           String?   // sha256(canonical) – cache key for LLM assessments
  // Data-quality flag set by CompanyMatcher when a record had no domain and normalized-name
  // matching was ambiguous, so a new company was created instead of merging. Shown as a UI warning.
  possibleDuplicate      Boolean   @default(false)
  normalizedAt           DateTime?
  createdAt              DateTime  @default(now())
  updatedAt              DateTime  @updatedAt

  workspace      Workspace          @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  project        Project            @relation(fields: [projectId], references: [id], onDelete: Cascade)
  sourceRecords  SourceRecord[]
  attributes     CompanyAttribute[]
  people         Person[]
  prospects      Prospect[]
  enrichmentRuns EnrichmentRun[]
  messages       Message[]

  @@unique([projectId, domain])
  @@index([workspaceId])
  @@index([projectId, name])
  @@map("companies")
}

enum AttributeSourceType {
  SOURCE      // from a data source record
  ENRICHMENT  // from an enrichment provider
  MANUAL      // user override
  NORMALIZER  // derived deterministically (e.g. employeeRange from employeeCount)
  AI          // derived by an LLM; lowest precedence, kept for traceability only
}

// Append-only observation ledger. The same provider may report different values
// over time, so there is deliberately NO uniqueness on (company, field, provider).
// The resolver reads the newest observation per (field, precedence) at query time.
model CompanyAttribute {
  id              String              @id @default(uuid())
  companyId       String
  field           String              // canonical path, e.g. "firmographics.employeeCount"
  value           Json
  sourceType      AttributeSourceType
  providerKey     String              // "csv" | "mock_apollo" | "mock_enrichment" | "user" | "normalizer"
  sourceRecordId  String?
  enrichmentRunId String?
  confidence      Int                 @default(100) // 0-100
  observedAt      DateTime            @default(now())
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  company       Company        @relation(fields: [companyId], references: [id], onDelete: Cascade)
  sourceRecord  SourceRecord?  @relation(fields: [sourceRecordId], references: [id])
  enrichmentRun EnrichmentRun? @relation(fields: [enrichmentRunId], references: [id])
  evidence      Evidence[]

  // resolver: WHERE companyId=? AND field=? ORDER BY observedAt DESC
  @@index([companyId, field, observedAt(sort: Desc)])
  // "what did this provider change" / enrichment diffs
  @@index([companyId, providerKey, observedAt(sort: Desc)])
  @@index([enrichmentRunId])
  @@map("company_attributes")
}

// Authoritative contact store. Upsert key = (companyId, dedupeKey).
// dedupeKey = lowercase(trim(email)) when email present, else "name:" + normalize(fullName) + "|" + normalize(title ?? "").
model Person {
  id          String   @id @default(uuid())
  companyId   String
  dedupeKey   String
  fullName    String
  title       String?
  seniority   String?  // "c_level" | "vp" | "director" | "manager" | "ic"
  department  String?  // "sales" | "marketing" | "engineering" | ...
  email       String?  // contact detail inline for the POC
  phone       String?
  linkedinUrl String?
  providerKey String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  company  Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)
  messages Message[]

  @@unique([companyId, dedupeKey])
  @@index([companyId])
  @@map("people")
}

// ─── Qualification ───────────────────────────────────────────

enum ProspectStatus {
  PENDING
  QUALIFIED
  DISQUALIFIED
  NEEDS_REVIEW
}

model Prospect {
  id            String         @id @default(uuid())
  projectId     String
  workflowRunId String
  companyId     String
  icpProfileId  String
  status        ProspectStatus @default(PENDING)
  // score: nullable 0-100 weighted PASS ratio over KNOWN criteria.
  // When the sum of KNOWN criterion weights is 0 (no usable evidence): score = null,
  // coverage = 0, status = NEEDS_REVIEW. Lack of evidence is never represented as score 0.
  score         Int?
  coverage      Int?           // 0-100 share of criterion weight with a known verdict
  // { passCount, failCount, unknownCount, requiredFails[], missingFields[], enrichedFields[], llmCalls }
  summary       Json           @default("{}")
  aiReasoning   String?        // consolidated human-readable explanation assembled from results
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt

  project     Project               @relation(fields: [projectId], references: [id], onDelete: Cascade)
  workflowRun WorkflowRun           @relation(fields: [workflowRunId], references: [id], onDelete: Cascade)
  company     Company               @relation(fields: [companyId], references: [id], onDelete: Cascade)
  icpProfile  IcpProfile            @relation(fields: [icpProfileId], references: [id])
  results     QualificationResult[]
  messages    Message[]

  @@unique([workflowRunId, companyId])
  @@index([projectId, status])
  @@index([projectId, score])
  @@map("prospects")
}

enum CriterionStatus {
  PASS
  FAIL
  UNKNOWN
}

enum Evaluator {
  DETERMINISTIC
  LLM
}

enum QualificationPhase {
  INITIAL
  POST_ENRICHMENT
}

model QualificationResult {
  id             String             @id @default(uuid())
  prospectId     String
  criterionId    String             // IcpCriterion.id (slug)
  criterionLabel String
  phase          QualificationPhase
  status         CriterionStatus
  weight         Int                // 0-10, copied from the ICP at evaluation time
  required       Boolean
  evaluator      Evaluator
  reason         String
  confidence     Int?               // 0-100, LLM only
  missingFields  String[]           @default([]) // why UNKNOWN
  aiRunId        String?
  createdAt      DateTime           @default(now())
  updatedAt      DateTime           @updatedAt

  prospect Prospect   @relation(fields: [prospectId], references: [id], onDelete: Cascade)
  aiRun    AiRun?     @relation(fields: [aiRunId], references: [id])
  evidence Evidence[]

  @@unique([prospectId, criterionId, phase])
  @@index([prospectId])
  @@map("qualification_results")
}

enum EvidenceKind {
  FIELD_VALUE
  TEXT_SNIPPET
  URL
  JOB_POSTING
  NEWS_ITEM
}

model Evidence {
  id                    String       @id @default(uuid())
  qualificationResultId String
  companyAttributeId    String?      // mandatory for LLM-cited evidence; must be in the supplied set
  kind                  EvidenceKind
  content               Json         // { field, value, excerpt?, url?, observedAt? }
  sourceRef             String?      // human-readable pointer, e.g. "mock_apollo:job_postings[2]"
  createdAt             DateTime     @default(now())
  updatedAt             DateTime     @updatedAt

  qualificationResult QualificationResult @relation(fields: [qualificationResultId], references: [id], onDelete: Cascade)
  companyAttribute    CompanyAttribute?   @relation(fields: [companyAttributeId], references: [id])

  @@index([qualificationResultId])
  @@map("evidence")
}

// ─── Enrichment ──────────────────────────────────────────────

enum EnrichmentStatus {
  PENDING
  SUCCEEDED
  PARTIAL
  FAILED
  SKIPPED
}

model EnrichmentRun {
  id                String           @id @default(uuid())
  companyId         String
  workflowRunId     String?
  providerKey       String
  requestedFields   String[]
  suppliedFields    String[]         @default([])
  unavailableFields String[]         @default([])
  status            EnrichmentStatus @default(PENDING)
  costUnits         Int              @default(0)  // provider credits or call count
  rawResponse       Json?
  error             String?
  startedAt         DateTime         @default(now())
  finishedAt        DateTime?
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt

  company     Company            @relation(fields: [companyId], references: [id], onDelete: Cascade)
  workflowRun WorkflowRun?       @relation(fields: [workflowRunId], references: [id])
  attributes  CompanyAttribute[]

  @@index([companyId])
  @@index([workflowRunId])
  @@map("enrichment_runs")
}

// ─── AI runs ─────────────────────────────────────────────────

enum AiPurpose {
  ICP_EXTRACTION
  CSV_MAPPING_SUGGEST
  QUALITATIVE_ASSESS
  EMAIL_GENERATE
  EMAIL_QA
}

enum AiRunStatus {
  SUCCEEDED
  SCHEMA_RETRY  // first attempt failed Zod validation, retry succeeded
  FAILED
}

model AiRun {
  id            String      @id @default(uuid())
  workspaceId   String
  purpose       AiPurpose
  providerKey   String      // "anthropic" | "openai" | "gemini" | "mock"
  model         String
  promptKey     String      // "icp.extract"
  promptVersion Int
  inputTokens   Int         @default(0)
  outputTokens  Int         @default(0)
  costUsd       Float?
  latencyMs     Int?
  input         Json        // prompt payload (system + messages); secrets never present
  output        Json?       // parsed structured output
  rawOutput     String?     // provider text, for debugging
  status        AiRunStatus
  error         String?
  refType       String?     // "prospect" | "message" | "icp_profile" | "data_source"
  refId         String?
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  workspace            Workspace             @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  qualificationResults QualificationResult[]
  generatedMessages    Message[]             @relation("generationRun")
  qaMessages           Message[]             @relation("qaRun")

  @@index([workspaceId, purpose, createdAt])
  @@index([refType, refId])
  @@map("ai_runs")
}

// ─── Workflow orchestration ──────────────────────────────────

enum WorkflowRunStatus {
  PENDING
  RUNNING
  AWAITING_REVIEW
  COMPLETED
  FAILED
  CANCELLED
}

model WorkflowRun {
  id            String            @id @default(uuid())
  projectId     String
  icpProfileId  String
  status        WorkflowRunStatus @default(PENDING)
  triggeredById String?
  options       Json              @default("{}") // { dataSourceIds[], enrich: true, generateEmails: false, maxLlmProspects }
  summary       Json              @default("{}") // { ingested, normalized, qualified, disqualified, needsReview, enriched, llmCalls, inputTokens, outputTokens }
  currentStep   String?
  error         String?
  startedAt     DateTime?
  finishedAt    DateTime?
  createdAt     DateTime          @default(now())
  updatedAt     DateTime          @updatedAt

  project        Project         @relation(fields: [projectId], references: [id], onDelete: Cascade)
  icpProfile     IcpProfile      @relation(fields: [icpProfileId], references: [id])
  triggeredBy    User?           @relation("triggeredBy", fields: [triggeredById], references: [id])
  steps          WorkflowStep[]
  prospects      Prospect[]
  enrichmentRuns EnrichmentRun[]

  @@index([projectId, createdAt])
  @@map("workflow_runs")
}

enum WorkflowStepKey {
  INGEST
  NORMALIZE
  QUALIFY
  ENRICH
  REQUALIFY
  GENERATE_EMAIL
  QA
  AWAIT_REVIEW
}

enum WorkflowStepStatus {
  QUEUED
  RUNNING
  SUCCEEDED
  FAILED
  SKIPPED
}

model WorkflowStep {
  id            String             @id @default(uuid())
  workflowRunId String
  stepKey       WorkflowStepKey
  order         Int
  attempt       Int                @default(1)
  status        WorkflowStepStatus @default(QUEUED)
  inputHash     String?            // sha256(runId + stepKey + upstream output ids) – idempotency
  input         Json?
  output        Json?
  error         String?
  startedAt     DateTime?
  finishedAt    DateTime?
  createdAt     DateTime           @default(now())
  updatedAt     DateTime           @updatedAt

  workflowRun WorkflowRun @relation(fields: [workflowRunId], references: [id], onDelete: Cascade)

  @@unique([workflowRunId, stepKey, attempt])
  @@index([workflowRunId, order])
  @@map("workflow_steps")
}

// ─── Campaigns, messages, outbound ───────────────────────────

enum CampaignStatus {
  DRAFT
  ACTIVE
  PAUSED
  COMPLETED
}

model Campaign {
  id                  String         @id @default(uuid())
  projectId           String
  name                String
  status              CampaignStatus @default(DRAFT)
  outboundProviderKey String         @default("simulated")
  senderConfig        Json           @default("{}") // { fromName, fromEmail, replyTo, signature }
  createdAt           DateTime       @default(now())
  updatedAt           DateTime       @updatedAt

  project  Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  messages Message[]

  @@index([projectId])
  @@map("campaigns")
}

enum MessageChannel {
  EMAIL
}

enum QaStatus {
  PENDING
  PASS
  WARN
  FAIL
}

// EDITED = content changed after generation; qaStatus resets to PENDING and the message
// must be QA'd again and explicitly APPROVED again before it becomes sendable.
// Sendable = reviewStatus APPROVED && qaStatus in (PASS, WARN) && sendStatus NOT_SENT.
enum ReviewStatus {
  PENDING
  APPROVED
  REJECTED
  EDITED
}

enum SendStatus {
  NOT_SENT
  QUEUED
  SENT_SIMULATED
  SENT
  FAILED
}

model Message {
  id                String         @id @default(uuid())
  projectId         String
  campaignId        String?
  prospectId        String?
  companyId         String
  personId          String?
  channel           MessageChannel @default(EMAIL)
  toAddress         String?
  subject           String         // current (possibly edited)
  body              String
  generatedSubject  String         // original AI output, immutable
  generatedBody     String
  generationAiRunId String?
  qaAiRunId         String?
  qaStatus          QaStatus       @default(PENDING)
  // EmailQaResult: { relevance: 0-100, tone: 0-100, personalization: 0-100,
  //   unsupportedClaims: [{ claim, reason }], overall: PASS|WARN|FAIL, notes }
  qaResult          Json?
  reviewStatus      ReviewStatus   @default(PENDING)
  reviewedById      String?
  reviewedAt        DateTime?
  reviewNote        String?
  sendStatus        SendStatus     @default(NOT_SENT)
  sentAt            DateTime?
  providerMessageId String?
  sendError         String?
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt

  project       Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  campaign      Campaign? @relation(fields: [campaignId], references: [id])
  prospect      Prospect? @relation(fields: [prospectId], references: [id])
  company       Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)
  person        Person?   @relation(fields: [personId], references: [id])
  generationRun AiRun?    @relation("generationRun", fields: [generationAiRunId], references: [id])
  qaRun         AiRun?    @relation("qaRun", fields: [qaAiRunId], references: [id])
  reviewedBy    User?     @relation("reviewedBy", fields: [reviewedById], references: [id])

  @@index([projectId, reviewStatus])
  @@index([campaignId, sendStatus])
  @@map("messages")
}
```

### Relationships at a glance (live schema)

```
Workspace ─┬─ WorkspaceMember ─ User
           ├─ Project ─┬─ IcpProfile (versioned; activation blocked by open BLOCKING clarifications)
           │           ├─ DataSource ─ SourceRecord (raw) ──┐
           │           ├─ Company ─┬─ CompanyAttribute ◄────┘ (append-only provenance ledger)
           │           │           ├─ Person (email/phone inline)
           │           │           └─ EnrichmentRun ─ CompanyAttribute
           │           ├─ WorkflowRun ─┬─ WorkflowStep
           │           │               └─ Prospect ─ QualificationResult ─ Evidence ─► CompanyAttribute
           │           └─ Campaign ─ Message ─► AiRun (generation, QA), Prospect, Person
           └─ AiRun
```

### Resolution: CompanyAttribute -> Company

The ledger is append-only. Every sync or enrichment appends observations; nothing is updated in place. The resolver runs after each write batch:

1. Load attributes for the company (all, or only the changed fields).
2. Group by `field`. Within a field, order by precedence index from `workspace.settings.sourcePrecedence` (default `MANUAL > ENRICHMENT > SOURCE > NORMALIZER > AI`), then `confidence desc`, then `observedAt desc`.
3. Scalar fields take the first observation. Array fields (`technographics.stack`, `signals.*`, `people`) merge across observations and dedupe by normalized key, keeping the newest `observedAt` per key.
4. Write winners into `Company` columns and the full snapshot into `Company.canonical`; recompute `resolvedHash`.

Because history is preserved, the prospect detail page can show "employeeCount: 480 (mock_apollo, 2026-09-01) -> 512 (mock_enrichment, 2026-09-14)", and qualification evidence still points to the exact observation that was used.

### Score representation

| Value | Type | Range |
|---|---|---|
| `Prospect.score` | Int? | 0–100, **null** when no criterion has a KNOWN verdict (then coverage = 0, status = NEEDS_REVIEW) |
| `Prospect.coverage` | Int | 0–100 |
| `QualificationResult.confidence`, `CompanyAttribute.confidence` | Int | 0–100 |
| `IcpDefinition.scoring.qualifiedThreshold / needsReviewThreshold / minCoverage` | Int | 0–100 |
| `QualitativeCriterion.minConfidence` | Int | 0–100 |
| `IcpCriterion.weight` | Int | 0–10 (not a percentage) |

### Seed data (Phase 1)

- 1 user `demo@databeat.io` / `Demo1234!`, 1 workspace "Databeat Demo", 1 project "US SaaS Sales Expansion".
- 1 active `IcpProfile` = the example ICP (SaaS, US, 100–500 employees, revenue > $10M, Salesforce, hiring salespeople) with zero open BLOCKING clarifications.
- 1 `DataSource` (mock_apollo) with `SourceRecord`s for Databricks, Notion, Figma, Canva, Stripe, Linear, Webflow, Slack, plus a sample CSV file with the same companies under different column headers to exercise mapping.
- The demo data is deliberately imperfect: some records lack revenue or employee count so the enrichment path runs, Canva is headquartered in Australia, and Slack, Stripe and Databricks exceed 500 employees, so hard filters visibly fail for some companies.

---

## 2. Production extension (documented only, not migrated in the POC)

When adopted, these relations are added to Tier 1 models: `Workspace.usageLogs`, `Workspace.auditLogs`, `Workspace.dataSourceConnections`, `Workspace.providerConfigs`, `Workspace.unmappedTerms`, `User.auditLogs`, `DataSource.connectionId` + `DataSource.connection`, `Person.contacts`.

### Tier 2 — usage & audit

```prisma
enum UsageKind {
  AI_INPUT_TOKENS
  AI_OUTPUT_TOKENS
  ENRICHMENT_CALL
  CONNECTOR_FETCH
  OUTBOUND_SEND
}

model UsageLog {
  id          String    @id @default(uuid())
  workspaceId String
  projectId   String?
  kind        UsageKind
  providerKey String
  quantity    Float
  unitCostUsd Float?
  refType     String?   // "ai_run" | "enrichment_run" | "workflow_run" | "message"
  refId       String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, kind, createdAt])
  @@map("usage_logs")
}

model AuditLog {
  id          String   @id @default(uuid())
  workspaceId String
  actorUserId String?
  action      String   // "icp.activated" | "message.approved" | "workflow.started" | ...
  entityType  String
  entityId    String
  before      Json?
  after       Json?
  ip          String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  actor     User?     @relation("actor", fields: [actorUserId], references: [id])

  @@index([workspaceId, createdAt])
  @@index([entityType, entityId])
  @@map("audit_logs")
}
```

POC substitute: the Analytics and Usage views aggregate `AiRun.inputTokens/outputTokens/costUsd`, `EnrichmentRun.costUnits`, `Prospect.status`, and `Message.sendStatus`. Review actions are recorded on `Message.reviewedById / reviewedAt / reviewNote`.

### Tier 3 — customer credentials, provider configs, contacts, unmapped terms

```prisma
// Per-workspace customer-supplied credentials for API connectors.
// Production: encrypt `credentials` via a SecretsService (KMS-backed); never return via API.
enum ConnectionStatus {
  UNTESTED
  CONNECTED
  FAILED
}

model DataSourceConnection {
  id           String           @id @default(uuid())
  workspaceId  String
  providerKey  String
  name         String
  credentials  Bytes?           // encrypted blob
  config       Json             @default("{}")
  status       ConnectionStatus @default(UNTESTED)
  lastTestedAt DateTime?
  lastError    String?
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt

  workspace   Workspace    @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  dataSources DataSource[]

  @@index([workspaceId, providerKey])
  @@map("data_source_connections")
}

// Per-workspace AI / enrichment / outbound provider selection + secrets.
enum ProviderKind {
  AI
  ENRICHMENT
  OUTBOUND
}

model ProviderConfig {
  id          String       @id @default(uuid())
  workspaceId String
  kind        ProviderKind
  providerKey String
  config      Json         @default("{}")
  secrets     Bytes?       // encrypted blob
  enabled     Boolean      @default(true)
  isDefault   Boolean      @default(false)
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, kind, providerKey])
  @@map("provider_configs")
}

// Multiple verified contact points per person.
enum ContactType {
  EMAIL
  PHONE
}

model Contact {
  id          String      @id @default(uuid())
  personId    String
  type        ContactType
  value       String
  verified    Boolean     @default(false)
  providerKey String
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  person Person @relation(fields: [personId], references: [id], onDelete: Cascade)

  @@unique([personId, type, value])
  @@map("contacts")
}

// Synonym-dictionary gaps surfaced in Settings.
model UnmappedTerm {
  id          String   @id @default(uuid())
  workspaceId String
  dictionary  String   // "industry" | "technology" | "country"
  rawValue    String
  occurrences Int      @default(1)
  firstSeenAt DateTime @default(now())
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, dictionary, rawValue])
  @@map("unmapped_terms")
}
```

POC substitutes: provider credentials via `APOLLO_API_KEY`, `ANTHROPIC_API_KEY`, `SMTP_*` environment variables; provider selection via `Workspace.settings`; contact detail via `Person.email` / `Person.phone`; unmapped terms via a structured `warn` log line `{ event: "dictionary.unmapped", dictionary, rawValue }`.
