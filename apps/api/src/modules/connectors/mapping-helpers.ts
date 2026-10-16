import type { CanonicalFieldPath, NewAttribute } from "@prospect/shared";
import { normalizeDomain } from "@prospect/shared";

export function parseIntLoose(value: string): number | undefined {
  const n = Number(value.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

export function parseCurrencyLoose(value: string): number | undefined {
  const cleaned = value.replace(/[$,\s]/g, "");
  const match = cleaned.match(/^(\d+(?:\.\d+)?)([kKmMbB])?$/);
  if (!match) {
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }
  const base = Number(match[1]);
  const mult = { k: 1_000, m: 1_000_000, b: 1_000_000_000 }[match[2]?.toLowerCase() ?? ""] ?? 1;
  return base * mult;
}

export function splitList(value: string): string[] {
  return value
    .split(/[;,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function pushScalar(attributes: NewAttribute[], field: CanonicalFieldPath, value: unknown, confidence = 100, observedAt?: string): void {
  if (value === undefined || value === null || value === "") return;
  attributes.push({ field, value, confidence, observedAt });
}

export { normalizeDomain };
