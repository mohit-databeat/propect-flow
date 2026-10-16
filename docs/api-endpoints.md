# REST API Endpoints

Base URL `http://localhost:4000/api/v1`. All endpoints require `Authorization: Bearer <accessToken>` **except** `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh` (authenticates with the refresh token in the body) and `GET /health`.

**Workspace resolution.** The POC is single-workspace per user: the active workspace is derived from the authenticated user's `WorkspaceMember` row. `X-Workspace-Id` is optional; when present the guard verifies membership and returns `403 NOT_A_WORKSPACE_MEMBER` otherwise. Every query is scoped by the resolved `workspaceId`.

**Provider state errors (applied uniformly wherever a provider key is selected or used: data sources, enrichment, AI, outbound/campaigns, settings):**

| Condition | Response |
|---|---|
| Unknown provider key | `404 PROVIDER_NOT_FOUND` |
| Provider is a documented stub (`available: false`) | `409 PROVIDER_UNAVAILABLE` — credentials do not change this |
| Implemented provider with missing `requiredCredentials` | `424 PROVIDER_NOT_CONFIGURED` — no fallback to mock |

Request and response bodies are validated with Zod DTOs from `packages/shared/src/dto/`. Errors follow `{ statusCode, code, message, details? }`. List endpoints accept `?page=1&pageSize=25&sort=field:asc|desc`.

Phase column shows when each endpoint is implemented.

## auth (Phase 1)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | public | Create user + personal workspace. Body `{ email, password, name }` |
| POST | `/auth/login` | public | `{ email, password }` -> `{ accessToken, refreshToken, user }` |
| POST | `/auth/refresh` | public (refresh token in body) | `{ refreshToken }` -> new token pair. Not behind the access-token guard |
| GET | `/auth/me` | bearer | Current user + memberships |

## workspaces (Phase 1)

| Method | Path | Purpose |
|---|---|---|
| GET | `/workspaces/current` | Active workspace incl. `settings` |
| PATCH | `/workspaces/current` | Update name / `settings` (provider keys, sourcePrecedence). Provider state errors apply |
| GET | `/workspaces/current/members` | Members and roles |

## projects (Phase 1)

| Method | Path | Purpose |
|---|---|---|
| GET | `/projects` | List with counts (prospects, qualified, last run) |
| POST | `/projects` | `{ name, description? }` |
| GET | `/projects/:id` | Detail incl. active ICP summary, data sources, latest run |
| PATCH | `/projects/:id` | Update name/description/status |
| DELETE | `/projects/:id` | Archive (soft, `status: ARCHIVED`) |
| DELETE | `/projects/:id/permanent` | **Hard delete** — removes the project and everything under it (companies, prospects, ICP profiles, data sources, workflow runs, messages) via cascade. Irreversible. |
| POST | `/projects/:id/unarchive` | Reverses archive — `status` back to `DRAFT`. No-op if the project isn't archived. |

## dashboard / analytics (Phase 1 overview, Phase 7 full)

| Method | Path | Purpose |
|---|---|---|
| GET | `/analytics/overview` | Workspace KPIs: projects, companies, prospects by status, emails by review/send status, AI tokens & cost, enrichment calls. Derived from Tier 1 tables |
| GET | `/analytics/projects/:id` | Per-project funnel: ingested -> normalized -> evaluated -> qualified -> emailed -> approved -> sent; criterion PASS/FAIL/UNKNOWN breakdown; score histogram (null scores shown as "no evidence") |

## icp (Phase 2)

| Method | Path | Purpose |
|---|---|---|
| GET | `/projects/:id/icp` | Active profile and current draft: `definition`, `chatTranscript`, `unresolvedClarifications`, `defaultedAssumptions` (both derived), `activatable`, `blockers: [{ path, message }]` |
| GET | `/projects/:id/icp/versions` | All versions |
| POST | `/projects/:id/icp/chat` | `{ message }` -> extractor over full transcript + previous clarifications; server dedupes proposals, assigns deterministic ids, reconciles USER answers; saves **draft** (`IcpDraftDefinition`, zero criteria allowed). Returns `{ assistantMessage, draft, unresolvedClarifications, defaultedAssumptions, unsupported, activatable, blockers }` |
| PUT | `/projects/:id/icp/draft` | Form-editor update of `name`, `summary`, `targetPersonas`, `criteria`, `scoring` (validated against `IcpDraftDefinition` minus `clarifications`). **Clarifications in the body are ignored**; server-managed clarifications are preserved and re-attached. Cannot change `resolvedBy`/`answer` |
| POST | `/projects/:id/icp/clarifications/:clarId/resolve` | `{ answer }` (non-empty) -> sets `answer`, `resolvedBy: USER`. **Only endpoint that resolves clarifications.** Re-runs extractor if a criterion depends on the answer. 404 for unknown id |
| POST | `/projects/:id/icp/activate` | Validates draft against strict `IcpDefinition` (≥1 criterion, ≥1 with weight > 0, unique ids, no open BLOCKING). **409 `ICP_NOT_ACTIVATABLE`** `{ issues, openBlocking }` on failure. Success creates a new ACTIVE version and archives the previous one |

