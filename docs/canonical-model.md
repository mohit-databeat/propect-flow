# Canonical Company Model

All data sources (CSV, mock Apollo, future connectors) and all enrichment providers are mapped into one canonical company shape. The qualification engine, the email generator and the UI only ever read this shape. Raw source payloads are kept untouched in `SourceRecord.rawPayload`.

The Zod schema lives in `packages/shared/src/schemas/canonical-company.schema.ts`. `Company.canonical` stores a snapshot of this document; `Company` columns mirror the scalar fields for filtering and sorting.

## Sources of truth

| Concern | Authoritative store | Notes |
|---|---|---|
| Company firmographics, technographics, signals | `CompanyAttribute` ledger, resolved into `Company` + `Company.canonical` | Canonical snapshot is what qualification reads |
| People and contact details | **`Person` table** | Recipient selection for emails reads `Person`, never the canonical snapshot |
| Field provenance | `CompanyAttribute` rows, summarized in `canonical.provenance` **by the Resolver only** | Connectors and enrichers cannot supply provenance; evidence links to `CompanyAttribute.id` |
| Data-quality flags | `Company.possibleDuplicate` (Tier 1 column) | Set by `CompanyMatcher`, shown as a UI warning; not a company fact |

`CanonicalCompany` is company-level only. Connectors return people separately in `MappedRecord.people` and the ingestion service upserts them into `Person`. The prospect detail page shows people from the `Person` table.

## Person deduplication

`Person` has a deterministic `dedupeKey` with a unique constraint on `(companyId, dedupeKey)` so upserts are a single Prisma `upsert`:

```ts
export const personDedupeKey = (p: { email?: string; fullName: string; title?: string }) =>
  p.email?.trim()
    ? `email:${p.email.trim().toLowerCase()}`
    : `name:${normalizeName(p.fullName)}|${normalizeName(p.title ?? "")}`;
// normalizeName: lowercase, collapse whitespace, strip punctuation and diacritics
```

If a later observation adds an email to a person previously stored under a `name:` key, the ingestion service looks up by the `name:` key first and updates the row's `email` and `dedupeKey` in place (guarded against collision with an existing `email:` row, in which case the two are merged by keeping the `email:` row and deleting the `name:` row).

## Company matching (`CompanyMatcher`)

```
identity.domain present
  → find Company by (projectId, domain)                       → reuse, else create
identity.domain absent
  → candidates = companies in project with normalizeName(name) === normalizeName(identity.name)
      exactly 1 candidate                                     → reuse
      0 candidates                                            → create
      2+ candidates (ambiguous)                               → create new Company with possibleDuplicate = true
```

`possibleDuplicate` is a `Company` boolean column (Tier 1). The prospect list and detail pages show a "possible duplicate" badge; a manual override endpoint can later merge or clear it.

## Authoritative absence

A list that is empty does not mean "none exist"; the source may simply not have looked. Every list-valued group carries an `authoritative` flag, set to `true` only when the provider states the check was complete (for example, an enrichment provider that returns a full technographic profile, or a job-board scan that returns zero postings for the domain). Qualification treats:

- empty + `authoritative: false` -> UNKNOWN
- empty + `authoritative: true` -> absence (FAIL for EXISTS / CONTAINS_*, and usable as negative evidence by the LLM)

CSV data is never authoritative for absence. The mock Apollo connector marks `technographics.stack` and `signals.hiring` authoritative for most demo companies so that both FAIL and UNKNOWN paths are visible.

## Zod schema

