// PreToolUse guard. Reads the hook payload from stdin and, for risky actions,
// answers with a deny/ask decision. Cross-platform (Node only, no jq/bash).
// Fails open on malformed input so it can never wedge a session.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function decide(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

const tool = payload.tool_name;
const input = payload.tool_input ?? {};
const root = path.resolve(payload.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());

if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
  const target = input.file_path ?? input.notebook_path;
  if (typeof target === "string") {
    const abs = path.resolve(root, target);
    const rel = path.relative(root, abs).split(path.sep).join("/");
    const base = path.posix.basename(rel);

    if (/^\.env(\..+)?$/.test(base) && base !== ".env.example") {
      decide("deny", "Editing .env files is blocked. Ask the user to change environment values themselves.");
    }
    if (rel === "pnpm-lock.yaml") {
      decide("deny", "pnpm-lock.yaml is generated; do not hand-edit it. Dependency changes need user approval.");
    }
    const m = rel.match(/^apps\/api\/prisma\/migrations\/([^/]+)\/(.+)$/);
    if (m && existsSync(abs)) {
      decide("deny", "Existing Prisma migrations are immutable. Create a new migration instead.");
    }
    if (rel === "apps/api/prisma/migrations/migration_lock.toml") {
      decide("deny", "migration_lock.toml must not be edited by hand.");
    }
  }
}

if (tool === "Bash" && typeof input.command === "string") {
  const cmd = input.command;
  const risky = [
    [/prisma\s+migrate\s+reset/i, "prisma migrate reset wipes the database"],
    [/db\s+push[^\n]*--(force-reset|accept-data-loss)/i, "prisma db push with data-loss flags"],
    [/docker\s+compose\s+down[^\n]*(-v\b|--volumes)/i, "docker compose down -v deletes the database volume"],
    [/docker\s+volume\s+(rm|prune)/i, "removes Docker volumes"],
    [/\b(drop|truncate)\s+(database|schema|table)\b/i, "destructive SQL"],
    [/git\s+push[^\n]*(--force\b|-f\b|--force-with-lease)/i, "force push"],
    [/git\s+reset\s+--hard/i, "git reset --hard discards uncommitted work"],
    [/git\s+(clean\s+-[a-z]*f|checkout\s+--\s|restore\s+(?!--staged))/i, "may discard uncommitted work"],
    [/--no-verify|--no-gpg-sign/i, "bypasses git hooks/signing"],
    [/\brm\s+-[a-z]*r[a-z]*f?\s+[^\n]*(\.data|prisma|node_modules\/\.pnpm|\.git\b)/i, "recursive delete of data/schema/git"],
    [/(cat|type|Get-Content|more|less|head|tail|grep|rg|echo|printenv)\b[^\n|;&]*\.env(?!\.example)\b/i, "reads .env (secrets)"],
  ];
  for (const [re, why] of risky) {
    if (re.test(cmd)) {
      decide("ask", `Requires explicit user approval: ${why}.`);
    }
  }
}

process.exit(0);
