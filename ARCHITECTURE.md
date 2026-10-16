# Architecture – AI-Powered B2B Prospecting Workflow POC

Domain-specific workflow platform: a customer describes their Ideal Customer Profile (ICP) in chat, supplies company data from their own sources, and the system normalizes, qualifies (deterministic rules + LLM for qualitative criteria), enriches only what is missing, re-qualifies, drafts personalized outreach, QA-checks it with a second AI step, and hands it to a human for approval before (simulated) sending.

Companion documents

| Document | Content |
|---|---|
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Phases, order, estimates, risks, decisions log |
| [docs/schema.prisma.md](docs/schema.prisma.md) | Live POC Prisma schema (Tier 1) + documented production extension (Tier 2/3) |
| [docs/icp-schema.md](docs/icp-schema.md) | ICP draft vs strict Zod schemas, clarification reconciliation, activation rules, evaluation + scoring semantics |
| [docs/canonical-model.md](docs/canonical-model.md) | Canonical company model, authoritative absence, company matching, single ingestion pipeline, resolver rules |
| [docs/provider-interfaces.md](docs/provider-interfaces.md) | Connector / enrichment / AI / outbound interfaces, registry, `ProviderCallError`, resilience policy |
| [docs/api-endpoints.md](docs/api-endpoints.md) | REST catalogue by module and phase |
| [.env.example](.env.example) | Every environment variable with comments |

## 1. System overview

```
┌──────────────────────────────┐        ┌──────────────────────────────────────────────────────────┐
│  apps/web  (Next.js 15)      │  REST  │  apps/api  (NestJS)                                      │
│  App Router, React, Tailwind │ ─────► │  modules/…  ── ProviderRegistry ── adapters               │
│  14 pages, polling for runs  │        │  IngestionService (one pipeline)  WorkflowRunner (steps) │
└──────────────────────────────┘        └───────┬───────────────┬──────────────┬───────────────────┘
                                                │ Prisma        │ AiProvider   │ Connectors / Enrichment / Outbound
                                          ┌─────▼─────┐   ┌─────▼──────┐  ┌────▼─────────────────────────────┐
                                          │ PostgreSQL│   │ mock ✔     │  │ csv ✔  mock_apollo ✔  apollo ✖    │
                                          │ (Docker   │   │ anthropic ✔│  │ mock_enrichment ✔  apollo_enrich ✖│
                                          │  :5433)   │   │ openai ✖   │  │ simulated ✔  smtp ✖               │
                                          └───────────┘   │ gemini ✔   │  └───────────────────────────────────┘
                                                          └────────────┘      ✔ available   ✖ documented stub (available=false)
                     packages/shared: Zod schemas (ICP, canonical company, DTOs) imported by both apps
```

End-to-end data flow

```
Chat ──► IcpExtractor (LLM) ──► IcpDraftDefinition (0..n criteria, server-owned clarifications) ──► user resolves BLOCKING ──► strict IcpDefinition (ACTIVE)

CSV / API ──► IngestionService.syncDataSource
               SourceRecord (raw, immutable) ──► connector.mapToCanonical ──► Normalizers (dictionaries)
               ──► CompanyMatcher (domain → name → possibleDuplicate)
               ──► CompanyAttribute ledger (append-only) + Person upsert (authoritative contacts)
               ──► Resolver ──► Company columns + Company.canonical (+ provenance, authoritative flags)

WorkflowRun: INGEST → NORMALIZE → QUALIFY → ENRICH → REQUALIFY → GENERATE_EMAIL → QA → AWAIT_REVIEW
  INGEST     optional refresh of selected sources via the SAME IngestionService (options.refreshSources)
  NORMALIZE  IngestionService.normalizePending(project) – any un-normalized raw records
  QUALIFY    creates Prospect rows for the run; deterministic rules → PASS/FAIL/UNKNOWN; missing-field set
  ENRICH     only missing ∩ provider.supportedFields, only for prospects not already hard-FAILED
  REQUALIFY  deterministic again, then LLM for QUALITATIVE criteria (evidence-only, evidenceRefs validated)
  scoring    score (nullable 0-100) over KNOWN criteria, coverage 0-100 → QUALIFIED / NEEDS_REVIEW / DISQUALIFIED
  GENERATE   personalized email from canonical facts + Person recipient
  QA         second LLM pass: relevance, tone, unsupported claims, personalization → PASS/WARN/FAIL
  REVIEW     human approve (needs QA PASS/WARN) / reject / edit (⇒ QA again ⇒ approve again) → Campaign send (simulated)
```

