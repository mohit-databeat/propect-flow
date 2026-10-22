---
paths:
  - "apps/api/src/**"
---
# Backend (NestJS) rules

- Pattern: controller → service → Prisma. Controllers are thin: `@UseGuards(WorkspaceGuard)`, `@CurrentWorkspace()`/`@CurrentUser()`, body validated with `new ZodValidationPipe(Dto)` using DTOs from `@prospect/shared`. Business logic stays in services.
- Mirror an existing module (e.g. `modules/workflow`, `modules/campaigns`) for file layout, module wiring and error handling (`common/errors.ts`, `http-exception.filter.ts`). Use shared error codes from `@prospect/shared`.
- Tenancy: every query includes `workspaceId` (directly or through a project that was verified to belong to the workspace). Never trust ids from the body/params without scoping.
- External capabilities go through `ProviderRegistry` and the provider interfaces (ai, enrichment, outbound, connectors). Do not call vendors directly; do not add silent mock fallbacks.
- AI output is untrusted until Zod-validated. Prompts live in `apps/api/prompts/` (versioned files).
- Cross-module calls go through exported services, not by reaching into another module's Prisma tables when a service exists. Respect the dependency direction in `ARCHITECTURE.md` §3.
- Use transactions for multi-row writes that must be atomic; rely on DB constraints for uniqueness/idempotency instead of check-then-insert.
- Never log or return secrets, provider credentials, or full prospect payloads.
- Types/schemas used by both api and web belong in `packages/shared`; rebuild it when changed.
