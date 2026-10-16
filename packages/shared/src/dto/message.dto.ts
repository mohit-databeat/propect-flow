import { z } from "zod";

export const GenerateMessageDto = z.object({

  personId: z.string().uuid().optional(),
});
export type GenerateMessageDto = z.infer<typeof GenerateMessageDto>;

export const EditMessageDto = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1),
});
export type EditMessageDto = z.infer<typeof EditMessageDto>;

export const RejectMessageDto = z.object({
  note: z.string().max(2000).optional(),
});
export type RejectMessageDto = z.infer<typeof RejectMessageDto>;

export const MessageListQuery = z.object({
  reviewStatus: z.enum(["PENDING", "APPROVED", "REJECTED", "EDITED"]).optional(),
  qaStatus: z.enum(["PENDING", "PASS", "WARN", "FAIL"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type MessageListQuery = z.infer<typeof MessageListQuery>;

export interface MessageQaResultDto {
  verdict: "PASS" | "WARN" | "FAIL";
  issues: { severity: "WARN" | "FAIL"; note: string }[];
  reason: string;
}

export interface MessageDto {
  id: string;
  projectId: string;
  campaignId: string | null;
  prospectId: string | null;
  companyId: string;
  companyName: string;
  personId: string | null;
  recipientName: string | null;
  recipientTitle: string | null;
  toAddress: string | null;
  subject: string;
  body: string;
  generatedSubject: string;
  generatedBody: string;
  personalizationPoints: string[];
  qaStatus: "PENDING" | "PASS" | "WARN" | "FAIL";
  qaResult: MessageQaResultDto | null;
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED" | "EDITED";
  reviewedById: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  sendStatus: "NOT_SENT" | "QUEUED" | "SENT_SIMULATED" | "SENT" | "FAILED";
  sentAt: string | null;
  providerMessageId: string | null;
  sendError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageListResponse {
  items: MessageDto[];
  page: number;
  pageSize: number;
  total: number;
}
