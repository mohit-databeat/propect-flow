---
name: debug-issue
description: Systematically debug a failing test, build error, runtime bug or wrong workflow behaviour in this repo — reproduce, find root cause, fix minimally, add a regression test, and verify. Use when something is broken.
---
# Debug an issue

Issue: `$ARGUMENTS`

1. **Reproduce** with the narrowest real command (e.g. `pnpm --filter @prospect/api test -- <pattern>`, `pnpm typecheck`). Capture the actual error. If it cannot be reproduced, say so; do not guess-fix.
2. **Localize.** Read the failing code path and recent changes (`git log -p -n 5 -- <path>`, `git diff`). Check whether `packages/shared` needs a rebuild, whether Prisma client is stale (`pnpm db:generate`), and env/provider config by variable **name** only (never print `.env` values).
3. **State the root cause** in one or two sentences with evidence (file:line, log line, failing assertion) before changing code. Distinguish cause from symptom.
4. **Fix minimally**, in the layer where the bug lives. No unrelated refactors. Preserve uncommitted user work.
5. **Regression test** that fails before and passes after (confirm both when feasible).
6. **Verify**: rerun the original reproduction, then relevant suites (`pnpm typecheck`, `pnpm test`).
7. **Report** root cause, fix, test added, and exact results. If still unresolved, report what was ruled out and the next step — don't claim a fix.