```ts
import { z } from "zod";

export const CANONICAL_SCHEMA_VERSION = 1;

const Pct = z.number().int().min(0).max(100);

export const EmployeeRange = z.enum([
  "1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+",
]);
export const RevenueRange = z.enum([
  "<1M", "1M-10M", "10M-50M", "50M-100M", "100M-500M", "500M-1B", ">1B",
]);
export const FundingStage = z.enum([
  "bootstrapped", "pre_seed", "seed", "series_a", "series_b", "series_c", "series_d_plus",
  "private_equity", "public", "acquired", "unknown",
]);

export const Identity = z.object({
  name: z.string().min(1),
  domain: z.string().optional(),        // lowercased, no protocol, no "www."
  website: z.string().url().optional(),
  linkedinUrl: z.string().url().optional(),
});

export const Firmographics = z.object({
  industry: z.string().optional(),       // normalized key from dictionaries/industry.json, e.g. "software_saas"
  industryRaw: z.string().optional(),    // as provided by the source
  subIndustry: z.string().optional(),
  description: z.string().optional(),
  country: z.string().length(2).optional(),   // ISO-3166-1 alpha-2
  hqCity: z.string().optional(),
  hqState: z.string().optional(),
  employeeCount: z.number().int().nonnegative().optional(),
  employeeRange: EmployeeRange.optional(),    // derived from employeeCount when absent
  revenueUsd: z.number().nonnegative().optional(),
  revenueRange: RevenueRange.optional(),
  foundedYear: z.number().int().min(1800).max(2100).optional(),
  fundingStage: FundingStage.optional(),
  totalFundingUsd: z.number().nonnegative().optional(),
  lastFundingDate: z.string().datetime().optional(),
});

// Generic list group with authoritative-absence flag
const listGroup = <T extends z.ZodTypeAny>(item: T) => z.object({
  items: z.array(item).default([]),
  authoritative: z.boolean().default(false),  // provider vouches the list is complete
  checkedAt: z.string().datetime().optional(),
});

export const TechItem = z.object({
  key: z.string(),                       // normalized, e.g. "salesforce"
  raw: z.string(),                       // as provided, e.g. "Salesforce Sales Cloud"
  category: z.string().optional(),       // "crm" | "marketing_automation" | ...
});
export const Technographics = z.object({
  stack: listGroup(TechItem).default({}),
});

export const HiringSignal = z.object({
  title: z.string(),
  department: z.string().optional(),     // normalized: "sales" | "marketing" | ...
  location: z.string().optional(),
  postedAt: z.string().datetime().optional(),
  url: z.string().url().optional(),
});
export const FundingSignal = z.object({
  round: z.string(),
  amountUsd: z.number().optional(),
  date: z.string().datetime().optional(),
  url: z.string().url().optional(),
});
export const NewsSignal = z.object({
  headline: z.string(),
  summary: z.string().optional(),
  date: z.string().datetime().optional(),
  url: z.string().url().optional(),
});
export const ExpansionSignal = z.object({
  type: z.enum(["new_office", "new_market", "new_product", "leadership_hire", "other"]),
  detail: z.string(),
  date: z.string().datetime().optional(),
  url: z.string().url().optional(),
});
export const Signals = z.object({
  hiring:    listGroup(HiringSignal).default({}),
  funding:   listGroup(FundingSignal).default({}),
  news:      listGroup(NewsSignal).default({}),
  expansion: listGroup(ExpansionSignal).default({}),
});

// Field-level provenance. Keys are CanonicalFieldPath strings (see icp-schema.md). Written ONLY by the Resolver.
export const Provenance = z.object({
  attributeId: z.string().uuid(),        // CompanyAttribute.id of the winning observation (or first merged one)
  sourceType: z.enum(["SOURCE", "ENRICHMENT", "MANUAL", "NORMALIZER", "AI"]),
  providerKey: z.string(),
  confidence: Pct,
  observedAt: z.string().datetime(),
  authoritative: z.boolean().default(false),
  mergedFrom: z.array(z.string().uuid()).optional(),   // set when a list group was unioned from several non-authoritative observations
});

export const CanonicalCompany = z.object({
  schemaVersion: z.literal(CANONICAL_SCHEMA_VERSION),
  identity: Identity,
  firmographics: Firmographics.default({}),
  technographics: Technographics.default({}),
  signals: Signals.default({}),
  provenance: z.record(z.string(), Provenance).default({}),
});
export type CanonicalCompany = z.infer<typeof CanonicalCompany>;

// People are NOT part of CanonicalCompany. Connectors return them separately
// and the ingestion service upserts them into the Person table (authoritative store).
export const CanonicalPerson = z.object({
  fullName: z.string(),
  title: z.string().optional(),
  seniority: z.enum(["c_level", "vp", "director", "manager", "ic", "unknown"]).optional(),
  department: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  linkedinUrl: z.string().url().optional(),
});
export type CanonicalPerson = z.infer<typeof CanonicalPerson>;

// Connector / enricher mapping output. Provenance is EXCLUDED: only the Resolver constructs it
// from CompanyAttribute rows. `identity.name` is always required to create a Company.
export const CanonicalPartial = CanonicalCompany
  .omit({ provenance: true })
  .deepPartial()
  .extend({ identity: Identity });
export type CanonicalPartial = z.infer<typeof CanonicalPartial>;
```

