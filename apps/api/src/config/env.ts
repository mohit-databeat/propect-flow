import { config as loadDotenv } from "dotenv";
import { join } from "node:path";
import { z } from "zod";
import { fromRepoRoot, repoRoot } from "./paths";

const PLACEHOLDER_PATTERNS = [/change[-_ ]?me/i, /placeholder/i, /^secret/i, /example/i, /password/i, /^default/i, /^xxx+/i, /^(.)\1{7,}$/, /^0123456789/, /^abcdef/i, /your[-_ ]?secret/i];

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const intInRange = (min: number, max: number, def: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().min(min).max(max).default(def));
const boolish = (def: boolean) =>
  z.preprocess((v) => {
    if (typeof v !== "string" || v.trim() === "") return def;
    return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
  }, z.boolean());

const secret = (name: string) =>
  z
    .string({ required_error: `${name} is required` })
    .min(32, `${name} must be at least 32 characters`)
    .refine((v) => !PLACEHOLDER_PATTERNS.some((re) => re.test(v)), `${name} looks like a placeholder; generate a random secret`);

const duration = z.string().regex(/^\d+(ms|s|m|h|d)$/, "expected a duration like 15m, 12h or 7d");

export const AI_PROVIDERS = ["mock", "anthropic", "gemini"] as const;

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    DATABASE_URL: z.string().url().refine((v) => v.startsWith("postgres"), "DATABASE_URL must be a postgres:// or postgresql:// URL"),

    API_PORT: intInRange(1, 65535, 4000),
    API_PREFIX: z.preprocess(emptyToUndefined, z.string().regex(/^[a-zA-Z0-9/_-]+$/).default("api/v1")),
    WEB_URL: z.string().url(),
    LOG_LEVEL: z.preprocess(emptyToUndefined, z.enum(["debug", "info", "warn", "error"]).default("info")),
    SEED_DEMO_DATA: boolish(true),

    JWT_SECRET: secret("JWT_SECRET"),
    JWT_REFRESH_SECRET: secret("JWT_REFRESH_SECRET"),
    JWT_EXPIRES_IN: z.preprocess(emptyToUndefined, duration.default("15m")),
    JWT_REFRESH_EXPIRES_IN: z.preprocess(emptyToUndefined, duration.default("7d")),

    NEXT_PUBLIC_API_URL: optionalString,

    AI_PROVIDER: z.preprocess(emptyToUndefined, z.enum(AI_PROVIDERS).default("mock")),
    ANTHROPIC_API_KEY: optionalString,
    GEMINI_API_KEY: optionalString,
    AI_MODEL_ICP_EXTRACTION: optionalString,
    AI_MODEL_CSV_MAPPING_SUGGEST: optionalString,
    AI_MODEL_QUALITATIVE_ASSESS: optionalString,
    AI_MODEL_EMAIL_GENERATE: optionalString,
    AI_MODEL_EMAIL_QA: optionalString,
    MAX_LLM_PROSPECTS_PER_RUN: intInRange(1, 10_000, 50),
    AI_ASSESS_BATCH_SIZE: intInRange(1, 50, 10),
    AI_MAX_OUTPUT_TOKENS: intInRange(256, 64_000, 2048),

    APOLLO_API_KEY: optionalString,

    ENRICHMENT_PROVIDER: z.preprocess(emptyToUndefined, z.string().min(1).default("mock_enrichment")),
    ENRICHMENT_CONCURRENCY: intInRange(1, 20, 3),

    OUTBOUND_PROVIDER: z.preprocess(emptyToUndefined, z.string().min(1).default("simulated")),
    SMTP_HOST: optionalString,
    SMTP_PORT: intInRange(1, 65535, 587),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    SMTP_FROM_NAME: optionalString,
    SMTP_FROM_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),

    DATA_DIR: z.preprocess(emptyToUndefined, z.string().min(1).default("./.data")),
    MAX_UPLOAD_MB: intInRange(1, 100, 10),
  })
  .refine((e) => e.JWT_SECRET !== e.JWT_REFRESH_SECRET, { path: ["JWT_REFRESH_SECRET"], message: "JWT_REFRESH_SECRET must differ from JWT_SECRET" });

export type Env = z.infer<typeof envSchema>;

export interface ResolvedPaths {
  dataDir: string;
  uploadsDir: string;
  outboxDir: string;
  promptsDir: string;
}

export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}\n\nSee .env.example and run "pnpm setup:env".`);
  }
  return result.data;
}

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;
  if (process.env.NODE_ENV !== "test") {
    loadDotenv({ path: join(repoRoot(), ".env") });
  }
  cached = parseEnv(process.env);
  return cached;
}

export function resolvePaths(env: Env): ResolvedPaths {
  const dataDir = fromRepoRoot(env.DATA_DIR);
  return {
    dataDir,
    uploadsDir: join(dataDir, "uploads"),
    outboxDir: join(dataDir, "outbox"),
    promptsDir: join(repoRoot(), "apps", "api", "prompts"),
  };
}

export const env: Env = new Proxy({} as Env, {
  get(_t, prop: string) {
    return (loadEnv() as unknown as Record<string, unknown>)[prop];
  },
});