## 2. Architecture principles → design decisions

| Principle | Decision |
|---|---|
| Customer owns the data source | Data enters only through `DataSourceConnector`s the customer configures (CSV, their API keys). |
| No single-provider dependency | Every external capability is an interface + registry entry. Mocks implement the same interfaces and are selected explicitly. Stubs are registered `available: false`. |
| Raw separate from normalized | `SourceRecord.rawPayload` is immutable. Canonical values live in `CompanyAttribute` → `Company`. |
| Store provider metadata | Every observation records `sourceType`, `providerKey`, `confidence`, `observedAt`, and links to its `SourceRecord` or `EnrichmentRun`. History is preserved (append-only, no uniqueness per provider). |
| Canonical model | One Zod `CanonicalCompany` in `packages/shared` (company-level); `Person` table is the authoritative contact store; only the Resolver writes `provenance`. |
| Don't enrich blindly | Enrichment requests are computed from UNKNOWN criteria with `enrichIfMissing`, intersected with `provider.supportedFields()`, and skipped for prospects already failing a required criterion. |
| Evaluate first, enrich, re-evaluate | Two qualification phases persisted separately (`INITIAL`, `POST_ENRICHMENT`). |
| Structured criteria without LLM | Operator table + explicit-alias dictionaries. LLM only for `kind: QUALITATIVE`. |
| UNKNOWN on insufficient evidence | Missing fields, unmapped terms, non-authoritative empty lists, low confidence, invalid evidence citations → UNKNOWN. No KNOWN criteria at all → `score = null`, NEEDS_REVIEW. |
| Never fabricate | Evidence-only prompts, `evidenceRefs` must match supplied attribute ids, providers must list unsupplied fields in `unavailable`, no silent mock fallback, AI output treated as untrusted until Zod-validated. |
| Human validates workflow output | Review UI shows raw vs normalized vs results vs AI reasoning; approve requires QA PASS/WARN; edits force re-QA and re-approval. |
| Easy to extend | New connector = one class + one module. New workflow step = one `WorkflowStep` registered in the runner's ordered list. |

## 3. Module map (apps/api/src/modules)

