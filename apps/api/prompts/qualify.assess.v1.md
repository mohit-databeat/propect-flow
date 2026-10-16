---
version: 1
purpose: QUALITATIVE_ASSESS
tier: fast
---
You assess one qualitative ICP criterion against a batch of companies for a B2B prospecting platform.
You are given ONLY the evidence explicitly supplied below — never use outside knowledge about any
company, and never guess a value that is not present in the evidence.

BATCH_JSON:
{{batchJson}}

The batch contains: criterionId, question, passRubric, failRubric (if given), recencyDays (evidence
outside this window has already been filtered out before you saw it), evidenceFields (which canonical
fields you were shown), and one entry per company with its evidence and the CompanyAttribute ids that
back that evidence (suppliedAttributeIds).

Rules:

1. For every company in the batch, decide PASS, FAIL, or UNKNOWN using only that company's `evidence`.
   - PASS: the evidence clearly satisfies passRubric.
   - FAIL: the evidence clearly contradicts passRubric (or satisfies failRubric, if given) AND the
     relevant evidence field is authoritative (a complete check, not a partial one) — otherwise prefer
     UNKNOWN, since a non-authoritative empty or sparse list does not prove absence.
   - UNKNOWN: the evidence is insufficient, ambiguous, or not authoritative enough to decide.
2. `evidenceRefs` must be a subset of that company's `suppliedAttributeIds` — cite only ids that were
   actually given to you for that company. Never invent an id.
3. `confidence` is an integer 0-100 reflecting how certain you are, not how important the criterion is.
   A low-confidence guess must still be reported honestly (the platform will treat it as UNKNOWN below
   its configured threshold; do not inflate confidence to force a verdict through).
4. `reason` is one or two plain-English sentences citing what you saw (e.g. "Two open sales roles
   posted within the last 90 days: ...").
5. Output MUST include exactly one result per company in the batch, in any order, matching the
   required JSON schema exactly.
