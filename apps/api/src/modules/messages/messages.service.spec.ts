import { MessagesService } from "./messages.service";
import { AppException } from "../../common/errors";

const ws = { id: "ws1", role: "OWNER" as const };

function makeProjectsStub() {
  return { findOneOrThrow: async () => ({ id: "proj1", workspaceId: "ws1", description: "We sell widgets" }) };
}

const icpDefinition = {
  schemaVersion: 1,
  name: "Test ICP",
  summary: "Mid-size SaaS companies",
  targetPersonas: [{ title: "VP Sales", seniority: "vp" }],
  criteria: [{ id: "c1", label: "Industry", kind: "DETERMINISTIC", field: "firmographics.industry", operator: "EQ", value: "software_saas", weight: 5, required: true, enrichIfMissing: true }],
  scoring: { qualifiedThreshold: 70, needsReviewThreshold: 40, minCoverage: 60, unknownRequiredPolicy: "NEEDS_REVIEW" },
  clarifications: [],
};

function makeProspect(overrides: Partial<{ status: string; people: unknown[] }> = {}) {
  return {
    id: "prospect1",
    projectId: "proj1",
    companyId: "company1",
    status: overrides.status ?? "QUALIFIED",
    company: {
      id: "company1",
      name: "Acme Co",
      domain: "acme.com",
      industry: "software_saas",
      country: "US",
      employeeCount: 200,
      description: null,
      people: overrides.people ?? [{ id: "person1", fullName: "Jane Doe", title: "VP Sales", seniority: "vp", email: "jane@acme.com" }],
    },
    icpProfile: { definition: icpDefinition },
    results: [{ criterionId: "c1", criterionLabel: "Industry", status: "PASS", phase: "INITIAL", weight: 5, reason: "Matches SaaS industry" }],
  };
}

describe("MessagesService.generateDraft", () => {
  it("refuses to generate an email for a prospect that is not QUALIFIED", async () => {
    const prisma = { prospect: { findFirst: async () => makeProspect({ status: "NEEDS_REVIEW" }) } };
    const service = new MessagesService(prisma as never, makeProjectsStub() as never, {} as never);

    const err = await service.generateDraft(ws, "proj1", "prospect1").catch((e: AppException) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe("PROSPECT_NOT_QUALIFIED");
  });

  it("refuses when no contact on the company has an email address", async () => {
    const prisma = { prospect: { findFirst: async () => makeProspect({ people: [{ id: "p1", fullName: "No Email", title: "CEO", seniority: "c_level", email: null }] }) } };
    const service = new MessagesService(prisma as never, makeProjectsStub() as never, {} as never);

    const err = await service.generateDraft(ws, "proj1", "prospect1").catch((e: AppException) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe("NO_ELIGIBLE_RECIPIENT");
  });

  it("creates a Message row from the AI draft, auto-selecting the best recipient", async () => {
    let created: Record<string, unknown> | undefined;
    const prisma = {
      prospect: { findFirst: async () => makeProspect() },
      message: {
        findFirst: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created = data;
          return { id: "msg1", ...data };
        },
      },
    };
    const ai = { generateEmail: async () => ({ data: { subject: "Hi Acme", body: "Hello Jane", personalizationPoints: ["Matches SaaS industry"] }, aiRunId: "run1" }) };
    const service = new MessagesService(prisma as never, makeProjectsStub() as never, ai as never);

    const result = await service.generateDraft(ws, "proj1", "prospect1");

    expect(result.id).toBe("msg1");
    expect(created).toMatchObject({ personId: "person1", toAddress: "jane@acme.com", subject: "Hi Acme", body: "Hello Jane", qaStatus: "PENDING", reviewStatus: "PENDING" });
  });

  describe("reusing an existing message for the same company", () => {
    function setup(existingSendStatus: string | null) {
      const calls = { created: 0, updated: 0 };
      const stored = existingSendStatus ? [{ id: "old-msg", companyId: "company1", projectId: "proj1", sendStatus: existingSendStatus }] : [];
      const prisma = {
        prospect: { findFirst: async () => makeProspect() },
        message: {
          findFirst: async ({ where }: { where: { companyId: string; projectId: string; sendStatus?: { notIn?: string[] } } }) =>
            stored.find((m) => m.companyId === where.companyId && m.projectId === where.projectId && !where.sendStatus?.notIn?.includes(m.sendStatus)) ?? null,
          create: async ({ data }: { data: Record<string, unknown> }) => {
            calls.created++;
            return { id: "new-msg", ...data };
          },
          update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            calls.updated++;
            return { id: where.id, ...data };
          },
        },
      };
      const ai = { generateEmail: async () => ({ data: { subject: "Hi", body: "Hello", personalizationPoints: [] }, aiRunId: "run1" }) };
      return { calls, service: new MessagesService(prisma as never, makeProjectsStub() as never, ai as never) };
    }

    it("never overwrites a message that was already sent: it drafts a new one so send history is kept", async () => {
      for (const sent of ["SENT_SIMULATED", "SENT", "QUEUED"]) {
        const { calls, service } = setup(sent);
        const result = await service.generateDraft(ws, "proj1", "prospect1");
        expect(result.id).toBe("new-msg");
        expect(calls).toEqual({ created: 1, updated: 0 });
      }
    });

    it("still refreshes an existing unsent draft in place", async () => {
      const { calls, service } = setup("NOT_SENT");
      const result = await service.generateDraft(ws, "proj1", "prospect1");
      expect(result.id).toBe("old-msg");
      expect(calls).toEqual({ created: 0, updated: 1 });
    });

    it("refreshes a draft whose earlier send failed", async () => {
      const { calls, service } = setup("FAILED");
      const result = await service.generateDraft(ws, "proj1", "prospect1");
      expect(result.id).toBe("old-msg");
      expect(calls).toEqual({ created: 0, updated: 1 });
    });
  });
});

