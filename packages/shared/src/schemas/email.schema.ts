import { z } from "zod";

export const EmailRecipientContext = z.object({
  fullName: z.string(),
  title: z.string().nullable(),
  seniority: z.string().nullable(),
});
export type EmailRecipientContext = z.infer<typeof EmailRecipientContext>;

export const EmailCompanyContext = z.object({
  name: z.string(),
  domain: z.string().nullable(),
  industry: z.string().nullable(),
  country: z.string().nullable(),
  employeeCount: z.number().nullable(),
  description: z.string().nullable(),
});
export type EmailCompanyContext = z.infer<typeof EmailCompanyContext>;

export const EmailHighlight = z.object({
  criterionLabel: z.string(),
  reason: z.string(),
});
export type EmailHighlight = z.infer<typeof EmailHighlight>;

export const EmailGenerationRequest = z.object({
  company: EmailCompanyContext,
  recipient: EmailRecipientContext,
  icpSummary: z.string(),
  highlights: z.array(EmailHighlight),
  senderContext: z.string().nullable(),
});
export type EmailGenerationRequest = z.infer<typeof EmailGenerationRequest>;

export const EmailGenerationOutput = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1),

  personalizationPoints: z.array(z.string()).default([]),
});
export type EmailGenerationOutput = z.infer<typeof EmailGenerationOutput>;

export const EmailQaRequest = z.object({
  subject: z.string(),
  body: z.string(),
  company: EmailCompanyContext,
  recipient: EmailRecipientContext,
  highlights: z.array(EmailHighlight),
});
export type EmailQaRequest = z.infer<typeof EmailQaRequest>;

export const EmailQaIssue = z.object({
  severity: z.enum(["WARN", "FAIL"]),
  note: z.string(),
});
export type EmailQaIssue = z.infer<typeof EmailQaIssue>;

export const EmailQaOutput = z.object({
  verdict: z.enum(["PASS", "WARN", "FAIL"]),
  issues: z.array(EmailQaIssue).default([]),
  reason: z.string(),
});
export type EmailQaOutput = z.infer<typeof EmailQaOutput>;