## data-sources & connectors (Phase 3)

| Method | Path | Purpose |
|---|---|---|
| GET | `/connectors` | Catalogue from `ProviderRegistry`: key, displayName, type, capabilities, `isMock`, `available`, `configured` |
| GET | `/projects/:id/data-sources` | List (excludes ARCHIVED unless `?includeArchived=true`) |
| POST | `/projects/:id/data-sources` | `{ type, providerKey, name, config }` (API sources). Provider state errors apply |
| GET | `/projects/:id/data-sources/:dsId` | Detail incl. mapping, record count, last sync |
| PATCH | `/projects/:id/data-sources/:dsId` | Update name/config/filters |
| DELETE | `/projects/:id/data-sources/:dsId` | **Soft archive**: `status: ARCHIVED`. `SourceRecord`s, `CompanyAttribute` provenance and companies are preserved; archived sources are excluded from future syncs and workflow runs |
| POST | `/projects/:id/data-sources/csv/upload` | multipart `file` -> stores under `<DATA_DIR>/uploads`, parses headers + 20 sample rows, returns `{ dataSourceId, columns, sampleRows, suggestedMapping, confidence }` (status DRAFT) |
| PUT | `/projects/:id/data-sources/:dsId/mapping` | `{ mapping }` -> validates (`identity.name` mapped, no duplicate targets), status READY |
| POST | `/projects/:id/data-sources/:dsId/test` | Connector `testConnection` |
| POST | `/projects/:id/data-sources/:dsId/sync` | `IngestionService.syncDataSource`: fetch -> `SourceRecord`s (idempotent by payloadHash) -> normalize -> `CompanyMatcher` (may set `possibleDuplicate`) -> `Person` upsert -> resolve. **Stops at Company/Person; no Prospect creation.** Returns `{ fetched, created, skipped, normalizationErrors, possibleDuplicates }` |
| GET | `/projects/:id/data-sources/:dsId/records` | Paged raw records with `normalizedCompanyId` |

## workflow (Phase 4+)

| Method | Path | Purpose |
|---|---|---|
| POST | `/projects/:id/workflow-runs` | `{ dataSourceIds?, refreshSources?: false, enrich?: true, generateEmails?: false, maxLlmProspects? }` -> `202 { runId }`. **409 `ICP_NOT_ACTIVE`** without an active ICP. **409 `PROJECT_ARCHIVED`** if the project is archived — unarchive it first. `refreshSources: true` re-syncs the selected sources via the same `IngestionService` before qualifying; default reuses already-synced companies |
| GET | `/projects/:id/workflow-runs` | Run history |
| GET | `/projects/:id/workflow-runs/:runId` | Status, `currentStep`, steps with timings/outputs, summary counters (polled by UI) |
| POST | `/projects/:id/workflow-runs/:runId/cancel` | Cooperative cancel between steps |
| POST | `/projects/:id/workflow-runs/:runId/retry` | Re-run from first FAILED step (idempotent steps are skipped) |

## prospects (Phase 4, enrichment actions Phase 5)

| Method | Path | Purpose |
|---|---|---|
| GET | `/projects/:id/prospects` | Latest run by default (`?runId=` to pin). Filters `status`, `minScore`, `q` (name/domain), `criterion=<id>:<PASS|FAIL|UNKNOWN>`, `possibleDuplicate`. Sort by score (nulls last)/name/status |
| GET | `/projects/:id/prospects/:prospectId` | Full detail: `company` (columns incl. `possibleDuplicate` + `canonical` + `provenance`), `people[]` (from `Person`), `sourceRecords[]` (raw), `results[]` grouped by phase with `evidence[]`, `enrichmentRuns[]`, `aiRuns[]` (reasoning), `messages[]` |
| GET | `/projects/:id/prospects/:prospectId/attributes` | Full provenance ledger for the company (history per field) |
| POST | `/projects/:id/prospects/:prospectId/requalify` | Re-run QUALIFY (+ LLM) for one prospect against the run's ICP |
| POST | `/projects/:id/prospects/:prospectId/enrich` | `{ fields? }` -> targeted enrichment. **Default = the fields required by criteria currently UNKNOWN where `enrichIfMissing = true`** (soft and required alike), intersected with `provider.supportedFields()`; skipped with reason if the prospect already FAILED a required criterion. Then requalify. Provider state errors apply |
| PATCH | `/projects/:id/prospects/:prospectId/company` | Manual override of canonical fields -> `CompanyAttribute` rows with `sourceType: MANUAL`, then `IngestionService.resolveCompany`. May also clear `possibleDuplicate` |

## messages / email generation / QA (Phase 6)

Review state machine:

