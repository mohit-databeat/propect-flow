import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import type { ProviderCtx } from "@prospect/shared";
import { env, resolvePaths } from "../../../config/env";
import type { OutboundMessage, OutboundProvider, OutboundSendResult } from "../outbound-provider.interface";

function eml(msg: OutboundMessage): string {
  return `From: ${msg.from}\r\nTo: ${msg.to}\r\nSubject: ${msg.subject}\r\nDate: ${new Date().toUTCString()}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${msg.body}\r\n`;
}

@Injectable()
export class SimulatedOutboundProvider implements OutboundProvider {
  readonly key = "simulated";
  readonly displayName = "Simulated (writes .eml files, no real delivery)";
  readonly isMock = true;
  readonly available = true;
  readonly requiredCredentials: string[] = [];

  async send(_ctx: ProviderCtx, message: OutboundMessage): Promise<OutboundSendResult> {
    const outboxDir = resolvePaths(env).outboxDir;
    await mkdir(outboxDir, { recursive: true });
    const providerMessageId = `sim_${randomUUID()}`;
    const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}_${message.messageId}_${providerMessageId}.eml`;
    await writeFile(join(outboxDir, fileName), eml(message), "utf8");
    return { providerMessageId, status: "SENT_SIMULATED" };
  }
}
