---
paths:
  - "apps/api/src/{auth,common,config,providers,prisma}/**"
  - "apps/api/src/modules/{auth,workspaces,settings,outbound,campaigns,data-sources}/**"
  - "apps/web/lib/auth.ts"
  - "apps/web/middleware.ts"
  - ".env.example"
---
# Security rules

- Secrets: never read, print, log, commit or echo values from `.env` or any `*_KEY`, `*_SECRET`, `*_PASS`, token. Referring to variable **names** is fine. Do not edit `.env*` (only `.env.example`, and only for new variable names with placeholder values) unless the user explicitly asks. New env vars must be validated in `apps/api/src/config/env.ts`.
- AuthN/Z: keep `JwtAuthGuard` global behaviour and `WorkspaceGuard` on workspace-scoped controllers. Any new endpoint must (1) be authenticated, (2) resolve the workspace from membership, (3) scope every query by `workspaceId`, (4) validate input with Zod at the boundary. Check ownership of nested ids (project, run, node, message) before use.
- Treat all prospect/customer data, CSV content, and AI output as untrusted: validate, bound sizes, never interpolate into SQL/shell/paths, never render as HTML unescaped, and keep prompt-injection in mind (AI output cannot trigger actions without validation).
- Provider credentials come from env only and never appear in API responses, logs, `AiRun.input`, workflow logs or step outputs.
- Outbound: real external sends and credential/permission changes need explicit user approval. Default providers stay `mock`/`simulated`.
- Do not disable guards, CORS restrictions, validation, or rate/size limits to make something work. Do not use `--dangerously-skip-permissions`-style bypasses or widen `.claude/settings.json` permissions just to avoid prompts.
- If a tenancy or authorization gap exists in code you touch, report it rather than silently working around it.
