---
paths:
  - "apps/web/**"
---
# Frontend (Next.js 15 / React 19 / Tailwind) rules

- App Router under `apps/web/app/(app)/…`. Client components declare `"use client"`; keep server/client boundaries explicit.
- Call the API only through `lib/api.ts` (handles auth, refresh, `ApiError`). Do not hand-roll `fetch` with tokens. Import request/response types and Zod schemas from `@prospect/shared` instead of redefining them.
- Reuse `components/ui/*` (button, card, badge, select, textarea, toast) and `components/layout/*` (page-header, etc.) and the Tailwind setup. Do not add a UI/component library or state library without a concrete justification; a graph-canvas library for the workflow builder is a major dependency and needs explicit approval first.
- Every data-driven view handles loading, empty, error and success states. Surface `ApiError.code/message`; never swallow errors.
- Accessibility: semantic elements, labelled controls, keyboard operability, visible focus, sufficient contrast; interactive canvases need a keyboard/list alternative.
- Do not duplicate backend business rules (e.g. graph validity) in components; call the validation endpoint or shared validator from `@prospect/shared`.
- Verify with `pnpm --filter @prospect/web typecheck` and `lint`; for UI changes also exercise the page in the running app (see the `run` skill) or state clearly that you could not.
