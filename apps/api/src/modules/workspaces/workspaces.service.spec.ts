import { WorkspacesService } from "./workspaces.service";
import { AppException } from "../../common/errors";

const ws = { id: "ws1", role: "OWNER" as const };

function makePrisma(settings: Record<string, unknown> = {}) {
  return {
    workspace: {
      findUniqueOrThrow: async () => ({ id: "ws1", name: "Test", slug: "test", settings, createdAt: new Date() }),
      update: async ({ data }: { data: Record<string, unknown> }) => ({ id: "ws1", name: "Test", slug: "test", createdAt: new Date(), ...data }),
    },
  };
}

function makeRegistry(opts: { available?: boolean; configured?: boolean } = {}) {
  const available = opts.available ?? true;
  const configured = opts.configured ?? true;
  const resolve = (key: string) => {
    if (!available) throw new AppException(409 as never, "PROVIDER_UNAVAILABLE", `${key} unavailable`);
    return { key, available: true };
  };
  const ctxFor = () => {
    if (!configured) throw new AppException(424 as never, "PROVIDER_NOT_CONFIGURED", "not configured");
    return {};
  };
  return { getAi: resolve, getEnricher: resolve, getOutbound: resolve, ctxFor };
}

describe("WorkspacesService.update — provider selection validation", () => {
  it("rejects selecting a stub (unavailable) provider with 409", async () => {
    const service = new WorkspacesService(makePrisma() as never, makeRegistry({ available: false }) as never);

    const err = await service.update(ws, { settings: { outboundProviderKey: "smtp" } }).catch((e: AppException) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("rejects selecting an available but unconfigured provider with 424", async () => {
    const service = new WorkspacesService(makePrisma() as never, makeRegistry({ configured: false }) as never);

    const err = await service.update(ws, { settings: { aiProviderKey: "anthropic" } }).catch((e: AppException) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe("PROVIDER_NOT_CONFIGURED");
  });

  it("persists a valid, available and configured provider selection", async () => {
    const service = new WorkspacesService(makePrisma() as never, makeRegistry() as never);

    const result = await service.update(ws, { settings: { outboundProviderKey: "simulated" } });
    expect(result.settings.outboundProviderKey).toBe("simulated");
  });

  it("does not re-validate providers when only the name changes and settings are untouched", async () => {
    const registry = makeRegistry({ available: false });
    const service = new WorkspacesService(makePrisma({ aiProviderKey: "mock", enrichmentProviderKey: "mock_enrichment", outboundProviderKey: "simulated" }) as never, registry as never);

    const result = await service.update(ws, { name: "Renamed" });
    expect(result.name).toBe("Renamed");
  });
});
