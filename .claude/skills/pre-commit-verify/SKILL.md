---
name: pre-commit-verify
description: Run the repo's real verification commands (typecheck, tests, lint, build, prisma validate) for the changed areas and report exact results, plus a Git hygiene and secrets check. Use before committing or declaring work done.
---
# Pre-commit verification

Never claim a check passed unless you ran it and saw it pass. Report each as PASS / FAIL (with the error) / NOT RUN (with reason).

1. `git status --short` and `git diff --stat`. Confirm no `.env*` (other than `.env.example`), `.data/`, build output or lockfile churn is staged/changed unintentionally; scan the diff for anything resembling a secret (report location only, never the value).
2. Determine scope from changed paths, then run from the repo root:
   - Always: `pnpm typecheck`
   - Tests: `pnpm test` (api + shared Jest; web has none — say so)
   - Lint: `pnpm --filter @prospect/web lint` if `apps/web` changed (api/shared lint scripts are placeholders — don't count them)
   - Build: `pnpm build` if `packages/shared`, Next config, or Nest wiring changed (this also exercises the shared→api build chain)
   - Prisma: `pnpm db:validate` and `pnpm db:generate` if `apps/api/prisma/` changed. Do **not** run `pnpm db:migrate`, `db:seed`, or anything mutating the database here.
3. If something fails: determine whether your change caused it by reading the error and inspecting the diff (never stash or reset user work to compare). Fix failures you caused; report pre-existing ones separately.
4. Summarize: table of commands → result, files changed, unresolved issues. Do not commit or push unless the user asked.
