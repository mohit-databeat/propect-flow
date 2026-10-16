import { z } from "zod";
import { CanonicalFieldPath, Pct } from "./icp.schema";

export const AssessmentCompanyInput = z.object({
  companyId: z.string(),

  evidence: z.record(z.string(), z.unknown()),

  suppliedAttributeIds: z.array(z.string()),
});
export type AssessmentCompanyInput = z.infer<typeof AssessmentCompanyInput>;

export const AssessmentBatchRequest = z.object({
  criterionId: z.string(),
  question: z.string(),
  passRubric: z.string(),
  failRubric: z.string().optional(),
  recencyDays: z.number().optional(),
  evidenceFields: z.array(CanonicalFieldPath),
  companies: z.array(AssessmentCompanyInput).min(1),
});
export type AssessmentBatchRequest = z.infer<typeof AssessmentBatchRequest>;

export const AssessmentOutputItem = z.object({
  companyId: z.string(),
  verdict: z.enum(["PASS", "FAIL", "UNKNOWN"]),
  confidence: Pct,
  reason: z.string(),

  evidenceRefs: z.array(z.string()).default([]),
});
export type AssessmentOutputItem = z.infer<typeof AssessmentOutputItem>;

export const AssessmentOutput = z.object({
  results: z.array(AssessmentOutputItem).min(1),
});
export type AssessmentOutput = z.infer<typeof AssessmentOutput>;