Value shape stored in `CompanyAttribute.value` for list fields is the whole group (`{ items, authoritative, checkedAt }`), so authoritativeness travels with the observation and is preserved in history.

## Field reference

| Path | Type | Used by demo ICP | Typical source |
|---|---|---|---|
| `identity.name` | string | – | all |
| `identity.domain` | string | dedupe key | all |
| `firmographics.industry` | normalized key | `industry_saas` | CSV, Apollo, enrichment |
| `firmographics.country` | ISO alpha-2 | `country_us` | CSV, Apollo |
| `firmographics.employeeCount` / `employeeRange` | int / bucket | `employees_100_500` | Apollo, enrichment; range derived |
| `firmographics.revenueUsd` / `revenueRange` | number / bucket | `revenue_gt_10m` | enrichment (often missing in CSV) |
| `technographics.stack` | list group of normalized keys | `uses_salesforce` | Apollo technographics (authoritative), enrichment |
| `signals.hiring` | list group of job postings | `hiring_salespeople` (LLM evidence) | Apollo job postings, enrichment |
| `signals.news`, `signals.funding`, `signals.expansion` | list groups | LLM evidence, email personalization | enrichment |
| `provenance` | map | evidence, detail page | resolver only |
| people | – (Person table) | email recipient via `targetPersonas` | Apollo people search |

## Normalization pipeline (one implementation: `IngestionService`)

Both the manual `POST /data-sources/:id/sync` and the workflow `INGEST` / `NORMALIZE` steps call the same `IngestionService` in the `normalization` module. There is exactly one pipeline.

```
SourceRecord.rawPayload
   │  connector.mapToCanonical(raw, mapping)      // per-provider mapper; CSV uses the user-confirmed mapping
   ▼
MappedRecord { canonical: CanonicalPartial (no provenance), attributes: NewAttribute[], people: CanonicalPerson[] }
   │  Normalizers (deterministic, dictionary-driven, no LLM)
   │    industry:   dictionaries/industry.json    exact alias -> key   ("SaaS", "Software", "Computer Software" -> "software_saas")
   │    technology: dictionaries/technology.json  exact alias -> key   ("Salesforce", "Salesforce CRM", "SFDC", "Salesforce Sales Cloud" -> "salesforce";
   │                                                                     "Salesforce Marketing Cloud" -> "salesforce_marketing_cloud"  – distinct on purpose)
   │    country:    dictionaries/country.json     exact alias -> ISO   ("USA", "U.S.", "United States of America" -> "US")
   │    domain:     strip protocol / "www.", lowercase
   │    employeeRange <- employeeCount, revenueRange <- revenueUsd      (sourceType NORMALIZER)
   ▼
CompanyMatcher.findOrCreate(projectId, identity)      // domain → name → possibleDuplicate (see above)
AttributeWriter.append(companyId, observations[])     // one CompanyAttribute row per field per observation (append-only)
PersonWriter.upsert(companyId, people[])              // Person by (companyId, dedupeKey)
   ▼
Resolver.resolve(companyId)                           // see rules below; the ONLY writer of canonical.provenance
   ▼
Company columns + Company.canonical + Company.resolvedHash;  SourceRecord.normalizedCompanyId set
```

`IngestionService` API

- `syncDataSource(dataSourceId)`: fetch via connector (paged), insert `SourceRecord`s idempotently by `payloadHash`, then `normalizePending(dataSourceId)`.
- `normalizePending(dataSourceId | projectId)`: process `SourceRecord`s with `normalizedCompanyId = null`, then resolve affected companies.
- `resolveCompany(companyId)`: used after enrichment and manual overrides.