function makeMessage(overrides: Partial<{ qaStatus: string; reviewStatus: string }> = {}) {
  return {
    id: "msg1",
    projectId: "proj1",
    qaStatus: overrides.qaStatus ?? "PASS",
    reviewStatus: overrides.reviewStatus ?? "PENDING",
    company: { name: "Acme Co" },
    person: { fullName: "Jane Doe", title: "VP Sales" },
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    reviewedAt: null,
  };
}

describe("MessagesService.approve", () => {
  it("rejects approval when QA has not passed (PENDING)", async () => {
    const prisma = { message: { findFirst: async () => makeMessage({ qaStatus: "PENDING" }) } };
    const service = new MessagesService(prisma as never, makeProjectsStub() as never, {} as never);

    await expect(service.approve(ws, "proj1", "msg1", "user1")).rejects.toMatchObject({ code: "QA_NOT_PASSED" });
  });

  it("rejects approval when QA is FAIL", async () => {
    const prisma = { message: { findFirst: async () => makeMessage({ qaStatus: "FAIL" }) } };
    const service = new MessagesService(prisma as never, makeProjectsStub() as never, {} as never);

    await expect(service.approve(ws, "proj1", "msg1", "user1")).rejects.toMatchObject({ code: "QA_NOT_PASSED" });
  });

  it.each(["PASS", "WARN"])("allows approval when QA is %s", async (qaStatus) => {
    let updateData: Record<string, unknown> | undefined;
    const prisma = {
      message: {
        findFirst: async () => makeMessage({ qaStatus }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updateData = data;
          return { ...makeMessage({ qaStatus }), ...data };
        },
      },
    };
    const service = new MessagesService(prisma as never, makeProjectsStub() as never, {} as never);

    const result = await service.approve(ws, "proj1", "msg1", "user1");

    expect(updateData).toMatchObject({ reviewStatus: "APPROVED", reviewedById: "user1" });
    expect(result.reviewStatus).toBe("APPROVED");
  });
});

describe("MessagesService.edit", () => {
  it("resets reviewStatus to EDITED and qaStatus to PENDING, clearing the old QA result", async () => {
    let updateData: Record<string, unknown> | undefined;
    const prisma = {
      message: {
        findFirst: async () => makeMessage({ qaStatus: "PASS", reviewStatus: "APPROVED" }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updateData = data;
          return { ...makeMessage(), ...data };
        },
      },
    };
    const service = new MessagesService(prisma as never, makeProjectsStub() as never, {} as never);

    await service.edit(ws, "proj1", "msg1", { subject: "New subject", body: "New body" });

    expect(updateData).toMatchObject({ subject: "New subject", body: "New body", reviewStatus: "EDITED", qaStatus: "PENDING" });
  });
});
