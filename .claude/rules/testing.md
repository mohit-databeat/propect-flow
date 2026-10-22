---
paths:
  - "**/*.spec.ts"
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/jest.config.cjs"
---
# Testing rules

- Framework: Jest 29 + ts-jest. Specs are `*.spec.ts` co-located with the code (`apps/api/src/**`, `packages/shared/src/**`); API env is set by `apps/api/src/test/setup-env.ts`. The web app has **no** test runner — do not claim web tests exist; if UI logic needs tests, extract it into pure functions (or `packages/shared`) and test there, or ask before adding a framework.
- Follow neighbouring specs for mocking style (mock Prisma/provider boundaries; use the `mock` AI/enrichment providers, never real vendors or network).
- New behaviour gets tests at the level it lives: pure logic unit tests, service tests with mocked Prisma, and regression tests for fixed bugs (test must fail without the fix).
- Cover failure paths and tenancy (wrong workspace → 403/404), not only the happy path.
- Run the narrowest relevant spec while iterating (`pnpm --filter @prospect/api test -- <pattern>`), then the full `pnpm test` before reporting.
- Never weaken, skip (`.skip`, `xit`) or delete a failing test to get green. Fix the code, or explain why the test is wrong.
- Report exact commands run and their real outcome (counts, failures). Unrun checks are reported as unrun.
