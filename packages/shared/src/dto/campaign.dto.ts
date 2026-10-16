import { z } from "zod";
import type { MessageDto } from "./message.dto";

export const SenderConfig = z.object({
  fromName: z.string().min(1).max(200).optional(),
  fromEmail: z.string().email().optional(),
});
export type SenderConfig = z.infer<typeof SenderConfig>;

export const CreateCampaignDto = z.object({
  name: z.string().min(1).max(200),
  outboundProviderKey: z.string().min(1).optional(),
  senderConfig: SenderConfig.optional(),
});
export type CreateCampaignDto = z.infer<typeof CreateCampaignDto>;

export const UpdateCampaignDto = z
  .object({
    name: z.string().min(1).max(200).optional(),
    status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"]).optional(),
    outboundProviderKey: z.string().min(1).optional(),
    senderConfig: SenderConfig.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "nothing to update");
export type UpdateCampaignDto = z.infer<typeof UpdateCampaignDto>;

export const AddCampaignMessagesDto = z.object({

  messageIds: z.array(z.string().uuid()).optional(),
});
export type AddCampaignMessagesDto = z.infer<typeof AddCampaignMessagesDto>;

export interface CampaignCounts {
  total: number;
  approved: number;
  sent: number;
  skipped: number;
  failed: number;
}

export interface CampaignSummaryDto {
  id: string;
  projectId: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";
  outboundProviderKey: string;
  senderConfig: SenderConfig;
  counts: CampaignCounts;
  createdAt: string;
  updatedAt: string;
}

export interface SkippedMessageDto {
  messageId: string;
  companyName: string;
  reason: string;
}

export interface CampaignSendReport {
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  skippedMessages: SkippedMessageDto[];
}

export interface CampaignDetailDto extends CampaignSummaryDto {
  messages: MessageDto[];
}

export interface CampaignAddReport {
  added: number;
  alreadyInCampaign: number;
  skipped: number;
  skippedMessages: SkippedMessageDto[];
}

export interface CampaignClearReport {
  removed: number;

  kept: number;
}
