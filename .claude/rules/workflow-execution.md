---
paths:
  - "apps/api/src/modules/workflow/**"
  - "packages/shared/src/workflow-builder/**"
  - "packages/shared/src/dto/workflow.dto.ts"
  - "apps/web/app/(app)/projects/[id]/workflow/**"
---
# Workflow definition & execution rules

Product rules are in `.claude/CLAUDE.md` §5; these are the implementation constraints.

- **Definitions are data, not code.** A workflow definition is a Zod-validated, versioned JSON graph. The single source of truth for node types/config schemas/edge rules is `packages/shared/src/workflow-builder/` (`node-catalog`, `definition.schema`, `graph`, `validate-definition`). Extend it there; the API and UI both consume it. No `eval`, no user-supplied expressions beyond the agreed Condition rule schema.
- **Validate before run:** known node types, per-node config, edges referencing existing nodes/ports, single entry, no unintended cycles, every branch path defined, all nodes reachable, terminal node present, required ordering (e.g. Requalify only after Enrich). Execution must refuse an invalid or unpublished version.
- **Versions are immutable once used by a run.** A run records the exact definition version it executed; editing creates a new version. Starting a run must state which version (explicit selection, no silent "latest").
- **Explicit state models.** Run states: pending, running, awaiting approval, completed, failed, cancelled. Node states: queued, running, succeeded, failed, skipped, waiting. Transitions go through one place in the runner; no ad-hoc status writes from steps. Persist every transition and a log entry (timestamp, node, attempt, outcome, error).
- **Reuse existing step handlers/services** (`steps/*.step.ts` → ingestion, qualification, enrichment, messages, campaigns). Nodes are thin wrappers; do not reimplement business logic. Keep the legacy fixed pipeline working until explicitly retired.
- **Human Approval is a real pause.** Persist a waiting state and release the worker; resume only from the approval API (messages review/approve flow) after authz checks. Approve must respect existing rules (QA PASS/WARN, edits force re-QA). Never auto-approve; never poll-block a worker.
- **Retries & idempotency.** Retry creates a new attempt of the failed node only (existing `inputHash` + unique run/node/attempt pattern), never re-runs succeeded nodes. Side effects (sends, enrichment spend, AI calls) must be guarded by idempotency keys/natural-key upserts so a retry or resume cannot duplicate them. Failure handling per node must be explicit (fail run vs. skip vs. continue) and recorded.
- **Sends are simulated only** (`simulated` outbound provider). Do not wire a real provider into the workflow.
- No parallel branches, loops-with-side-effects, scheduling or generic-automation features unless explicitly approved.
- Tests required: graph validation (valid + each invalid class), state transitions, pause/resume, retry without duplicate side effects, version pinning, tenancy.
