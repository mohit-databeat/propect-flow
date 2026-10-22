---
name: implement-feature
description: Implement a clear, bounded DataBeat Workflow Builder feature end-to-end — inspect, plan, build schema/API/service/UI, test, review, and report. Use when the user asks to build or extend a workflow-builder capability.
---
# Implement a feature end-to-end

Arguments: the feature description (`$ARGUMENTS`). Follow `CLAUDE.md`, `.claude/CLAUDE.md` and the path rules in `.claude/rules/`.

1. **Inspect first.** `git status` (note user changes to preserve), read the relevant existing modules, shared schemas, Prisma models, nearby specs, and `ARCHITECTURE.md` sections that apply. Identify services to reuse.
2. **Plan briefly** for multi-file work: layers touched (schema → shared types → service → controller → web), reuse points, risks, assumptions. For architectural or schema-heavy changes, run the `architecture-reviewer` (and `database-reviewer` for schema) subagent on the plan. Ask the user only for material product decisions or approval-gated actions (destructive DB ops, new major dependencies, credentials, real sends).
3. **Implement vertically**, in this order: shared Zod types/validators → Prisma schema + new migration (never edit applied ones) → service logic → controller/DTO validation → web UI with loading/empty/error/success states. Delegate to `backend-engineer` / `frontend-engineer` for large independent parts, giving them the plan and files to preserve.
4. **Test.** Add unit/service/regression tests per `.claude/rules/testing.md`, including failure paths and tenancy.
5. **Verify** via the `pre-commit-verify` skill (typecheck, tests, lint, build, as relevant). Fix failures caused by your change.
6. **Review.** Run `qa-security-reviewer` on the diff; address valid findings.
7. **Report** per `.claude/CLAUDE.md` §9: implemented scope, key files, DB/API changes, checks actually run with results, assumptions, manual steps. Do not call it done if a critical part is missing. Do not commit or push unless asked.