| Module | Responsibility | Depends on |
|---|---|---|
| `auth` | register/login/refresh (refresh is public, validates refresh token), JWT guard, current-user decorator | users, workspaces |
| `users` | user CRUD, password hashing | prisma |
| `workspaces` | workspace + membership, `settings` (provider selection, sourcePrecedence), workspace guard (`X-Workspace-Id` membership check) | prisma, providers (validate selections) |
| `projects` | project CRUD, project-scoped guard | workspaces |
| `icp` | chat → draft, clarification dedupe/reconciliation (server-owned state), strict activation, versions | ai, projects |
| `data-sources` | data source CRUD (soft archive), CSV upload/mapping, triggers `IngestionService.syncDataSource` | connectors, normalization |
| `connectors` | `DataSourceConnector` impls: `csv`, `mock_apollo` (available), `apollo` (stub); registers into `ProviderRegistry` | providers |
| `normalization` | **`IngestionService`** (sync, normalizePending, resolveCompany), dictionaries, normalizers, `CompanyMatcher`, `AttributeWriter`, `PersonWriter`, `Resolver` | prisma, providers |
| `prospects` | prospect list/detail, attribute history, manual overrides (→ `IngestionService.resolveCompany`), requalify/enrich actions | qualification, enrichment |
| `enrichment` | missing-field computation, `EnrichmentProvider` impls (`mock_enrichment` available, `apollo_enrich` stub), `EnrichmentRun` persistence | normalization, providers |
| `qualification` | dependency map, deterministic evaluator, LLM assessor, scoring, `Prospect` creation for a run, results/evidence persistence | ai, normalization |
| `ai` | `AiProvider` impls (`mock`, `anthropic`, `gemini` available; `openai` stub), `AiService`, prompt registry, `AiRun` persistence | providers |
| `email-generation` | recipient selection from `Person`, email draft generation, `Message` creation | ai, prospects |
| `qa` | email QA (relevance, tone, unsupported claims, personalization) → `qaResult`, `qaStatus` | ai |
| `campaigns` | campaign CRUD, sendability rule, send orchestration | outbound |
| `outbound` | `OutboundProvider` impls (`simulated` available, `smtp` stub) | providers |
| `workflow` | `WorkflowRunner`, `WorkflowStep` impls, `JobDispatcher` (in-process), run/step persistence | normalization, qualification, enrichment, email-generation, qa |
| `usage` | aggregates from `AiRun` / `EnrichmentRun` (Tier 2 table optional) | prisma |
| `audit` | lightweight action logging via interceptor (Tier 2 table optional; POC logs to app log) | – |
| `analytics` | dashboard + project funnel queries | prisma |
| `providers` (shared infra) | `ProviderRegistry` (single owner of `PROVIDER_UNAVAILABLE` / `PROVIDER_NOT_CONFIGURED`), `ProviderCtx`, `ProviderCallError`, `withPolicy` | config |

Dependency direction: `data-sources → normalization`; `workflow → normalization/qualification/…`; **`data-sources` does not depend on `prospects` or `qualification`**. Prospect rows are created only by the `QUALIFY` step (or per-prospect requalify actions).

## 4. Folder structure