Workflow semantics: `INGEST` calls `syncDataSource` for each selected source **only if** `options.refreshSources = true` (default `false`, which reuses already-synced data); `NORMALIZE` always calls `normalizePending(projectId)` so any un-normalized records are processed. Prospect creation is **not** part of ingestion; the `QUALIFY` step creates `Prospect` rows for the run.

## Resolver rules

1. Group the company's attributes by `field`. Within a field, sort observations by precedence index (`workspace.settings.sourcePrecedence`, default `MANUAL > ENRICHMENT > SOURCE > NORMALIZER > AI`), then `confidence desc`, then `observedAt desc`.
2. **Scalar fields**: take the first (top-ranked) observation.
3. **List groups** (one deterministic rule):
   1. `top` = first observation after sorting.
   2. If `top.authoritative === true`: use `top.items` exactly; resolved group `authoritative: true`; provenance points at `top`.
   3. Otherwise: union the items of **all non-authoritative** observations (dedupe by `key` for tech; `url ?? title+postedAt` for hiring; `url ?? headline+date` for news; `round+date` for funding), **ignore lower-ranked authoritative observations**, resolved group `authoritative: false`, `provenance.mergedFrom = [ids of merged observations]`, `provenance.attributeId = top.id`.

   Precedence/confidence/recency select the winner; authoritativeness only controls absence semantics. Two same-precedence observations (e.g. SOURCE conf 90 non-authoritative and SOURCE conf 80 authoritative) therefore resolve to the union of non-authoritative observations, non-authoritative.
4. Write winners into `Company` columns and the full snapshot (including the freshly built `provenance`) into `Company.canonical`; recompute `resolvedHash = sha256(canonical without provenance timestamps)`.

Rules for dictionaries

- Matching is exact on normalized keys after lowercasing and trimming whitespace/punctuation. **Vendor suffixes such as "CRM" or "Cloud" are never stripped generically**; every accepted variant is an explicit alias in `technology.json`, so distinct products (Salesforce Sales Cloud vs Salesforce Marketing Cloud, HubSpot CRM vs HubSpot Marketing Hub) stay distinct.
- Unmapped values keep `industryRaw` / `TechItem.raw`, evaluate as UNKNOWN in qualification, and emit a `dictionary.unmapped` warn log so the dictionary can be extended.
- Dictionaries are versioned JSON files in `apps/api/src/modules/normalization/dictionaries/` with unit tests covering the eight demo companies.

## Demo companies (mock Apollo fixture + mock enrichment, canonical view)

| Company | Industry | Country | Employees | Revenue | Stack has Salesforce | Hiring signal | Expected outcome vs demo ICP |
|---|---|---|---|---|---|---|---|
| Databricks | software_saas | US | 7000 | >$1B | yes (authoritative) | sales roles (authoritative) | DISQUALIFIED (employees) |
| Notion | software_saas | US | 480 | missing → enriched $250M | yes (authoritative) | sales roles (authoritative) | QUALIFIED |
| Figma | software_saas | US | 1300 | $600M | yes (authoritative) | sales roles (authoritative) | DISQUALIFIED (employees) |
| Canva | software_saas | AU | 4500 | $2B | no (authoritative) | sales roles (authoritative) | DISQUALIFIED (country, employees) |
| Stripe | fintech_payments | US | 8000 | >$1B | yes (authoritative) | sales roles (authoritative) | DISQUALIFIED (industry, employees) |
| Linear | software_saas | US | **missing → enrichment `unavailable`** | missing → enrichment `unavailable` | non-authoritative, no Salesforce → UNKNOWN | postings authoritative-empty → FAIL | **NEEDS_REVIEW** (required `employees_100_500` UNKNOWN → `unknownRequiredPolicy`) |
| Webflow | software_saas | US | 450 | missing → enriched $150M | yes (authoritative) | sales roles (authoritative) | QUALIFIED |
| Slack | software_saas | US | 2500 | >$1B | yes (authoritative) | engineering roles only (authoritative) → FAIL | DISQUALIFIED (employees) |

Linear deterministically exercises the NEEDS_REVIEW path because a **required** criterion stays UNKNOWN after enrichment (employee count unavailable from both the source and the mock enricher), independent of score and coverage arithmetic. Figures are illustrative fixture values chosen to exercise every code path; they are not claims about the real companies.
