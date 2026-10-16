import { Injectable } from "@nestjs/common";
import type { MappedRecord, ProviderCtx, RawRecord } from "@prospect/shared";
import type { ConnectorCapabilities, DataSourceConnector, FetchQuery, FieldMapping } from "./connector.interface";

@Injectable()
export class ApolloStubConnector implements DataSourceConnector {
  readonly key = "apollo";
  readonly displayName = "Apollo (not yet implemented)";
  readonly type = "API" as const;
  readonly isMock = false;
  readonly available = false;
  readonly requiredCredentials = ["APOLLO_API_KEY"];

  capabilities(): ConnectorCapabilities {
    return {
      supportsSearch: true,
      supportsPaging: true,
      requiresMapping: false,
      suppliesFields: [],
      suppliesPeople: true,
    };
  }

  testConnection(): Promise<{ ok: boolean; message?: string }> {
    return Promise.reject(new Error("apollo connector is a documented stub and is not implemented"));
  }

  fetchRecords(_ctx: ProviderCtx, _config: unknown, _query: FetchQuery): Promise<{ records: RawRecord[]; nextCursor?: string }> {
    return Promise.reject(new Error("apollo connector is a documented stub and is not implemented"));
  }

  mapToCanonical(_raw: RawRecord, _mapping?: FieldMapping): MappedRecord {
    throw new Error("apollo connector is a documented stub and is not implemented");
  }
}