```
prospect-poc/
├── apps/
│   ├── web/                                   # Next.js 15 App Router, TypeScript, Tailwind
│   │   ├── .env.local                          # generated by setup-env: NEXT_PUBLIC_API_URL (gitignored)
│   │   ├── app/
│   │   │   ├── (auth)/login/page.tsx
│   │   │   ├── (app)/layout.tsx               # sidebar + topbar shell
│   │   │   ├── (app)/dashboard/page.tsx
│   │   │   ├── (app)/projects/page.tsx
│   │   │   ├── (app)/projects/new/page.tsx
│   │   │   ├── (app)/projects/[id]/layout.tsx # project tabs
│   │   │   ├── (app)/projects/[id]/icp/page.tsx
│   │   │   ├── (app)/projects/[id]/data-sources/page.tsx
│   │   │   ├── (app)/projects/[id]/data-sources/csv/page.tsx
│   │   │   ├── (app)/projects/[id]/workflow/page.tsx
│   │   │   ├── (app)/projects/[id]/prospects/page.tsx
│   │   │   ├── (app)/projects/[id]/prospects/[prospectId]/page.tsx
│   │   │   ├── (app)/projects/[id]/emails/page.tsx
│   │   │   ├── (app)/campaigns/page.tsx
│   │   │   ├── (app)/analytics/page.tsx
│   │   │   └── (app)/settings/page.tsx
│   │   ├── components/ui/                      # Button, Card, Badge, Table, Input, Dialog, Tabs, Skeleton
│   │   ├── components/layout/                  # Sidebar, Topbar, PageHeader
│   │   ├── components/{icp,data-sources,prospects,emails,charts}/
│   │   ├── lib/api.ts                          # typed fetch client, token refresh
│   │   ├── lib/auth.ts                         # token storage, session helpers
│   │   └── middleware.ts                       # redirect unauthenticated → /login
│   └── api/                                    # NestJS
│       ├── prisma/schema.prisma                # Tier 1 models ONLY
│       ├── prisma/migrations/
│       ├── prisma/seed.ts                      # demo user, workspace, project, ICP, 8 companies, people, one completed run
│       ├── prompts/                            # icp.extract.v1.md, csv.mapping.v1.md, qualify.assess.v1.md, email.generate.v1.md, email.qa.v1.md
│       └── src/
│           ├── main.ts, app.module.ts
│           ├── config/env.ts                   # Zod-validated env (JWT ≥32 chars, no placeholders, numerics coerced+checked)
│           ├── config/paths.ts                 # repoRoot(), DATA_DIR resolution
│           ├── prisma/                         # PrismaService
│           ├── common/                         # ZodValidationPipe, HttpExceptionFilter, guards, decorators, provider-call.error.ts, resilience.ts
│           └── modules/<module>/               # *.module.ts, *.controller.ts, *.service.ts, dto/, providers/
├── packages/
│   ├── shared/src/schemas/                     # icp.schema.ts, canonical-company.schema.ts, email.schema.ts
│   ├── shared/src/dto/                         # request/response DTOs per module
│   ├── shared/src/providers/types.ts           # ProviderCtx, ProviderMeta, RawRecord, NewAttribute, MappedRecord
│   └── config/                                 # tsconfig.base.json, eslint config
├── scripts/setup-env.mjs                       # .env + apps/web/.env.local (refuses to overwrite without --force), JWT secrets
├── docker-compose.yml                          # postgres:16, ports "5433:5432"
├── pnpm-workspace.yaml, package.json, .gitignore, .env.example
├── ARCHITECTURE.md, IMPLEMENTATION_PLAN.md, docs/
└── .data/                                      # gitignored: uploads/, outbox/
```

## 5. Data model

Live POC schema (Tier 1, 19 models) and documented production extension (Tier 2/3) are in [docs/schema.prisma.md](docs/schema.prisma.md). Key design points:

- **`CompanyAttribute` is an append-only ledger.** No uniqueness on `(company, field, provider)`; indexed by `(companyId, field, observedAt desc)`. The `Resolver` sorts observations by precedence (`MANUAL > ENRICHMENT > SOURCE > NORMALIZER > AI`), then confidence, then recency. Scalars take the top observation. List groups: if the top observation is authoritative, its complete list is used exactly; otherwise all non-authoritative observations are unioned (lower-ranked authoritative ones ignored) and the result stays non-authoritative.
- **`Company` is the resolved read model** (scalar columns for filtering + `canonical` JSON snapshot + `resolvedHash` for LLM caching) plus the data-quality flag **`possibleDuplicate`** set by `CompanyMatcher`.
- **`Person` is the authoritative contact store** with `(companyId, dedupeKey)` uniqueness (`email:` or `name:` key); `CanonicalCompany` is company-level only and connectors cannot supply `provenance`.
- **`Prospect` = a company evaluated in one `WorkflowRun`** with `status`, **`score` (nullable 0–100)**, `coverage` (0–100), `summary`, `aiReasoning`. `QualificationResult` rows per criterion per phase; `Evidence` rows link to `CompanyAttribute.id`.
- **`IcpProfile` is versioned**; runs pin an `icpProfileId`. Drafts may have zero criteria; activation requires the strict schema.
- **Data sources are soft-archived**, never physically deleted, so raw records and provenance survive.
- **Coverage, thresholds and confidence are integers 0–100**; score is a nullable integer 0–100.

## 6. ICP: chat → structured

Detailed in [docs/icp-schema.md](docs/icp-schema.md).

