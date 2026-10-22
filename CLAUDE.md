# DataBeat Prospect POC — repo guide

Product direction, engineering principles, autonomy limits and the final-report format live in `.claude/CLAUDE.md` (read it; it is not repeated here). Path-specific rules are in `.claude/rules/`. Deeper design docs: `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `docs/`.

## Layout (pnpm workspace, `packageManager: pnpm@10.27.0`)
- `apps/api` — NestJS 11 + Prisma 6 (Postgres 16). Feature modules in `src/modules/*`, shared infra in `src/common`, `src/providers`, `src/config`. Prompts in `apps/api/prompts/`.
- `apps/web` — Next.js 15 App Router, React 19, Tailwind 3. Routes in `app/(app)/…`, UI in `components/{ui,layout,icp}`, API client in `lib/api.ts`.
- `packages/shared` — Zod schemas/DTOs/types used by both apps (`@prospect/shared`). Must be built (`pnpm --filter @prospect/shared build`) before api build; api `prebuild` does it.
- `packages/config` — base tsconfig (strict, `noUncheckedIndexedAccess`).

## Commands (verified against package.json; run from repo root)
| Purpose | Command |
|---|---|
| Typecheck all | `pnpm typecheck` |
| Tests all | `pnpm test` (api + shared Jest; web has no tests) |
| One api spec | `pnpm --filter @prospect/api test -- <path-or-pattern>` |
| Lint | `pnpm lint` — only `web` has a real linter (`next lint`); api/shared are `echo` placeholders, so lint passing says nothing about them |
| Build | `pnpm build` |
| DB | `pnpm db:up` · `db:generate` · `db:validate` · `db:migrate` (= `prisma migrate dev`, mutates local DB) · `db:seed` |
| Dev | `pnpm dev` (api + web) |

There is no formatter configured (no Prettier/EditorConfig). Match surrounding style; do not reformat unrelated code.

## Local setup facts
- DB: Docker Postgres on host port **5433**; `DATABASE_URL` comes from the gitignored root `.env` (template: `.env.example`). Never read, print or edit `.env`.
- AI/enrichment/outbound default to `mock`/`simulated` providers. Real sends are never part of development work.
- Auth: JWT + `WorkspaceGuard` (`X-Workspace-Id` membership). Every query must be scoped by `workspaceId`.

## Working agreements
- Git: work on the current feature branch; never commit or push unless asked; never discard uncommitted changes (the working tree may contain the user's in-progress work, e.g. `packages/shared/src/workflow-builder/`).
- Reuse existing services; new workflow nodes wrap them rather than reimplementing.
- Report only checks you actually ran, with real results. Use the skills `implement-feature`, `debug-issue`, `review-feature`, `pre-commit-verify` and the subagents in `.claude/agents/`.
