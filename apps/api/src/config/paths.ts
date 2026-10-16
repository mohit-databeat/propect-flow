import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

let cachedRoot: string | undefined;

export function repoRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      cachedRoot = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  cachedRoot = process.cwd();
  return cachedRoot;
}

export function fromRepoRoot(p: string): string {
  return isAbsolute(p) ? p : resolve(repoRoot(), p);
}

export function apiRoot(): string {
  return resolve(repoRoot(), "apps", "api");
}
