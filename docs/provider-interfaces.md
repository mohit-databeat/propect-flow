# Provider / Connector Interfaces

Every external dependency sits behind an interface and is looked up through a registry. Business modules depend on the interfaces only. Concrete implementations live in the module that owns them (`connectors/`, `enrichment/providers/`, `ai/providers/`, `outbound/providers/`).

## POC policies

- **Credentials come from environment variables** (`ANTHROPIC_API_KEY`, `APOLLO_API_KEY`, `SMTP_*`). Per-workspace encrypted credential storage is a documented production extension (Tier 3). Provider selection per workspace is stored in `Workspace.settings`.
- **`available` and `configured` are separate.** `available` = the adapter is actually implemented and selectable. `configured` = its `requiredCredentials` are present in env. **Credentials never make a stub available.** A documented stub is `available: false` even when its key exists; the registry rejects selecting it with `409 PROVIDER_UNAVAILABLE`. An implemented provider without credentials fails with `424 PROVIDER_NOT_CONFIGURED`.
- **No silent fallback to mocks.** Mock providers (`mock`, `mock_apollo`, `mock_enrichment`, `simulated`) must be selected explicitly. `.env.example` selects mocks so the POC runs without keys.
- **POC implementation scope**

  | Kind | Implemented (`available: true`) | Documented stubs (`available: false`) |
  |---|---|---|
  | AI | `mock`, `anthropic`, `gemini` | `openai` |
  | Connector | `csv`, `mock_apollo` | `apollo` |
  | Enrichment | `mock_enrichment` | `apollo_enrich` |
  | Outbound | `simulated` | `smtp` |

- **Untrusted provider output.** `AiProvider.generateStructured()` returns `data: unknown`. Only `AiService` validates with Zod and exposes typed data.
- **Normalized errors + simple timeout/retry** around every external call (below). Not a circuit breaker, not a queue.
- **Availability check has one owner**: `ProviderRegistry.<kind>(key)` throws `PROVIDER_UNAVAILABLE`; services do not re-check.

## Shared types

```ts
// packages/shared/src/providers/types.ts
import type { CanonicalFieldPath } from "../schemas/icp.schema";
import type { CanonicalPartial, CanonicalPerson } from "../schemas/canonical-company.schema";

export interface ProviderCtx {
  workspaceId: string;
  projectId?: string;
  logger: Logger;
  credentials: Record<string, string | undefined>;   // POC: pulled from env by ProviderRegistry.ctxFor()
  signal?: AbortSignal;                              // set by withPolicy()
}

export interface RawRecord {
  externalId?: string;
  payload: Record<string, unknown>;       // stored verbatim in SourceRecord.rawPayload
}

export interface NewAttribute {
  field: CanonicalFieldPath;
  value: unknown;                         // list groups are stored whole: { items, authoritative, checkedAt }
  confidence: number;                     // 0-100
  observedAt?: string;                    // ISO; defaults to now
}

export interface MappedRecord {
  canonical: CanonicalPartial;            // never contains provenance
  attributes: NewAttribute[];             // observations with per-field confidence
  people: CanonicalPerson[];              // upserted into the Person table by IngestionService
}

// Common metadata every provider exposes (connector, enrichment, AI, outbound)
export interface ProviderMeta {
  readonly key: string;
  readonly displayName: string;
  readonly isMock: boolean;
  readonly available: boolean;            // implemented & selectable; independent of credentials
  readonly requiredCredentials: string[]; // env var names; [] for csv and mocks
}
```

## ProviderCallError and resilience policy

Every adapter translates SDK / network / HTTP failures into one error shape so `withPolicy()` can decide uniformly.

