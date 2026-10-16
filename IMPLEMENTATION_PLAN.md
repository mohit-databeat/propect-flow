# Implementation Plan – AI-Powered B2B Prospecting Workflow POC

Target: a working end-to-end demo. Phase estimates below total roughly **25–33 working days**, i.e. **5–7 weeks for one engineer** or **3–5 weeks for two engineers** working in parallel on API and UI. Optimized for demonstrating the workflow and architecture, not for production hardening. See [ARCHITECTURE.md](ARCHITECTURE.md) for the design.

## 1. Goals and non-goals

Goals

- Demonstrate the full loop: chat ICP → structured ICP → CSV and API data in → normalization with provenance → deterministic + LLM qualification → targeted enrichment → re-qualification → prospect list/detail with evidence and AI reasoning → personalized email → AI QA → human review → simulated send → analytics.
- Prove the architecture: provider adapters, raw-vs-normalized separation, append-only provenance, UNKNOWN semantics, no fabrication, one ingestion pipeline, clear orchestration seams.
- All 14 requested pages with realistic seeded data.

Non-goals (documented, not built)

- Per-workspace encrypted credential storage and key rotation (Tier 3).
- Durable job queue / Temporal / Inngest (seam only).
- Multi-workspace switching, SSO, RBAC beyond roles column.
- **Real Apollo / SMTP integrations are not part of the core POC.** Their adapters (`apollo`, `apollo_enrich`, `smtp`) are documented stubs with `available: false` until implemented. Credentials only affect `configured` status; they never activate a stub.
- OpenAI / Gemini adapters (documented stubs; optional Phase 8).

## 2. Assumptions and decisions log

| # | Decision | Rationale / source |
|---|---|---|
| D1 | pnpm monorepo: `apps/web`, `apps/api`, `packages/shared`, `packages/config` | Shared Zod schemas between API and UI |
| D2 | Live `schema.prisma` contains **Tier 1 models only**; Tier 2/3 documented in `docs/schema.prisma.md` | Review: minimum entities for the demo |
| D3 | `CompanyAttribute` is append-only, **no uniqueness per provider**, indexed `(companyId, field, observedAt desc)` | Review: preserve provenance history |
| D4 | **Prospect score is a nullable integer 0–100. Coverage, thresholds and confidence are integers 0–100.** If `knownWeight = 0`: `score = null`, `coverage = 0`, `status = NEEDS_REVIEW` (no evidence ≠ bad fit) | Review |
| D5 | Provider credentials from **env vars**; provider selection in `Workspace.settings` | Review: no production credential encryption in POC |
| D6 | `IcpDraftDefinition` (zero criteria allowed) vs strict `IcpDefinition` (≥1 criterion, ≥1 with weight > 0, unique ids, no open BLOCKING) for activation | Review |
| D7 | **Absence is not evidence**: `EXISTS`/`CONTAINS_*` on missing or non-authoritative-empty data → UNKNOWN; only authoritative empty lists count as absence | Review |
| D8 | `Person` table is the authoritative contact store with `(companyId, dedupeKey)` uniqueness; `CanonicalCompany` is company-level only; connectors cannot supply `provenance` | Review |
| D9 | Technology normalization uses **explicit aliases only**; no generic suffix stripping | Review |
| D10 | **`available` ≠ `configured`.** Stubs are `available: false` → `409 PROVIDER_UNAVAILABLE`; implemented provider without key → `424 PROVIDER_NOT_CONFIGURED`; no silent mock fallback; `.env.example` selects mocks | Review |
| D11 | Approval requires **`qaStatus ∈ {PASS, WARN}`**; edit → `EDITED` + QA `PENDING` → QA again → approve again; sendable = APPROVED ∧ QA PASS/WARN ∧ NOT_SENT | Review |
| D12 | `ProviderCallError` (with `retryAfterMs`) + `withPolicy` timeout/retry (transient only) around provider calls; registry owns availability checks | Review |
| D13 | JWT secrets ≥ 32 chars, placeholders rejected; numeric env validated; `NODE_ENV` required; `.data/`, `.env`, `apps/web/.env.local` gitignored; `setup:env` refuses to overwrite without `--force` | Review |
| D14 | **`mock` is the default demo AI provider; `anthropic` is the primary real POC provider; `openai`/`gemini` are optional Phase 8 adapters.** Model IDs are configuration-driven (`AI_MODEL_<PURPOSE>` override → provider default) | Review |
| D15 | In-process `WorkflowRunner` with persisted steps and `JobDispatcher` seam | "Simple orchestration, boundaries for Inngest later" |
| D16 | Auth: email/password + JWT, seeded demo user; `/auth/refresh` public | Real but minimal |
| D17 | Clarifications are the single source of truth with deterministic server-assigned ids `clar:<criterionId|general>:<type>`; LLM proposals deduped; USER needs answer, DEFAULT needs proposedDefault; only the resolve endpoint sets USER state | Review |
| D18 | **One `IngestionService`** used by manual sync and workflow INGEST/NORMALIZE; ingestion stops at Company/Person; Prospects are created by QUALIFY | Review |
| D19 | Data sources are soft-archived (`ARCHIVED`), never physically deleted | Review |
| D20 | Docker Postgres on host port **5433** (`ports: "5433:5432"`; local PostgreSQL 18 already occupies 5432 on the dev machine) | Environment check |
| D21 | `CompanyMatcher`: domain → normalized name → ambiguous name-only match creates a new `Company` with `possibleDuplicate = true` | Review |
| D22 | Resolver list rule: top-ranked authoritative observation wins exactly; otherwise union of non-authoritative observations, lower-ranked authoritative ignored, result non-authoritative | Review |

