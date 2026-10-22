---
name: review-feature
description: Review a workflow-builder feature or the current branch diff for architecture, database, security, test adequacy and honest reporting, using the specialist read-only reviewers. Use before merge or when asked to review.
---
# Review a feature

Target: `$ARGUMENTS` (default: current branch vs `main`, plus uncommitted and untracked files).

1. Collect scope: `git status`, `git diff main...HEAD --stat`, `git diff`, and read untracked files in scope.
2. Run reviewers in parallel as read-only subagents, passing the file list and intent:
   - `architecture-reviewer` — always.
   - `database-reviewer` — if `apps/api/prisma/` changed.
   - `qa-security-reviewer` — always.
3. Spot-check each finding against the code yourself; drop speculative or incorrect ones, and mark what was verified by running vs reasoned.
4. Output one consolidated list ranked by severity: `file:line`, issue, failing scenario, recommended fix. Include a short "looks good" section only for things actually checked. Do not apply fixes unless asked.
