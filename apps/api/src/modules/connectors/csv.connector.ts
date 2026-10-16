import { Injectable } from "@nestjs/common";
import Papa from "papaparse";
import type { CanonicalFieldPath, CanonicalPerson, MappedRecord, NewAttribute, ProviderCtx, RawRecord } from "@prospect/shared";
import { normalizeDomain } from "@prospect/shared";
import type { ConnectorCapabilities, DataSourceConnector, FetchQuery, FieldMapping } from "./connector.interface";
import { parseCurrencyLoose, parseIntLoose, pushScalar, splitList } from "./mapping-helpers";

export interface CsvConfig {
  fileName: string;
  delimiter: string;
  columns: string[];
  mapping: FieldMapping;

  rows: Record<string, string>[];
}

export const HEURISTIC_ALIASES: Record<string, CanonicalFieldPath[]> = {
  "company name": ["identity.name"],
  "company": ["identity.name"],
  "name": ["identity.name"],
  "website": ["identity.domain"],
  "domain": ["identity.domain"],
  "url": ["identity.domain"],
  "industry": ["firmographics.industry"],
  "sector": ["firmographics.industry"],
  "hq country": ["firmographics.country"],
  "country": ["firmographics.country"],
  "city": ["firmographics.hqCity"],
  "hq city": ["firmographics.hqCity"],
  "state": ["firmographics.hqState"],
  "headcount": ["firmographics.employeeCount"],
  "employees": ["firmographics.employeeCount"],
  "employee count": ["firmographics.employeeCount"],
  "annual revenue (usd)": ["firmographics.revenueUsd"],
  "revenue": ["firmographics.revenueUsd"],
  "annual revenue": ["firmographics.revenueUsd"],
  "founded": ["firmographics.foundedYear"],
  "founded year": ["firmographics.foundedYear"],
  "tech stack": ["technographics.stack"],
  "technologies": ["technographics.stack"],
  "description": ["firmographics.description"],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

@Injectable()
export class CsvConnector implements DataSourceConnector {
  readonly key = "csv";
  readonly displayName = "CSV Upload";
  readonly type = "CSV" as const;
  readonly isMock = false;
  readonly available = true;
  readonly requiredCredentials: string[] = [];

  capabilities(): ConnectorCapabilities {
    return {
      supportsSearch: false,
      supportsPaging: false,
      requiresMapping: true,
      suppliesFields: [
        "identity.name",
        "identity.domain",
        "firmographics.industry",
        "firmographics.country",
        "firmographics.hqCity",
        "firmographics.hqState",
        "firmographics.employeeCount",
        "firmographics.revenueUsd",
        "firmographics.foundedYear",
        "firmographics.description",
        "technographics.stack",
      ],
      suppliesPeople: false,
    };
  }

  async testConnection(_ctx: ProviderCtx, config: unknown): Promise<{ ok: boolean; message?: string }> {
    const cfg = config as Partial<CsvConfig>;
    if (!cfg?.columns?.length) return { ok: false, message: "No parsed CSV columns found — upload a file first." };
    return { ok: true, message: `${cfg.rows?.length ?? 0} rows ready to sync.` };
  }

  async fetchRecords(_ctx: ProviderCtx, config: unknown, query: FetchQuery): Promise<{ records: RawRecord[]; nextCursor?: string }> {
    const cfg = config as CsvConfig;
    const rows = cfg.rows ?? [];
    const start = query.cursor ? Number(query.cursor) : 0;
    const end = Math.min(start + query.limit, rows.length);
    const records: RawRecord[] = rows.slice(start, end).map((row, i) => ({ externalId: `row-${start + i}`, payload: row }));
    return { records, nextCursor: end < rows.length ? String(end) : undefined };
  }

  mapToCanonical(raw: RawRecord, mapping?: FieldMapping): MappedRecord {
    const attributes: NewAttribute[] = [];
    const people: CanonicalPerson[] = [];
    let name = "";
    let domain: string | undefined;
    const stackItems: { key: string; raw: string }[] = [];

    for (const [header, field] of Object.entries(mapping ?? {})) {
      if (!field) continue;
      const rawValue = raw.payload[header];
      if (rawValue === undefined || rawValue === null) continue;
      const value = String(rawValue).trim();
      if (!value) continue;

      switch (field) {
        case "identity.name":
          name = value;
          pushScalar(attributes, field, value);
          break;
        case "identity.domain": {
          const d = normalizeDomain(value);
          domain = d;
          pushScalar(attributes, field, d);
          break;
        }
        case "firmographics.employeeCount": {
          const n = parseIntLoose(value);
          if (n !== undefined) pushScalar(attributes, field, n);
          break;
        }
        case "firmographics.revenueUsd": {
          const n = parseCurrencyLoose(value);
          if (n !== undefined) pushScalar(attributes, field, n);
          break;
        }
        case "firmographics.foundedYear": {
          const n = parseIntLoose(value);
          if (n !== undefined) pushScalar(attributes, field, n);
          break;
        }
        case "technographics.stack":
          for (const item of splitList(value)) stackItems.push({ key: item, raw: item });
          break;
        default:
          pushScalar(attributes, field, value);
      }
    }

    if (stackItems.length > 0) {

      attributes.push({ field: "technographics.stack", value: { items: stackItems, authoritative: false }, confidence: 90 });
    }

    return {
      canonical: { identity: { name, domain } },
      attributes,
      people,
    };
  }

  async suggestMapping(headers: string[], _sampleRows: Record<string, string>[]): Promise<{ mapping: FieldMapping; confidence: Record<string, number> }> {
    const mapping: FieldMapping = {};
    const confidence: Record<string, number> = {};
    for (const header of headers) {
      const key = norm(header);
      const candidates = HEURISTIC_ALIASES[key];
      if (candidates?.length) {
        mapping[header] = candidates[0]!;
        confidence[header] = key === norm(header) && HEURISTIC_ALIASES[key] ? 90 : 70;
      } else {
        mapping[header] = null;
        confidence[header] = 0;
      }
    }
    return { mapping, confidence };
  }

  static parse(csvText: string): { columns: string[]; rows: Record<string, string>[] } {
    const result = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
    const columns = result.meta.fields ?? [];
    return { columns, rows: result.data };
  }
}
