import { Injectable } from "@nestjs/common";
import type { ProviderCtx } from "@prospect/shared";
import type { OutboundMessage, OutboundProvider, OutboundSendResult } from "../outbound-provider.interface";

@Injectable()
export class SmtpStubProvider implements OutboundProvider {
  readonly key = "smtp";
  readonly displayName = "SMTP (not yet implemented)";
  readonly isMock = false;
  readonly available = false;
  readonly requiredCredentials = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"];

  send(_ctx: ProviderCtx, _message: OutboundMessage): Promise<OutboundSendResult> {
    return Promise.reject(new Error("smtp provider is a documented stub and is not implemented"));
  }
}
