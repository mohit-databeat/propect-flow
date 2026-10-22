import { createHash } from "node:crypto";
import { canonicalJson } from "@prospect/shared";

export function checksumOf(definition: unknown): string {
  return createHash("sha256").update(canonicalJson(definition)).digest("hex");
}
