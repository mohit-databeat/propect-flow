import { parseEnv } from "./env";

const valid: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://prospect:prospect@localhost:5433/prospect_poc?schema=public",
  WEB_URL: "http://localhost:3000",
  JWT_SECRET: "k9v2mQ7pX4rT1sL8wZ3nB6cF0hJ5dG2aY7eU4iO1pA9s",
  JWT_REFRESH_SECRET: "R3fR3shT0k3nS3cr3t-9f8e7d6c5b4a3928170615f4e3d2c1",
};

describe("env validation", () => {
  it("accepts a valid minimal environment and applies defaults", () => {
    const env = parseEnv(valid);
    expect(env.API_PORT).toBe(4000);
    expect(env.API_PREFIX).toBe("api/v1");
    expect(env.AI_PROVIDER).toBe("mock");
    expect(env.MAX_LLM_PROSPECTS_PER_RUN).toBe(50);
    expect(env.DATA_DIR).toBe("./.data");
    expect(env.SEED_DEMO_DATA).toBe(true);
  });

  it("rejects short JWT secrets", () => {
    expect(() => parseEnv({ ...valid, JWT_SECRET: "too-short" })).toThrow(/at least 32 characters/);
  });

  it("rejects placeholder JWT secrets even when long enough", () => {
    expect(() => parseEnv({ ...valid, JWT_SECRET: "change-me-to-a-long-random-string-please-now" })).toThrow(/placeholder/);
    expect(() => parseEnv({ ...valid, JWT_REFRESH_SECRET: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })).toThrow(/placeholder/);
  });

  it("rejects identical access and refresh secrets", () => {
    expect(() => parseEnv({ ...valid, JWT_REFRESH_SECRET: valid.JWT_SECRET })).toThrow(/must differ/);
  });

  it("validates numeric variables", () => {
    expect(() => parseEnv({ ...valid, API_PORT: "not-a-number" })).toThrow(/API_PORT/);
    expect(() => parseEnv({ ...valid, API_PORT: "70000" })).toThrow(/API_PORT/);
    expect(() => parseEnv({ ...valid, AI_ASSESS_BATCH_SIZE: "0" })).toThrow(/AI_ASSESS_BATCH_SIZE/);
    expect(parseEnv({ ...valid, MAX_UPLOAD_MB: "25" }).MAX_UPLOAD_MB).toBe(25);
  });

  it("treats empty strings as unset so .env.example blanks fall back to defaults", () => {
    const env = parseEnv({ ...valid, AI_MODEL_EMAIL_QA: "", ANTHROPIC_API_KEY: "", API_PREFIX: "" });
    expect(env.AI_MODEL_EMAIL_QA).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.API_PREFIX).toBe("api/v1");
  });

  it("limits AI_PROVIDER to POC providers", () => {
    expect(parseEnv({ ...valid, AI_PROVIDER: "anthropic" }).AI_PROVIDER).toBe("anthropic");
    expect(parseEnv({ ...valid, AI_PROVIDER: "gemini" }).AI_PROVIDER).toBe("gemini");
    expect(() => parseEnv({ ...valid, AI_PROVIDER: "openai" })).toThrow(/AI_PROVIDER/);
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "mysql://x:y@localhost/db" })).toThrow(/DATABASE_URL/);
  });
});
