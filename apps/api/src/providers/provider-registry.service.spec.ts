import { ProviderRegistryService } from "./provider-registry.service";
import type { AiProviderAdapter } from "../modules/ai/ai-provider.interface";
import { AppException } from "../common/errors";

function captureError(fn: () => void): AppException {
  try {
    fn();
  } catch (e) {
    return e as AppException;
  }
  throw new Error("expected fn() to throw");
}

function fakeProvider(overrides: Partial<AiProviderAdapter> = {}): AiProviderAdapter {
  return {
    key: "fake",
    displayName: "Fake",
    isMock: false,
    available: true,
    requiredCredentials: [],
    defaultModel: () => "fake-model",
    generateStructured: async () => ({ data: {}, rawText: "{}", usage: { inputTokens: 0, outputTokens: 0 }, model: "fake-model" }),
    ...overrides,
  };
}

describe("ProviderRegistryService", () => {
  let registry: ProviderRegistryService;

  beforeEach(() => {
    registry = new ProviderRegistryService();
  });

  it("throws 404 PROVIDER_NOT_FOUND for an unknown key", () => {
    const err = captureError(() => registry.getAi("does-not-exist"));
    expect(err.code).toBe("PROVIDER_NOT_FOUND");
    expect(err.getStatus()).toBe(404);
  });

  it("throws 409 PROVIDER_UNAVAILABLE for a documented stub even though it is registered", () => {
    registry.registerAi(fakeProvider({ key: "stub", available: false }));
    const err = captureError(() => registry.getAi("stub"));
    expect(err.code).toBe("PROVIDER_UNAVAILABLE");
    expect(err.getStatus()).toBe(409);
  });

  it("throws 424 PROVIDER_NOT_CONFIGURED when required credentials are missing — never falls back silently", () => {
    delete process.env.SOME_TEST_KEY;
    registry.registerAi(fakeProvider({ key: "needs-key", requiredCredentials: ["SOME_TEST_KEY"] }));
    const provider = registry.getAi("needs-key");
    const err = captureError(() => registry.ctxFor("ws1", provider));
    expect(err.code).toBe("PROVIDER_NOT_CONFIGURED");
    expect(err.getStatus()).toBe(424);
  });

  it("credentials affect `configured`, never `available` — a stub with credentials present stays unavailable", () => {
    process.env.SOME_TEST_KEY = "present";
    registry.registerAi(fakeProvider({ key: "stub-with-key", available: false, requiredCredentials: ["SOME_TEST_KEY"] }));
    expect(() => registry.getAi("stub-with-key")).toThrow(AppException);
    delete process.env.SOME_TEST_KEY;
  });

  it("builds a working ctx for a mock provider with zero required credentials", () => {
    registry.registerAi(fakeProvider({ key: "mock", isMock: true, requiredCredentials: [] }));
    const provider = registry.getAi("mock");
    expect(registry.isConfigured(provider)).toBe(true);
    const ctx = registry.ctxFor("ws1", provider, "proj1");
    expect(ctx.workspaceId).toBe("ws1");
    expect(ctx.projectId).toBe("proj1");
  });

  it("catalogueAi reports available/configured/isMock correctly", () => {
    registry.registerAi(fakeProvider({ key: "mock", isMock: true, requiredCredentials: [] }));
    registry.registerAi(fakeProvider({ key: "stub", available: false, requiredCredentials: ["MISSING_KEY"] }));
    const catalogue = registry.catalogueAi();
    const mockEntry = catalogue.find((c) => c.key === "mock")!;
    const stubEntry = catalogue.find((c) => c.key === "stub")!;
    expect(mockEntry).toMatchObject({ isMock: true, available: true, configured: true });
    expect(stubEntry).toMatchObject({ available: false, configured: false });
  });
});
