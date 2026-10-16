import { Injectable } from "@nestjs/common";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { env, resolvePaths } from "../../config/env";
import type { AiTier } from "./ai-provider.interface";

export interface LoadedPrompt {
  key: string;
  version: number;
  purpose: string;
  tier: AiTier;
  body: string;
}

function parseFrontmatter(raw: string): { data: Record<string, string>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { data: {}, content: raw };
  const data: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    data[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { data, content: match[2]! };
}

const VERSION_RE = /\.v(\d+)\.md$/;

@Injectable()
export class PromptLoaderService {
  private readonly cache = new Map<string, LoadedPrompt>();

  load(promptKey: string): LoadedPrompt {
    const cached = this.cache.get(promptKey);
    if (cached) return cached;

    const dir = resolvePaths(env).promptsDir;
    const candidates = readdirSync(dir).filter((f) => f.startsWith(`${promptKey}.v`) && f.endsWith(".md"));
    if (candidates.length === 0) {
      throw new Error(`No prompt template found for "${promptKey}" in ${dir}`);
    }
    candidates.sort((a, b) => Number(b.match(VERSION_RE)?.[1] ?? 0) - Number(a.match(VERSION_RE)?.[1] ?? 0));
    const chosen = candidates[0]!;
    const raw = readFileSync(join(dir, chosen), "utf8");
    const { data, content } = parseFrontmatter(raw);

    const prompt: LoadedPrompt = {
      key: promptKey,
      version: Number(data.version ?? 1),
      purpose: data.purpose ?? promptKey,
      tier: (data.tier as AiTier) ?? "strong",
      body: content.trim(),
    };
    this.cache.set(promptKey, prompt);
    return prompt;
  }

  render(template: string, variables: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
      if (!(name in variables)) return "";
      const value = variables[name];
      if (value === undefined) return "";
      return typeof value === "string" ? value : JSON.stringify(value, null, 2);
    });
  }
}