- Extractor receives the full transcript and the previous draft (including resolved clarifications), returns `IcpExtractionOutput { draft (no clarifications), clarifications[] (criterionId + type + question + severity + proposedDefault; no ids/answers), unsupported[], assistantMessage }`.
- The server dedupes proposals by deterministic id `clar:<criterionId|general>:<type>`, reconciles with the previous draft (USER answers carried forward, MINOR-with-default → `DEFAULT`, rest `UNRESOLVED`), and validates state consistency (USER needs an answer, DEFAULT needs a proposed default, ids unique). `draft.clarifications` is the single source of truth; `unresolvedClarifications` and `defaultedAssumptions` are derived views.
- `PUT /icp/draft` cannot change clarification state; only `POST /icp/clarifications/:id/resolve` sets `resolvedBy: USER`.
- **Activation** validates the draft against strict `IcpDefinition` (≥1 criterion, ≥1 with weight > 0, unique ids, zero unresolved BLOCKING clarifications); otherwise `409 ICP_NOT_ACTIVATABLE` with the exact issues. The UI computes the same client-side to disable the button.
- ICP values for industry/technology/country are normalized through the same dictionaries as company data at save time.

## 7. Ingestion (one pipeline)

`IngestionService` in the `normalization` module is the only code path that turns raw records into companies:

- `syncDataSource(dataSourceId)` – connector fetch (paged, `withPolicy(connector)`) → `SourceRecord` insert (idempotent by `payloadHash`) → `normalizePending(dataSourceId)`.
- `normalizePending(scope)` – for each raw record without `normalizedCompanyId`: `mapToCanonical` → normalizers → `CompanyMatcher` → `AttributeWriter.append` → `PersonWriter.upsert` → mark record; then `resolveCompany` for affected companies.
- `resolveCompany(companyId)` – runs the `Resolver` (the only writer of `canonical.provenance`); also used after enrichment and manual overrides.

`CompanyMatcher`: domain present → match `(projectId, domain)` else create. Domain absent → exactly one normalized-name match → reuse; none → create; **ambiguous (2+) → create a new `Company` with `possibleDuplicate = true`** (UI warning badge; manual override can clear/merge).

Callers: `POST /data-sources/:id/sync` (manual), workflow `INGEST` (only when `options.refreshSources = true`) and `NORMALIZE` (always). Ingestion **stops at Company/Person**; it never creates `Prospect`s.

## 8. Qualification engine

```
QUALIFY step: for each Company in the project (from non-archived sources) create/refresh Prospect(runId, companyId)

for each prospect (company resolved snapshot):
  deps(criterion) = DETERMINISTIC ? [field] : requiredEvidenceFields

  Phase INITIAL
    for each DETERMINISTIC criterion:
      value missing / unmapped                       → UNKNOWN (missingFields=[field])
      list empty && !authoritative                   → UNKNOWN
      list empty && authoritative                    → absence → FAIL for EXISTS / CONTAINS_*
      else operator table                            → PASS | FAIL
      BETWEEN on employeeCount falls back to employeeRange bucket; straddling bucket → UNKNOWN
      evidence = winning CompanyAttribute.id + value
    requiredFail = any(required && FAIL)

  Missing set
    missing = ∪ deps of UNKNOWN criteria with enrichIfMissing (soft and required)   (skip if requiredFail)

  ENRICH (if enrichment provider selected, available & configured; else step SKIPPED with reason)
    wanted = missing ∩ provider.supportedFields()
    result = withPolicy(enrichment, provider.enrich(company, wanted))  → attributes appended, unavailable recorded
    IngestionService.resolveCompany(company)

  Phase POST_ENRICHMENT
    deterministic again (same code path)
    QUALITATIVE criteria only if !requiredFail and all requiredEvidenceFields present (non-empty or authoritative-empty):
      batch ≤ AI_ASSESS_BATCH_SIZE companies per criterion, cap MAX_LLM_PROSPECTS_PER_RUN
      prompt = question + passRubric/failRubric + recency window + ONLY evidenceFields values with attribute ids
      output (validated by AiService) = { verdict PASS|FAIL|UNKNOWN, confidence 0-100, reason, evidenceRefs[] }
      evidenceRefs ⊄ supplied ids  → UNKNOWN ("invalid citation")
      confidence < minConfidence   → UNKNOWN
      cache key (icpProfileId, criterionId, company.resolvedHash)

  Scoring
    any required FAIL                       → DISQUALIFIED
    any required UNKNOWN                    → unknownRequiredPolicy (default NEEDS_REVIEW)
    knownWeight = Σ w over PASS|FAIL;  allWeight = Σ w over all (> 0 by strict ICP)
    if knownWeight === 0:                   → score = null, coverage = 0, status = NEEDS_REVIEW   (no evidence ≠ bad fit)
    else:
      score    = round(100 · Σ w·[PASS] / knownWeight)
      coverage = round(100 · knownWeight / allWeight)
      score ≥ qualifiedThreshold && coverage ≥ minCoverage → QUALIFIED
      score < needsReviewThreshold                         → DISQUALIFIED
      else                                                 → NEEDS_REVIEW
    aiReasoning = templated summary of every criterion result + LLM reasons
```

