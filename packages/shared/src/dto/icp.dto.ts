import { z } from "zod";
import type { Clarification, IcpDefinition, IcpDraftDefinition, ChatMessage } from "../schemas/icp.schema";

export const ChatMessageDto = z.object({ message: z.string().min(1).max(4000) });
export type ChatMessageDto = z.infer<typeof ChatMessageDto>;

export const ResolveClarificationDto = z.object({ answer: z.string().min(1).max(2000) });
export type ResolveClarificationDto = z.infer<typeof ResolveClarificationDto>;

export interface IcpProfileVersionSummary {
  id: string;
  version: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  name: string;
  createdAt: string;
  activatedAt: string | null;
}

export interface IcpBlocker {
  path: string;
  message: string;
}

export interface IcpStateResponse {
  projectId: string;
  active: { id: string; version: number; definition: IcpDefinition; activatedAt: string } | null;
  draft: { id: string; version: number; definition: IcpDraftDefinition; chatTranscript: ChatMessage[] } | null;
  unresolvedClarifications: Clarification[];
  defaultedAssumptions: Clarification[];
  activatable: boolean;
  blockers: IcpBlocker[];
}

export interface IcpChatResponse extends IcpStateResponse {
  assistantMessage: string;
  unsupported: { text: string; reason: string }[];
}
