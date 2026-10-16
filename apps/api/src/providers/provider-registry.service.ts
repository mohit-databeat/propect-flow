import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ErrorCodes, type ProviderCatalogueEntry, type ProviderCtx, type ProviderLogger, type ProviderMeta } from "@prospect/shared";
import { AppException } from "../common/errors";
import type { AiProviderAdapter } from "../modules/ai/ai-provider.interface";
import type { DataSourceConnector } from "../modules/connectors/connector.interface";
import type { EnrichmentProvider } from "../modules/enrichment/enrichment-provider.interface";
import type { OutboundProvider } from "../modules/outbound/outbound-provider.interface";

@Injectable()
export class ProviderRegistryService {
  private readonly logger = new Logger(ProviderRegistryService.name);

  private readonly ai = new Map<string, AiProviderAdapter>();
  private readonly connectors = new Map<string, DataSourceConnector>();
  private readonly enrichers = new Map<string, EnrichmentProvider>();
  private readonly outbound = new Map<string, OutboundProvider>();

  registerAi(provider: AiProviderAdapter): void {
    this.ai.set(provider.key, provider);
  }

  getAi(key: string): AiProviderAdapter {
    return this.resolve(this.ai, key, "ai");
  }

  registerConnector(provider: DataSourceConnector): void {
    this.connectors.set(provider.key, provider);
  }

  getConnector(key: string): DataSourceConnector {
    return this.resolve(this.connectors, key, "connector");
  }

  registerEnricher(provider: EnrichmentProvider): void {
    this.enrichers.set(provider.key, provider);
  }

  getEnricher(key: string): EnrichmentProvider {
    return this.resolve(this.enrichers, key, "enrichment");
  }

  registerOutbound(provider: OutboundProvider): void {
    this.outbound.set(provider.key, provider);
  }

  getOutbound(key: string): OutboundProvider {
    return this.resolve(this.outbound, key, "outbound");
  }

  private resolve<T extends ProviderMeta>(map: Map<string, T>, key: string, kind: string): T {
    const provider = map.get(key);
    if (!provider) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCodes.PROVIDER_NOT_FOUND, `Unknown ${kind} provider "${key}"`);
    }
    if (!provider.available) {
      throw new AppException(HttpStatus.CONFLICT, ErrorCodes.PROVIDER_UNAVAILABLE, `The "${key}" ${kind} provider is a documented stub and is not available in this POC yet`);
    }
    return provider;
  }

  isConfigured(provider: ProviderMeta): boolean {
    return provider.requiredCredentials.every((name) => Boolean(this.credentialFor(name)));
  }

  private credentialFor(name: string): string | undefined {
    return (process.env as Record<string, string | undefined>)[name];
  }

  ctxFor(workspaceId: string, provider: ProviderMeta, projectId?: string): ProviderCtx {
    if (!this.isConfigured(provider)) {
      throw new AppException(
        HttpStatus.FAILED_DEPENDENCY,
        ErrorCodes.PROVIDER_NOT_CONFIGURED,
        `Provider "${provider.key}" requires ${provider.requiredCredentials.join(", ") || "credentials"} to be set`,
        { providerKey: provider.key, requiredCredentials: provider.requiredCredentials },
      );
    }
    const credentials: Record<string, string | undefined> = {};
    for (const name of provider.requiredCredentials) credentials[name] = this.credentialFor(name);

    const logger: ProviderLogger = {
      debug: (message, meta) => this.logger.debug(`[${provider.key}] ${message}`, meta),
      info: (message, meta) => this.logger.log(`[${provider.key}] ${message}`, meta),
      warn: (message, meta) => this.logger.warn(`[${provider.key}] ${message}`, meta),
      error: (message, meta) => this.logger.error(`[${provider.key}] ${message}`, meta),
    };

    return { workspaceId, projectId, credentials, logger };
  }

  catalogueAi(): ProviderCatalogueEntry[] {
    return [...this.ai.values()].map((p) => ({
      kind: "ai",
      key: p.key,
      displayName: p.displayName,
      isMock: p.isMock,
      available: p.available,
      requiredCredentials: p.requiredCredentials,
      configured: this.isConfigured(p),
    }));
  }

  catalogueConnectors(): { key: string; displayName: string; type: "CSV" | "API"; capabilities: ReturnType<DataSourceConnector["capabilities"]>; isMock: boolean; available: boolean; configured: boolean }[] {
    return [...this.connectors.values()].map((c) => ({
      key: c.key,
      displayName: c.displayName,
      type: c.type,
      capabilities: c.capabilities(),
      isMock: c.isMock,
      available: c.available,
      configured: this.isConfigured(c),
    }));
  }

  catalogueEnrichers(): ProviderCatalogueEntry[] {
    return [...this.enrichers.values()].map((p) => ({
      kind: "enrichment",
      key: p.key,
      displayName: p.displayName,
      isMock: p.isMock,
      available: p.available,
      requiredCredentials: p.requiredCredentials,
      configured: this.isConfigured(p),
    }));
  }

  catalogueOutbound(): ProviderCatalogueEntry[] {
    return [...this.outbound.values()].map((p) => ({
      kind: "outbound",
      key: p.key,
      displayName: p.displayName,
      isMock: p.isMock,
      available: p.available,
      requiredCredentials: p.requiredCredentials,
      configured: this.isConfigured(p),
    }));
  }
}