## 3. Phases

Estimates are working days for one engineer. Each phase ends with a runnable state and a demo checkpoint.

### Phase 0 – Design docs (done)

`ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `docs/*`, `.env.example`.

### Phase 1 – Foundation (3–4 days)

Scope

- Monorepo: `pnpm-workspace.yaml`, root scripts, `packages/config` (tsconfig/eslint), `packages/shared` (Zod: ICP draft/strict + clarification helpers, canonical company, provider types, auth/project/workspace DTOs).
- `docker-compose.yml` (postgres:16, `ports: "5433:5432"`), `.gitignore`.
- `scripts/setup-env.mjs`: copies `.env.example` → `.env` with generated JWT secrets **and** writes `apps/web/.env.local` containing `NEXT_PUBLIC_API_URL`; **refuses to overwrite either file unless `--force`**.
- `apps/api`: NestJS skeleton, Zod-validated env (`config/env.ts`: JWT rules, numeric coercion/range checks), `config/paths.ts`, `PrismaService`, `ZodValidationPipe`, exception filter with `code`, `/health`.
- Prisma: **Tier 1 schema only** (incl. `Company.possibleDuplicate`, nullable `Prospect.score`, `Person.dedupeKey`, `DataSourceStatus.ARCHIVED`), initial migration, `seed.ts` (demo user/workspace/project, active demo ICP, `mock_apollo` data source with 8 raw `SourceRecord`s, normalized `Company` rows + `CompanyAttribute` ledger + `Person` rows, one completed `WorkflowRun` with `Prospect`s and `QualificationResult`s so list/detail pages have realistic data from day one; Linear seeded without employee count).
- Modules: `auth` (refresh public), `users`, `workspaces` (membership guard, `X-Workspace-Id` validation), `projects`, `analytics/overview` (derived KPIs).
- `apps/web`: Next.js 15 + Tailwind, app shell (sidebar, topbar), API client with refresh, auth middleware, pages **Login, Dashboard, Projects, Create Project**; placeholder routes for the remaining pages so navigation is complete.
- Tests: env validation, ICP draft/strict schema (incl. clarification consistency + unique ids), auth service, projects service (Jest); `prisma validate`; `pnpm build` for both apps.

Acceptance

- `pnpm setup:env && docker compose up -d && pnpm db:migrate && pnpm db:seed && pnpm dev` → login as `demo@databeat.io`, dashboard shows seeded KPIs, create/list projects.
- `pnpm test` and `pnpm build` green.

### Phase 2 – ICP (3–4 days)

- `ai` module: `AiProvider` (`mock`, `anthropic`; `openai`/`gemini` registered `available: false`), `AiService` (JSON Schema conversion, untrusted output → Zod safeParse, repair retry, `withPolicy`, `AiRun` persistence), prompt registry.
- `icp` module: chat endpoint with proposal dedupe + deterministic-id reconciliation, `PUT /draft` (clarifications ignored/preserved), resolve clarification (only USER-state writer), strict activation with `409 ICP_NOT_ACTIVATABLE`, versions.
- Prompt `icp.extract.v1.md`; mock extractor returns the demo ICP for the demo sentence and the "mid-size" zero-criteria draft for ambiguous input.
- UI: **Chat-based ICP setup** page (chat pane, live structured preview, unresolved-question cards with one-click accept default, separate "assumptions" list for DEFAULT clarifications, form editor for weights/required, Activate button gated by strict schema client-side with blocker list).

Acceptance: ambiguous message yields zero-criteria draft + blocking question without errors; answering enables Activate; activation creates version 2; re-asking the same question after another turn keeps the user's answer; a `PUT /draft` body containing clarifications does not change resolution state.

### Phase 3 – Data in (4–5 days)

- `providers` infra: `ProviderRegistry` (owns 404/409/424), `ProviderCtx`, `ProviderCallError` with `retryAfterMs`, `withPolicy`, catalogue.
- `connectors`: `csv` (papaparse, header heuristics, optional LLM mapping suggestion), `mock_apollo` (fixture with authoritative technographics/postings and people; Linear without employee count), `apollo` stub (`available: false`).
- `normalization`: **`IngestionService`** (`syncDataSource`, `normalizePending`, `resolveCompany`), dictionaries (industry/technology/country, explicit aliases), normalizers, **`CompanyMatcher`** (domain match → normalized-name match → ambiguous name-only match creates a new company with `possibleDuplicate = true`), `AttributeWriter`, `PersonWriter` (dedupeKey upsert), `Resolver` (single deterministic list rule).
- Unit tests: dictionaries on the 8 companies, resolver (authoritative winner / union / same-precedence case), person dedupe, **CompanyMatcher ambiguous-name → `possibleDuplicate`**.
- `data-sources`: CRUD with soft archive, upload → preview → mapping → READY, sync via `IngestionService`.
- UI: **Data Source configuration** (catalogue with available/configured/mock badges, add API source, filters, archive), **CSV upload + field mapping** (dropzone, preview table, mapping selects with suggestions, validation, sync button, results incl. possible duplicates).

Acceptance: upload sample CSV, confirm mapping, sync → companies appear with provenance; mock Apollo sync merges observations into the same companies by domain; provenance history shows both observations; a name-only CSV row matching two existing companies creates a flagged duplicate.

### Phase 4 – Qualification core + workflow (4–5 days)

- `qualification`: dependency map, deterministic evaluator (operator table, authoritative-absence rules, employeeRange fallback), scoring (**incl. `knownWeight = 0` → score null / coverage 0 / NEEDS_REVIEW**), Prospect creation for the run, results/evidence persistence, `aiReasoning` template.
- `workflow`: `WorkflowRunner`, `WorkflowStep` impls INGEST (optional refresh via `IngestionService`) / NORMALIZE / QUALIFY (+ ENRICH/REQUALIFY skeleton marked SKIPPED until Phase 5), `InProcessJobDispatcher`, run/step persistence, cancel/retry.
- `prospects`: list with filters (score sort nulls last), detail aggregate (company incl. `possibleDuplicate`, people from `Person`, raw records, results, evidence), attribute history.
- Unit tests: evaluator per operator incl. authoritative absence; scoring thresholds; **zero-known-weight case**; required-UNKNOWN policy.
- UI: **Workflow overview** (run button with options incl. refresh sources, step timeline with live polling, counters), **Prospect list** (status badges, score bars with "—" for null, duplicate badge, criterion filter), **Prospect detail** (tabs: Overview, Source data, Normalized with provenance chips + history, ICP results, AI reasoning, Emails).

Acceptance: run on seeded data → Databricks/Figma/Canva/Stripe/Slack DISQUALIFIED with correct reasons; Notion/Webflow show UNKNOWN for missing revenue; Linear shows UNKNOWN on the required employee criterion; a synthetic company with no evaluable data shows score "—" and NEEDS_REVIEW.

### Phase 5 – Enrichment + LLM assessment (3–4 days)

- `enrichment`: missing-set computation (UNKNOWN criteria with `enrichIfMissing`, soft and required), `mock_enrichment` (Notion/Webflow revenue supplied; **Linear `employeeCount` and `revenueUsd` `unavailable`**), `apollo_enrich` stub (`available: false`), `EnrichmentRun` persistence, skip-if-hard-failed, `IngestionService.resolveCompany` after writes.
- Workflow ENRICH + REQUALIFY steps; POST_ENRICHMENT phase; LLM assessor with batching, cap, cache, evidenceRefs validation, confidence gate; prompt `qualify.assess.v1.md`; mock assessor fixture.
- Prospect detail: enrichment runs panel, phase comparison (INITIAL vs POST_ENRICHMENT), LLM reasoning with cited evidence; per-prospect enrich action with the same default field selection.

Acceptance: Notion & Webflow become QUALIFIED after enrichment; **Linear is NEEDS_REVIEW deterministically** because the required `employees_100_500` criterion remains UNKNOWN after enrichment; hiring criterion shows PASS with cited job postings; Slack hiring FAIL (authoritative, no sales roles).

### Phase 6 – Email generation, QA, review (3–4 days)

- `email-generation`: recipient selection from `Person`, prompt `email.generate.v1.md`, `Message` creation with immutable generated copy.
- `qa`: prompt `email.qa.v1.md`, `qaResult`/`qaStatus`, unsupported-claim detection against supplied facts.
- Review endpoints and state machine: **approve requires `qaStatus ∈ {PASS, WARN}`** (`409 QA_NOT_PASSED` otherwise, including QA FAIL); edit → `EDITED` + QA `PENDING`; QA FAIL must be edited/regenerated and QA'd again.
- UI: **Email generation/review** page (queue by review status, side-by-side email + QA scorecard with unsupported claims highlighted, edit with re-QA, approve/reject with notes, regenerate; Approve disabled unless QA PASS/WARN).

Acceptance: an edit that introduces an unsupported claim yields QA WARN/FAIL; Approve is blocked until QA re-runs and returns PASS/WARN; approved email becomes sendable.

### Phase 7 – Campaigns, outbound, analytics, settings, usage (3–4 days)

- `campaigns` + `outbound`: `simulated` provider (`<DATA_DIR>/outbox/*.eml`), `smtp` stub (`available: false`), sendability enforcement, skipped-with-reason report.
- `analytics`: project funnel, criterion breakdown, score histogram (null bucket "no evidence"); `usage`: token/cost aggregates from `AiRun`.
- `settings`: provider catalogue + selection (409 stubs, 424 unconfigured), prompts list, effective models.
- Optional Tier 2 tables (`UsageLog`, `AuditLog`) only if ahead of schedule.
- UI: **Campaigns / outbound**, **Analytics** (funnel, status donut, score histogram, AI cost), **Settings** (providers with available/configured badges, models, prompts, workspace).

Acceptance: send campaign → sendable messages `SENT_SIMULATED`, `.eml` files written, non-sendable listed with reasons; analytics reflects the run; selecting `anthropic` without key shows a clear 424 in Settings; `openai`/`smtp`/`apollo` show as unavailable stubs.

### Phase 8 – Hardening and polish (2–3 days)

- Optional adapters: `openai` / `gemini` (flip `available`), `smtp` via nodemailer, `apollo` / `apollo_enrich` if a key is available for verification.
- Empty states, error toasts, loading skeletons, responsive pass for all 14 pages.
- README with run instructions; seed polish; demo script.
- Test sweep: dictionaries, evaluator (incl. authoritative absence), scoring (incl. zero-known-weight), ICP schemas + reconciliation, resolver, person dedupe, company matcher, review state machine, API e2e smoke.

## 4. Implementation order (critical path)

```
P1 foundation ─► P2 ICP ─► P3 data in ─► P4 qualification+workflow ─► P5 enrichment+LLM ─► P6 email+QA+review ─► P7 campaigns/analytics/settings ─► P8 polish
                 └ AiService (P2) is reused by P3 mapping suggestion, P5 assessor, P6 generation/QA
                 └ ProviderRegistry + IngestionService (P3) are reused by P4 workflow, P5 enrichment, P7 outbound/settings
```

Parallelizable with two engineers: UI pages for a phase can start once that phase's DTOs land in `packages/shared`; this is what compresses the schedule to 3–5 weeks.

## 5. Real vs mocked

| Area | POC (`available: true`) | Stubs (`available: false`) / notes |
|---|---|---|
| Auth, DB, Prisma, migrations, seed | real | |
| CSV connector, mapping UI | real | |
| API connector | `mock_apollo` (explicit) | `apollo` stub; key only sets `configured` |
| Normalization, matching, dictionaries, resolver, ingestion, provenance | real | |
| Deterministic qualification, scoring, workflow runner | real | |
| ICP extraction, LLM assessment, email generation, QA | `anthropic` (with key) and `mock` (default) | `openai`, `gemini` stubs |
| Enrichment | `mock_enrichment` fixture | `apollo_enrich` stub |
| Outbound | `simulated` | `smtp` stub |
| Analytics, usage | real queries over Tier 1 tables | |
| Audit | app log | Tier 2 table optional |
| Credential storage | env vars | Tier 3 documented |

## 6. Environment variables

Full list with comments in [.env.example](.env.example). Required to boot: `NODE_ENV`, `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET` (≥ 32 chars, no placeholders), `API_PORT`, `WEB_URL`, `AI_PROVIDER` (`mock | anthropic`), `ENRICHMENT_PROVIDER`, `OUTBOUND_PROVIDER`, `DATA_DIR`. The web app reads `NEXT_PUBLIC_API_URL` from `apps/web/.env.local`, generated by `pnpm setup:env`. Numeric variables are coerced and range-checked at startup. Provider keys are required only when the corresponding implemented provider is selected. Model overrides (`AI_MODEL_*`) are blank by default; providers own their defaults.

## 7. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | LLM fabricates qualification verdicts or email claims | Evidence-only prompts; `evidenceRefs` validated against supplied attribute ids; confidence gate; QA unsupported-claim check; untrusted output validated by Zod; every call stored in `AiRun` |
| R2 | CSV mapping errors produce garbage companies | Preview + suggested mapping + user confirmation; `identity.name` required; per-row Zod validation with rejected-row report; dedupe by domain; `possibleDuplicate` flag for ambiguous name-only rows |
| R3 | LLM cost/time blow-up per run | Hard filters before any LLM call; batching; fast tier for assessments; `MAX_LLM_PROSPECTS_PER_RUN`; cache by `(icp, criterion, resolvedHash)` |
| R4 | Enrichment over-use / rate limits / flaky providers | Only `missing ∩ supported` for non-disqualified prospects; concurrency limit; `withPolicy` timeouts, transient-only retries honouring `retryAfterMs` |
| R5 | False negatives from taxonomy gaps | Unmapped → UNKNOWN (never FAIL); explicit alias dictionaries with tests; `dictionary.unmapped` log |
| R6 | Treating missing data as absence, or no evidence as a bad score | Authoritative flags on list groups; EXISTS/CONTAINS rules; CSV never authoritative; `knownWeight = 0` → score null + NEEDS_REVIEW |
| R7 | Schema churn between UI and API | Zod schemas in `packages/shared`; `schemaVersion` on ICP and canonical; versioned prompts |
| R8 | Silent mock data or stub providers mistaken for real results | No fallback; `isMock`/`available`/`configured` badges in UI; 409 for stubs, 424 for unconfigured implemented providers |
| R9 | Secrets leakage | Env-only; never in API responses, logs, `AiRun.input` or step outputs; startup validation of JWT secrets |
| R10 | Scope creep across 14 pages | Shared UI kit; seeded data from Phase 1; phase gates with acceptance checks; Tier 2/3, extra AI vendors and real Apollo/SMTP deferred |
| R11 | Two ingestion paths drifting | Single `IngestionService`; workflow INGEST/NORMALIZE call it; tests cover both entry points |
| R12 | Windows dev environment friction (paths, port clash, env propagation) | Paths resolved from repo root; `DATA_DIR` configurable; Docker Postgres on 5433; `setup:env` writes `apps/web/.env.local` |

## 8. Definition of done (POC)

- Demo script runs end to end on a fresh clone with `AI_PROVIDER=mock` and no external keys.
- Switching `AI_PROVIDER=anthropic` with a key produces real extraction/assessment/emails without code changes.
- All 14 pages render with seeded data and are responsive.
- Unit tests cover: env validation, ICP draft/strict schemas + clarification reconciliation, dictionaries, deterministic evaluator (incl. authoritative absence), scoring (incl. zero-known-weight), resolver (authoritative winner, union, same-precedence), person dedupe, company matcher (`possibleDuplicate`), review state machine.
- `pnpm build`, `pnpm test`, `prisma validate` green.

## 9. Requested-items checklist

| # | Requested | Where |
|---|---|---|
| 1 | Inspect repository | Empty directory confirmed; greenfield |
| 2 | Don't overwrite working code | Nothing existed |
| 3 | IMPLEMENTATION_PLAN.md | this file |
| 4 | ARCHITECTURE.md | [ARCHITECTURE.md](ARCHITECTURE.md) |
| 5 | Folder structure | ARCHITECTURE §4 |
| 6 | Database schema | [docs/schema.prisma.md](docs/schema.prisma.md) |
| 7 | Canonical model | [docs/canonical-model.md](docs/canonical-model.md) |
| 8 | ICP JSON schema | [docs/icp-schema.md](docs/icp-schema.md) |
| 9 | Provider/connector interfaces | [docs/provider-interfaces.md](docs/provider-interfaces.md) |
| 10 | API endpoints | [docs/api-endpoints.md](docs/api-endpoints.md) |
| 11 | Phases | §3 |
| 12 | Real vs mocked | §5, ARCHITECTURE §13 |
| 13 | Environment variables | §6, [.env.example](.env.example) |
| 14 | Major risks | §7 |
| 15 | Implementation order | §4 |
