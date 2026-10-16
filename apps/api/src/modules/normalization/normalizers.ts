import { Injectable, Logger } from "@nestjs/common";
import industryDictionary from "./dictionaries/industry.json";
import technologyDictionary from "./dictionaries/technology.json";
import countryDictionary from "./dictionaries/country.json";

export type DictionaryName = "industry" | "technology" | "country";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

@Injectable()
export class NormalizersService {
  private readonly logger = new Logger(NormalizersService.name);

  private readonly dictionaries: Record<DictionaryName, Record<string, string>> = {
    industry: industryDictionary,
    technology: technologyDictionary,
    country: countryDictionary,
  };

  lookup(dictionary: DictionaryName, raw: string | null | undefined): string | undefined {
    if (!raw || !raw.trim()) return undefined;
    const key = norm(raw);
    const hit = this.dictionaries[dictionary][key];
    if (hit) return hit;
    this.logger.warn(`dictionary.unmapped dictionary=${dictionary} rawValue="${raw}"`);
    return undefined;
  }

  normalizeIndustry(raw: string | null | undefined): string | undefined {
    return this.lookup("industry", raw);
  }

  normalizeCountry(raw: string | null | undefined): string | undefined {
    if (!raw || !raw.trim()) return undefined;

    const key = norm(raw);
    const dictHit = this.dictionaries.country[key];
    if (dictHit) return dictHit;

    if (/^[a-z]{2}$/.test(key)) return key.toUpperCase();
    this.logger.warn(`dictionary.unmapped dictionary=country rawValue="${raw}"`);
    return undefined;
  }

  normalizeTechnology(raw: string | null | undefined): string | undefined {
    return this.lookup("technology", raw);
  }

  private readonly industryKeySet = new Set(Object.values(industryDictionary));
  private readonly technologyKeySet = new Set(Object.values(technologyDictionary));

  isKnownIndustryKey(value: string): boolean {
    return this.industryKeySet.has(value);
  }

  isKnownTechnologyKey(value: string): boolean {
    return this.technologyKeySet.has(value);
  }

  isKnownCountryCode(value: string): boolean {
    return /^[A-Z]{2}$/.test(value);
  }
}
