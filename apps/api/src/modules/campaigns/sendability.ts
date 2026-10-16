const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SendabilityInput {
  reviewStatus: string;
  qaStatus: string;
  sendStatus: string;
  toAddress: string | null;
}

export function checkSendable(m: SendabilityInput): { sendable: true } | { sendable: false; reason: string } {
  if (m.sendStatus !== "NOT_SENT") return { sendable: false, reason: `Already ${m.sendStatus === "SENT_SIMULATED" ? "sent (simulated)" : m.sendStatus.toLowerCase()}` };
  if (m.reviewStatus !== "APPROVED") return { sendable: false, reason: `Not approved (review status: ${m.reviewStatus})` };
  if (m.qaStatus !== "PASS" && m.qaStatus !== "WARN") return { sendable: false, reason: `QA has not passed (QA status: ${m.qaStatus})` };
  if (!m.toAddress || !EMAIL_RE.test(m.toAddress)) return { sendable: false, reason: "No valid recipient email address" };
  return { sendable: true };
}