```ts
// apps/api/src/common/provider-call.error.ts
export type ProviderErrorCode =
  | "TIMEOUT" | "NETWORK" | "RATE_LIMITED" | "SERVER_ERROR"          // retryable
  | "AUTH" | "FORBIDDEN" | "NOT_FOUND" | "BAD_REQUEST" | "VALIDATION" // permanent
  | "NOT_CONFIGURED" | "UNAVAILABLE" | "UNKNOWN";

export class ProviderCallError extends Error {
  readonly providerKey: string;
  readonly code: ProviderErrorCode;
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;         // from Retry-After / provider hints on 429; honoured by withPolicy
  readonly cause?: unknown;

  static fromHttp(providerKey: string, status: number, message: string, opts?: { retryAfterMs?: number; cause?: unknown }): ProviderCallError;
  static fromUnknown(providerKey: string, err: unknown): ProviderCallError;   // AbortError→TIMEOUT, fetch failures→NETWORK, else UNKNOWN (retryable: false)
}
export class ProviderNotConfiguredError extends ProviderCallError { /* code NOT_CONFIGURED, HTTP 424 */ }
export class ProviderUnavailableError   extends ProviderCallError { /* code UNAVAILABLE,     HTTP 409 */ }

// apps/api/src/common/resilience.ts
export interface CallPolicy { timeoutMs: number; maxAttempts: number; backoffMs: number; }

export const POLICIES = {
  ai:         { timeoutMs: 60_000, maxAttempts: 3, backoffMs: 1_000 },
  connector:  { timeoutMs: 30_000, maxAttempts: 3, backoffMs: 1_000 },
  enrichment: { timeoutMs: 15_000, maxAttempts: 3, backoffMs: 500 },
  outbound:   { timeoutMs: 15_000, maxAttempts: 2, backoffMs: 1_000 },
} satisfies Record<string, CallPolicy>;

// Runs fn with an AbortSignal that fires at timeoutMs. Retries only when the thrown error is a
// ProviderCallError with retryable === true (TIMEOUT, NETWORK, RATE_LIMITED, SERVER_ERROR).
// delay = error.retryAfterMs ?? policy.backoffMs * attempt   (capped at 30 s)
// Non-ProviderCallError exceptions are wrapped via ProviderCallError.fromUnknown. Attempts are logged;
// the final error is rethrown unchanged.
export function withPolicy<T>(policy: CallPolicy, providerKey: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T>;
```

HTTP mapping used by `fromHttp`: 429 → `RATE_LIMITED` (retryable, `retryAfterMs` parsed from `Retry-After` seconds or HTTP-date); 408/425 → `TIMEOUT` retryable; 5xx → `SERVER_ERROR` retryable; 401 → `AUTH`; 403 → `FORBIDDEN`; 404 → `NOT_FOUND`; 400 → `BAD_REQUEST`; 422 → `VALIDATION`; all permanent. `AiOutputInvalidError` (schema failure after the repair retry) is a separate domain error and is never retried by the policy.

## DataSourceConnector

```ts
export interface ConnectorCapabilities {               // functional capabilities only
  supportsSearch: boolean;                              // can filter server-side
  supportsPaging: boolean;
  requiresMapping: boolean;                             // CSV: true; API providers: false
  suppliesFields: CanonicalFieldPath[];
  suppliesPeople: boolean;
}

export interface FetchQuery { filters?: Record<string, unknown>; cursor?: string; limit: number; }

export interface FieldMapping {
  [sourceKey: string]: CanonicalFieldPath | null;     // source column -> canonical field (null = ignore)
}

export interface DataSourceConnector extends ProviderMeta {
  readonly type: "CSV" | "API";
  capabilities(): ConnectorCapabilities;

  testConnection(ctx: ProviderCtx, config: unknown): Promise<{ ok: boolean; message?: string }>;

  fetchRecords(ctx: ProviderCtx, config: unknown, query: FetchQuery)
    : Promise<{ records: RawRecord[]; nextCursor?: string }>;

  // Deterministic, no I/O. Never returns provenance.
  mapToCanonical(raw: RawRecord, mapping?: FieldMapping): MappedRecord;

  // CSV only: propose header -> field mapping (heuristics; optional LLM refinement via AiService).
  suggestMapping?(headers: string[], sampleRows: Record<string, string>[])
    : Promise<{ mapping: FieldMapping; confidence: Record<string, number> }>;
}
```

POC implementations

| Key | Type | available | requiredCredentials | Notes |
|---|---|---|---|---|
| `csv` | CSV | true | [] | `papaparse`; header heuristics; optional LLM mapping suggestion when the selected AI provider is configured |
| `mock_apollo` | API | true (mock) | [] | fixture of the eight demo companies incl. authoritative technographics, authoritative job postings, people; supports `filters.domains[]` and paging. Linear has no employee count |
| `apollo` | API | **false** (documented stub) | ["APOLLO_API_KEY"] | `configured` reflects whether the key exists; selection → `409 PROVIDER_UNAVAILABLE` until the adapter is implemented |

## EnrichmentProvider