Deterministic fuzziness is handled by versioned dictionaries (`industry.json`, `technology.json`, `country.json`) with **explicit aliases only**; vendor suffixes are never stripped generically so distinct products stay distinct. Unmapped terms → UNKNOWN + `dictionary.unmapped` log.

## 9. AI layer

Detailed in [docs/provider-interfaces.md](docs/provider-interfaces.md).

- **POC scope**: `mock`, `anthropic`, and `gemini` fully implemented (`available: true`). `openai` remains a documented stub registered with `available: false` (visible but not selectable in Settings). Adding it later is one adapter.
- `AiProvider.generateStructured()` returns **untrusted `data: unknown`**. `AiService` converts the Zod schema to JSON Schema for the vendor, calls through `withPolicy(POLICIES.ai)`, then `safeParse`s the response; on failure it performs one repair retry with the Zod issues, then fails with `502 AI_OUTPUT_INVALID`. Only validated `T` reaches business code.
- `AiService` is the only entry point for business modules: typed façades `extractIcp`, `suggestCsvMapping`, `assessCriteria`, `generateEmail`, `qaEmail`. It resolves provider (workspace setting → `AI_PROVIDER`) through the registry (which owns `PROVIDER_UNAVAILABLE` / `PROVIDER_NOT_CONFIGURED`), model (`AI_MODEL_<PURPOSE>` override → `provider.defaultModel(tier)`), loads versioned prompt templates from `apps/api/prompts/`, and persists every call as `AiRun`.
- **No model logic in business code** and **no silent mock fallback**. `.env.example` ships with `AI_PROVIDER=mock` so the demo runs offline.
- Vendor SDK errors are translated into `ProviderCallError` (`retryable`, `statusCode`, `retryAfterMs`) so the resilience policy is uniform across AI, connectors, enrichment and outbound.

## 10. Email generation, QA and review

- Recipient: best `Person` for the prospect matched against `targetPersonas` (title/department/seniority), falling back to the most senior sales/revenue person; no recipient → message created with `toAddress: null` and flagged.
- Generation input: canonical facts with provenance, PASS criteria with evidence, hiring/news signals, persona, sender config. Output `{ subject, body, usedFacts: [{ claim, fieldPath }] }`.
- QA input: subject/body + the same canonical facts. Output `{ relevance 0-100, tone 0-100, personalization 0-100, unsupportedClaims: [{ claim, reason }], overall PASS|WARN|FAIL, notes }`. A claim that cannot be traced to a supplied fact is `unsupported`; any unsupported claim → at least WARN.
- Review state machine: `PENDING → APPROVED | REJECTED | EDITED`. **Approve requires `qaStatus ∈ {PASS, WARN}`**; QA FAIL must be edited or regenerated and QA'd again. `EDITED` resets `qaStatus` to `PENDING`. **Sendable = APPROVED ∧ QA ∈ {PASS, WARN} ∧ NOT_SENT.**

