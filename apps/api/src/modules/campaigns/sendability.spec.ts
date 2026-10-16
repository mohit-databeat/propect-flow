import { checkSendable } from "./sendability";

const base = { reviewStatus: "APPROVED", qaStatus: "PASS", sendStatus: "NOT_SENT", toAddress: "a@b.com" };

describe("checkSendable", () => {
  it("is sendable when approved, QA PASS, has a valid email, and not yet sent", () => {
    expect(checkSendable(base)).toEqual({ sendable: true });
  });

  it("is sendable when QA is WARN, not only PASS", () => {
    expect(checkSendable({ ...base, qaStatus: "WARN" })).toEqual({ sendable: true });
  });

  it("rejects an unapproved message", () => {
    const result = checkSendable({ ...base, reviewStatus: "PENDING" });
    expect(result).toMatchObject({ sendable: false, reason: expect.stringContaining("Not approved") });
  });

  it("rejects a QA FAIL message", () => {
    const result = checkSendable({ ...base, qaStatus: "FAIL" });
    expect(result).toMatchObject({ sendable: false, reason: expect.stringContaining("QA") });
  });

  it("rejects a QA PENDING message", () => {
    const result = checkSendable({ ...base, qaStatus: "PENDING" });
    expect(result).toMatchObject({ sendable: false, reason: expect.stringContaining("QA") });
  });

  it("rejects a missing recipient email", () => {
    const result = checkSendable({ ...base, toAddress: null });
    expect(result).toMatchObject({ sendable: false, reason: expect.stringContaining("recipient") });
  });

  it("rejects an invalid recipient email", () => {
    const result = checkSendable({ ...base, toAddress: "not-an-email" });
    expect(result).toMatchObject({ sendable: false, reason: expect.stringContaining("recipient") });
  });

  it("rejects an already-sent message (real or simulated), preventing duplicate sends", () => {
    expect(checkSendable({ ...base, sendStatus: "SENT_SIMULATED" })).toMatchObject({ sendable: false, reason: expect.stringContaining("Already") });
    expect(checkSendable({ ...base, sendStatus: "SENT" })).toMatchObject({ sendable: false, reason: expect.stringContaining("Already") });
  });
});
