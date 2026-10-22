---
paths:
  - "apps/api/prisma/**"
  - "docs/schema.prisma.md"
---
# Database (Prisma 6 / PostgreSQL) rules

- Schema: `apps/api/prisma/schema.prisma`. Changes ship as a **new** migration via the Prisma migration flow (`pnpm db:migrate` — it mutates the local DB, so tell the user what it will do first). Never edit or delete an existing migration directory; never hand-edit `migration_lock.toml`.
- Forbidden without explicit user approval: `prisma migrate reset`, `db push --force-reset`, `docker compose down -v`, dropping/truncating tables, deleting `.data/`, seeding over existing data.
- Prefer additive, backward-compatible migrations (new nullable column / new table → backfill → constrain). Call out any data-losing or locking change in the report.
- Use constraints for integrity and idempotency: `@@unique` on natural keys (e.g. run + node + attempt), foreign keys with deliberate `onDelete`, indexes matching real query filters (`workspaceId`/`projectId` first).
- Tenancy: new tables must be reachable to a workspace (directly or via `Project`).
- Do not store secrets or raw provider credentials in JSON columns. Keep `rawPayload`-style data immutable.
- After schema changes run `pnpm db:validate` and `pnpm db:generate`, then typecheck and tests. Keep `docs/schema.prisma.md` and shared DTOs consistent with the schema when the change is user-facing.
- Review migrations by reading the generated SQL before applying.