## 11. Workflow orchestration

- `WorkflowRunner.start()` creates `WorkflowRun` + ordered `WorkflowStep` rows and returns `202 { runId }`. UI polls `GET /workflow-runs/:id`.
- Steps implement `WorkflowStep<I,O>`; the runner owns sequencing and never lets steps call each other. Each step is idempotent via `inputHash = sha256(runId + stepKey + upstream output ids)` and upserts on natural keys.
- `INGEST`/`NORMALIZE` delegate to `IngestionService`; `QUALIFY`/`REQUALIFY` to `QualificationService`; `ENRICH` to `EnrichmentService`; `GENERATE_EMAIL`/`QA` to their services. Steps contain orchestration only.
- Dispatch seam `JobDispatcher`: POC `InProcessJobDispatcher` (next tick). Upgrade path: pg-boss → Inngest / Trigger.dev, without touching steps or persistence.
- `AWAIT_REVIEW` is a terminal step for the run; human actions happen through the messages API.

## 12. Security and tenancy (POC level)

- JWT access (15 m) + refresh (7 d); bcrypt passwords. `/auth/refresh` is public and validates the refresh token itself. Secrets validated at startup: ≥ 32 chars, placeholder strings rejected; all numeric env vars coerced and range-checked.
- Workspace resolved from the user's membership; optional `X-Workspace-Id` is verified against membership (`403` otherwise). All repository queries include `workspaceId`.
- Provider credentials from env only; never returned by the API, never logged, never stored in `AiRun.input` or step outputs. Credentials affect `configured`, never `available`.
- CORS restricted to `WEB_URL`. Uploads limited by `MAX_UPLOAD_MB`, stored under gitignored `<DATA_DIR>/uploads`.

## 13. Real vs mocked in the POC

| Capability | POC implementation (`available: true`) | Documented stubs (`available: false`) / production path |
|---|---|---|
| Auth, DB, Prisma | real | – |
| CSV connector + mapping UI | real | – |
| API connector | `mock_apollo` (explicitly selected fixture) | `apollo` (needs implementation; `APOLLO_API_KEY` only sets `configured`) |
| Normalization, matching, dictionaries, resolver, ingestion | real | – |
| Deterministic qualification & scoring | real | – |
| ICP extraction, LLM assessment, email generation, QA | `anthropic`/`gemini` (real, with key) and `mock` (default) | `openai` |
| Enrichment | `mock_enrichment` fixture (incl. `unavailable` fields) | `apollo_enrich` |
| Outbound | `simulated` (writes `.eml` to `<DATA_DIR>/outbox`) | `smtp` (nodemailer, optional Phase 8) |
| Orchestration | in-process runner with persisted steps | pg-boss → Inngest / Trigger.dev |
| Usage & audit | derived from `AiRun`/`EnrichmentRun`/`Message`; app log for audit | Tier 2 tables |
| Credential storage | env vars | Tier 3 encrypted per-workspace tables |

## 14. Extension points

- **New data source**: implement `DataSourceConnector` with `available: true`, register in a Nest module, add fixture + mapper tests. Appears in `/connectors` automatically.
- **New enrichment provider**: implement `EnrichmentProvider` with `supportedFields()`; the missing-field intersection does the rest.
- **New criterion operator**: add to the Zod discriminated union and the operator table in `qualification/deterministic-evaluator.ts`.
- **New workflow step**: implement `WorkflowStep`, insert into the runner's ordered list, add `WorkflowStepKey` enum value.
- **New AI vendor**: implement `AiProvider.generateStructured` + `defaultModel`, flip `available: true`; nothing else changes.
- **Durable orchestration**: implement `JobDispatcher` against pg-boss/Inngest/Trigger.dev.