```
generate            -> reviewStatus PENDING,  qaStatus PASS|WARN|FAIL from automatic QA
approve             -> requires qaStatus in (PASS, WARN)          -> reviewStatus APPROVED
reject              -> reviewStatus REJECTED
edit (PATCH)        -> reviewStatus EDITED,   qaStatus PENDING     (NOT approvable, NOT sendable)
qa                  -> qaStatus recomputed on current subject/body
approve after edit  -> requires qaStatus in (PASS, WARN)          -> reviewStatus APPROVED
QA FAIL             -> must be edited or regenerated, then QA'd again; never approvable as-is
sendable            =  reviewStatus APPROVED && qaStatus in (PASS, WARN) && sendStatus NOT_SENT
```

| Method | Path | Purpose |
|---|---|---|
| POST | `/projects/:id/messages/generate` | `{ prospectIds[], personaHint?, campaignId? }` -> one email per prospect (recipient chosen from `Person` by `targetPersonas`), runs QA, returns messages. AI provider state errors apply |
| GET | `/projects/:id/messages` | Filters `reviewStatus`, `qaStatus`, `sendStatus`, `campaignId` |
| GET | `/projects/:id/messages/:msgId` | Message + `qaResult` + generation/QA `aiRuns` + prospect summary |
| POST | `/projects/:id/messages/:msgId/qa` | Re-run QA on current subject/body |
| PATCH | `/projects/:id/messages/:msgId` | `{ subject?, body? }` -> `reviewStatus: EDITED`, `qaStatus: PENDING` |
| POST | `/projects/:id/messages/:msgId/approve` | `{ note? }`. **409 `QA_NOT_PASSED`** unless `qaStatus in (PASS, WARN)` |
| POST | `/projects/:id/messages/:msgId/reject` | `{ note }` |
| POST | `/projects/:id/messages/:msgId/regenerate` | New generation + QA; previous kept in `aiRuns` history |

## campaigns / outbound (Phase 7)

| Method | Path | Purpose |
|---|---|---|
| GET | `/projects/:id/campaigns` | List with counts by send status |
| POST | `/projects/:id/campaigns` | `{ name, outboundProviderKey?, senderConfig }`. Provider state errors apply (`smtp` stub → 409; implemented provider without creds → 424) |
| GET | `/projects/:id/campaigns/:cId` | Detail + messages |
| PATCH | `/projects/:id/campaigns/:cId` | Update status/sender/provider. Provider state errors apply |
| POST | `/projects/:id/campaigns/:cId/messages` | `{ messageIds[] }` attach messages (any review state; sending filters) |
| POST | `/projects/:id/campaigns/:cId/send` | Sends every attached message that is **sendable**. Others are skipped and listed with a reason. `simulated` -> `SENT_SIMULATED`. Provider state errors apply |
| GET | `/outbound/providers` | Catalogue with `isMock` / `available` / `configured` flags |

## settings, usage (Phase 7)

| Method | Path | Purpose |
|---|---|---|
| GET | `/settings/providers` | AI / enrichment / outbound / connector catalogue with `configured`, `available`, `isMock` and current selection |
| PATCH | `/settings/providers` | `{ aiProviderKey?, enrichmentProviderKey?, outboundProviderKey? }` -> `Workspace.settings`. Provider state errors apply |
| GET | `/settings/prompts` | Prompt templates with versions (read-only in POC) |
| GET | `/settings/models` | Effective model per purpose (env override or provider default) |
| GET | `/usage` | Aggregated from `AiRun` and `EnrichmentRun`: tokens, estimated cost, calls by purpose/provider, by day |

## Health

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | `{ status, db: "ok", providers: { ai: { key, available, configured }, enrichment: {...}, outbound: {...} } }` |

## Error codes used by the UI

| Code | HTTP | When |
|---|---|---|
| `NOT_A_WORKSPACE_MEMBER` | 403 | `X-Workspace-Id` names a workspace the user does not belong to |
| `ICP_NOT_ACTIVATABLE` | 409 | Activate on a draft failing the strict schema (no criteria, no weight > 0, open BLOCKING clarifications, duplicate ids) |
| `ICP_NOT_ACTIVE` | 409 | Starting a workflow run without an active ICP |
| `CLARIFICATION_NOT_FOUND` | 404 | Resolve with an unknown clarification id |
| `DATA_SOURCE_NOT_READY` | 409 | Sync before mapping confirmed, or source ARCHIVED |
| `MAPPING_INVALID` | 422 | `identity.name` not mapped or duplicate targets |
| `QA_NOT_PASSED` | 409 | Approve while `qaStatus` is PENDING or FAIL |
| `MESSAGE_NOT_SENDABLE` | 409 | Send attempt on a message that is not APPROVED with QA PASS/WARN |
| `PROVIDER_NOT_FOUND` | 404 | Unknown provider key |
| `PROVIDER_UNAVAILABLE` | 409 | Provider is a documented stub (`available: false`); credentials do not change this |
| `PROVIDER_NOT_CONFIGURED` | 424 | Implemented provider selected but env credentials missing. No fallback to mock |
| `AI_OUTPUT_INVALID` | 502 | LLM failed schema validation twice |
