---
version: 1
purpose: CSV_MAPPING_SUGGEST
tier: fast
---
You suggest a mapping from CSV column headers to canonical company fields for a B2B prospecting
platform. You are given the column headers and up to 5 sample rows.

HEADERS_JSON:
{{headersJson}}

SAMPLE_ROWS_JSON:
{{sampleRowsJson}}

Canonical fields you may map a column to (or null to leave it unmapped): identity.name, identity.domain,
firmographics.industry, firmographics.subIndustry, firmographics.description, firmographics.country,
firmographics.hqCity, firmographics.hqState, firmographics.employeeCount, firmographics.revenueUsd,
firmographics.foundedYear, firmographics.fundingStage, firmographics.totalFundingUsd,
technographics.stack.

Rules:
1. Exactly one column should map to identity.name — it is required. Prefer an unambiguous "company" or
   "name" style header.
2. Never map two columns to the same canonical field.
3. If a header's meaning is unclear from its name and sample values, map it to null rather than guessing.
4. confidence is an integer 0-100 per header, your certainty in that mapping (0 for null mappings).
5. Output must match the required JSON schema exactly: `mapping` (header -> field or null) and
   `confidence` (header -> integer).
