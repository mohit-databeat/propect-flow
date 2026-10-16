import { z } from "zod";
import { Pct } from "./icp.schema";

export const CANONICAL_SCHEMA_VERSION = 1 as const;

export const EmployeeRange = z.enum(["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+"]);
export type EmployeeRange = z.infer<typeof EmployeeRange>;

export const RevenueRange = z.enum(["<1M", "1M-10M", "10M-50M", "50M-100M", "100M-500M", "500M-1B", ">1B"]);
export type RevenueRange = z.infer<typeof RevenueRange>;

export const FundingStage = z.enum([
  "bootstrapped",
  "pre_seed",
  "seed",
  "series_a",
  "series_b",
  "series_c",
  "series_d_plus",
  "private_equity",
  "public",
  "acquired",
  "unknown",
]);
export type FundingStage = z.infer<typeof FundingStage>;

export const Identity = z.object({
  name: z.string().min(1),
  domain: z.string().optional(),
  website: z.string().url().optional(),
  linkedinUrl: z.string().url().optional(),
});

export const Firmographics = z.object({
  industry: z.string().optional(),
  industryRaw: z.string().optional(),
  subIndustry: z.string().optional(),
  description: z.string().optional(),
  country: z.string().length(2).optional(),
  hqCity: z.string().optional(),
  hqState: z.string().optional(),
  employeeCount: z.number().int().nonnegative().optional(),
  employeeRange: EmployeeRange.optional(),
  revenueUsd: z.number().nonnegative().optional(),
  revenueRange: RevenueRange.optional(),
  foundedYear: z.number().int().min(1800).max(2100).optional(),
  fundingStage: FundingStage.optional(),
  totalFundingUsd: z.number().nonnegative().optional(),
  lastFundingDate: z.string().datetime().optional(),
});

export const listGroup = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item).default([]),
    authoritative: z.boolean().default(false),
    checkedAt: z.string().datetime().optional(),
  });

export const TechItem = z.object({
  key: z.string().min(1),
  raw: z.string().min(1),
  category: z.string().optional(),
});
export type TechItem = z.infer<typeof TechItem>;

export const Technographics = z.object({
  stack: listGroup(TechItem).default({}),
});

export const HiringSignal = z.object({
  title: z.string().min(1),
  department: z.string().optional(),
  location: z.string().optional(),
  postedAt: z.string().datetime().optional(),
  url: z.string().url().optional(),
});
export const FundingSignal = z.object({
  round: z.string().min(1),
  amountUsd: z.number().optional(),
  date: z.string().datetime().optional(),
  url: z.string().url().optional(),
});
export const NewsSignal = z.object({
  headline: z.string().min(1),
  summary: z.string().optional(),
  date: z.string().datetime().optional(),
  url: z.string().url().optional(),
});
export const ExpansionSignal = z.object({
  type: z.enum(["new_office", "new_market", "new_product", "leadership_hire", "other"]),
  detail: z.string().min(1),
  date: z.string().datetime().optional(),
  url: z.string().url().optional(),
});

export const Signals = z.object({
  hiring: listGroup(HiringSignal).default({}),
  funding: listGroup(FundingSignal).default({}),
  news: listGroup(NewsSignal).default({}),
  expansion: listGroup(ExpansionSignal).default({}),
});

export const AttributeSourceType = z.enum(["SOURCE", "ENRICHMENT", "MANUAL", "NORMALIZER", "AI"]);
export type AttributeSourceType = z.infer<typeof AttributeSourceType>;

export const Provenance = z.object({
  attributeId: z.string().uuid(),
  sourceType: AttributeSourceType,
  providerKey: z.string(),
  confidence: Pct,
  observedAt: z.string().datetime(),
  authoritative: z.boolean().default(false),
  mergedFrom: z.array(z.string().uuid()).optional(),
});
export type Provenance = z.infer<typeof Provenance>;

export const CanonicalCompany = z.object({
  schemaVersion: z.literal(CANONICAL_SCHEMA_VERSION),
  identity: Identity,
  firmographics: Firmographics.default({}),
  technographics: Technographics.default({}),
  signals: Signals.default({}),
  provenance: z.record(z.string(), Provenance).default({}),
});
export type CanonicalCompany = z.infer<typeof CanonicalCompany>;

export const CanonicalPerson = z.object({
  fullName: z.string().min(1),
  title: z.string().optional(),
  seniority: z.enum(["c_level", "vp", "director", "manager", "ic", "unknown"]).optional(),
  department: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  linkedinUrl: z.string().url().optional(),
});
export type CanonicalPerson = z.infer<typeof CanonicalPerson>;

export const CanonicalPartial = CanonicalCompany.omit({ provenance: true }).deepPartial().extend({ identity: Identity });
export type CanonicalPartial = z.infer<typeof CanonicalPartial>;

export const employeeRangeFor = (count: number): EmployeeRange => {
  if (count <= 10) return "1-10";
  if (count <= 50) return "11-50";
  if (count <= 200) return "51-200";
  if (count <= 500) return "201-500";
  if (count <= 1000) return "501-1000";
  if (count <= 5000) return "1001-5000";
  if (count <= 10000) return "5001-10000";
  return "10001+";
};

export const revenueRangeFor = (usd: number): RevenueRange => {
  if (usd < 1_000_000) return "<1M";
  if (usd < 10_000_000) return "1M-10M";
  if (usd < 50_000_000) return "10M-50M";
  if (usd < 100_000_000) return "50M-100M";
  if (usd < 500_000_000) return "100M-500M";
  if (usd < 1_000_000_000) return "500M-1B";
  return ">1B";
};

export const normalizeDomain = (input: string): string =>
  input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");

export const normalizeName = (input: string): string =>
  input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const personDedupeKey = (p: { email?: string | null; fullName: string; title?: string | null }): string =>
  p.email?.trim() ? `email:${p.email.trim().toLowerCase()}` : `name:${normalizeName(p.fullName)}|${normalizeName(p.title ?? "")}`;
