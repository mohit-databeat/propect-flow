import type { ProviderCatalogueEntry } from "../providers/types";
import type { ConnectorCatalogueEntry } from "./data-source.dto";

export interface EffectiveModelEntry {
  purpose: string;
  promptKey: string;

  configuredOverride: string | null;

  providerDefault: string;
  effective: string;
}

export interface SettingsResponse {
  selected: {
    aiProviderKey: string;
    enrichmentProviderKey: string;
    outboundProviderKey: string;
  };
  catalogue: {
    ai: ProviderCatalogueEntry[];
    connectors: ConnectorCatalogueEntry[];
    enrichment: ProviderCatalogueEntry[];
    outbound: ProviderCatalogueEntry[];
  };
  effectiveModels: EffectiveModelEntry[];
}