```ts
export interface EnrichmentResult {
  attributes: NewAttribute[];             // only fields actually found (list groups may be authoritative-empty)
  unavailable: CanonicalFieldPath[];      // requested but not supplied; never fabricated
  costUnits: number;
  raw?: unknown;                          // stored on EnrichmentRun.rawResponse
}

export interface EnrichmentProvider extends ProviderMeta {
  readonly rateLimit: { rpm: number; concurrency: number };
  supportedFields(): CanonicalFieldPath[];
  enrich(ctx: ProviderCtx, company: CanonicalCompany, fields: CanonicalFieldPath[]): Promise<EnrichmentResult>;
}
```

Contract: every requested field appears either in `attributes` or in `unavailable`. Returning a guessed value is a contract violation. Implementations: `mock_enrichment` (`available: true`; returns `unavailable` for Linear's `employeeCount` and `revenueUsd`), `apollo_enrich` (`available: false`, documented stub).

## AiProvider and AiService

```ts
export type AiTier = "fast" | "strong";

export interface AiProvider extends ProviderMeta {
  readonly key: "mock" | "anthropic" | "openai" | "gemini";
  defaultModel(tier: AiTier): string;           // provider-owned defaults; overridable via AI_MODEL_<PURPOSE>

  generateStructured(req: {
    model: string;
    system: string;
    messages: { role: "user" | "assistant"; content: string }[];
    jsonSchema: Record<string, unknown>;        // JSON Schema derived from the Zod schema by AiService
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<{
    data: unknown;                              // UNTRUSTED – validated by AiService
    rawText: string;
    usage: { inputTokens: number; outputTokens: number };
    model: string;
  }>;
}

export interface AiCallOptions<T> {
  purpose: AiPurpose;                           // ICP_EXTRACTION | CSV_MAPPING_SUGGEST | QUALITATIVE_ASSESS | EMAIL_GENERATE | EMAIL_QA
  promptKey: string;                            // "icp.extract" -> apps/api/prompts/icp.extract.v1.md
  variables: Record<string, unknown>;
  schema: z.ZodType<T>;
  tier?: AiTier;                                // default per purpose (fast for assess/mapping, strong otherwise)
  refType?: string; refId?: string;             // AiRun linkage
}

export interface AiService {
  call<T>(ctx: ProviderCtx, opts: AiCallOptions<T>): Promise<{ data: T; aiRunId: string }>;

  extractIcp(ctx: ProviderCtx, transcript: ChatMessage[], previous: IcpDraftDefinition | null)
    : Promise<{ data: IcpExtractionOutput; aiRunId: string }>;
  suggestCsvMapping(ctx: ProviderCtx, headers: string[], sampleRows: Record<string, string>[])
    : Promise<{ data: FieldMappingSuggestion; aiRunId: string }>;
  assessCriteria(ctx: ProviderCtx, batch: AssessmentBatch)
    : Promise<{ data: AssessmentOutput; aiRunId: string }>;
  generateEmail(ctx: ProviderCtx, input: EmailGenerationInput)
    : Promise<{ data: EmailDraft; aiRunId: string }>;
  qaEmail(ctx: ProviderCtx, input: EmailQaInput)
    : Promise<{ data: EmailQaResult; aiRunId: string }>;
}
```

`AiService.call<T>` behaviour

1. Resolve provider key from `workspace.settings.aiProviderKey`, fallback `AI_PROVIDER` env. `registry.ai(key)` throws `409 PROVIDER_UNAVAILABLE` for stubs; `registry.ctxFor()` throws `424 PROVIDER_NOT_CONFIGURED` when `requiredCredentials` are missing. No fallback to `mock`.
2. Resolve model: `AI_MODEL_<PURPOSE>` env if set, else `provider.defaultModel(tier)`.
3. Load `prompts/<promptKey>.v<n>.md` (front-matter `version`, `purpose`, `tier`), render `{{variables}}`. Convert `opts.schema` to JSON Schema.
4. `withPolicy(POLICIES.ai, provider.key, signal => provider.generateStructured({..., signal}))`.
5. `opts.schema.safeParse(result.data)`. On failure: one repair attempt with the Zod issues appended to the user message (`AiRun.status: SCHEMA_RETRY`). On second failure: `AiRun.status: FAILED`, throw `AiOutputInvalidError` (502).
6. Persist `AiRun` (input, parsed output, rawText, tokens, latency, model, promptVersion). API keys never logged or persisted.

Provider implementations

| Key | available | Structured output mechanism | Default models |
|---|---|---|---|
| `mock` | true (mock) | canned outputs keyed by `promptKey` + fixture domain | `mock-fast`, `mock-strong` |
| `anthropic` | true | tool-use with `input_schema` = JSON Schema (`@anthropic-ai/sdk`) | fast `claude-haiku-4-5-20251001`, strong `claude-sonnet-5` |
| `openai` | **false** (stub) | `response_format: json_schema` | – |
| `gemini` | true | `responseJsonSchema` (native JSON Schema, `@google/genai`) | fast `gemini-2.0-flash`, strong `gemini-2.5-pro` |

Prompt templates ship with the repo and are versioned by filename; changing a prompt means adding `v2` and bumping the reference so `AiRun.promptVersion` stays meaningful.

## OutboundProvider

```ts
export interface OutboundMessage {
  messageId: string; to: string; fromName: string; fromEmail: string; replyTo?: string;
  subject: string; bodyText: string; bodyHtml?: string;
}

export interface OutboundProvider extends ProviderMeta {
  send(ctx: ProviderCtx, msg: OutboundMessage)
    : Promise<{ status: "SENT" | "SENT_SIMULATED" | "FAILED"; providerMessageId?: string; error?: string }>;
}
```

Implementations: `simulated` (`available: true`, mock) marks the message `SENT_SIMULATED`, stores a fake `providerMessageId`, and writes the rendered email to `<DATA_DIR>/outbox/<messageId>.eml`. `smtp` (`available: false`, documented stub; `requiredCredentials: ["SMTP_HOST","SMTP_USER","SMTP_PASS","SMTP_FROM_EMAIL"]`) becomes selectable only once a nodemailer adapter is implemented (optional Phase 8).

Send authorization is enforced by `CampaignsService`, not the provider: sendable ⇔ `reviewStatus = APPROVED` ∧ `qaStatus ∈ {PASS, WARN}` ∧ `sendStatus = NOT_SENT`. Approval itself requires `qaStatus ∈ {PASS, WARN}`; editing resets `qaStatus` to `PENDING` and `reviewStatus` to `EDITED`, so an edited message must be QA'd and approved again.

## ProviderRegistry

```ts
@Injectable()
export class ProviderRegistry {
  registerConnector(c: DataSourceConnector): void;   // each provider module registers in onModuleInit
  registerEnricher(e: EnrichmentProvider): void;
  registerAi(p: AiProvider): void;
  registerOutbound(o: OutboundProvider): void;

  // Single owner of availability: unknown key → 404 PROVIDER_NOT_FOUND; available=false → 409 PROVIDER_UNAVAILABLE
  connector(key: string): DataSourceConnector;
  enricher(key: string): EnrichmentProvider;
  ai(key: string): AiProvider;
  outbound(key: string): OutboundProvider;

  // Builds ProviderCtx with credentials from env. Throws ProviderNotConfiguredError (424)
  // if any requiredCredentials is missing. Mocks have none, so they always resolve.
  ctxFor(workspaceId: string, provider: ProviderMeta, projectId?: string): ProviderCtx;

  isConfigured(provider: ProviderMeta): boolean;      // all requiredCredentials present in env

  // Settings / Data Source pages
  catalogue(): {
    kind: "connector" | "enrichment" | "ai" | "outbound";
    key: string; displayName: string; isMock: boolean; available: boolean; configured: boolean;
  }[];
}
```

Adding a connector later = one class implementing `DataSourceConnector` with `available: true`, one Nest module registering it, one fixture for tests. No changes to normalization, qualification or UI beyond the catalogue entry appearing automatically.

## Workflow step seam

```ts
export interface StepCtx extends ProviderCtx {
  runId: string;
  registry: ProviderRegistry;
  ai: AiService;
  ingestion: IngestionService;            // same service used by manual data-source sync
  prisma: PrismaService;
  emit(event: { type: string; payload?: unknown }): void;   // progress for UI polling
}

export interface WorkflowStep<I = unknown, O = unknown> {
  readonly key: WorkflowStepKey;          // INGEST | NORMALIZE | QUALIFY | ENRICH | REQUALIFY | GENERATE_EMAIL | QA | AWAIT_REVIEW
  run(input: I, ctx: StepCtx): Promise<O>;
}

export interface JobDispatcher {
  dispatch(job: { name: "workflow.executeStep"; payload: { runId: string; stepKey: WorkflowStepKey } }): Promise<void>;
}
```

POC: `InProcessJobDispatcher` invokes `WorkflowRunner.executeStep` on the next tick. Upgrade path: `PgBossJobDispatcher` (retries, restart survival, same Postgres), then Inngest/Trigger.dev by mapping `executeStep` onto their step primitive. Steps, store and idempotency logic stay unchanged.
