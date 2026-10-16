import type { ProviderCtx, ProviderMeta } from "@prospect/shared";

export interface OutboundMessage {
  messageId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
}

export interface OutboundSendResult {
  providerMessageId: string;
  status: "SENT" | "SENT_SIMULATED";
}

export interface OutboundProvider extends ProviderMeta {
  send(ctx: ProviderCtx, message: OutboundMessage): Promise<OutboundSendResult>;
}
