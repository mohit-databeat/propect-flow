import { randomUUID } from "node:crypto";
import type { IcpDraftDefinition, IcpExtractionOutput } from "@prospect/shared";
import { IcpService } from "./icp.service";
import { AppException } from "../../common/errors";

interface FakeRow {
  id: string;
  projectId: string;
  version: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  naturalLanguage: string;
  definition: unknown;
  chatTranscript: unknown;
  blockingOpenCount: number;
  createdById: string | null;
  activatedAt: Date | null;
  createdAt: Date;
}

function makeFakePrisma() {
  const rows: FakeRow[] = [];

  const icpProfile = {
    findFirst: async ({ where, orderBy }: { where: Partial<Pick<FakeRow, "projectId" | "status">>; orderBy?: { version?: "asc" | "desc" } }) => {
      let matches = rows.filter((r) => (where.projectId === undefined || r.projectId === where.projectId) && (where.status === undefined || r.status === where.status));
      if (orderBy?.version === "desc") matches = [...matches].sort((a, b) => b.version - a.version);
      return matches[0] ?? null;
    },
    findMany: async ({ where, orderBy }: { where: { projectId: string }; orderBy?: { version?: "asc" | "desc" } }) => {
      let matches = rows.filter((r) => r.projectId === where.projectId);
      if (orderBy?.version === "desc") matches = [...matches].sort((a, b) => b.version - a.version);
      return matches;
    },
    create: async ({ data }: { data: Omit<FakeRow, "id" | "createdAt" | "activatedAt"> & { activatedAt?: Date | null } }) => {
      const row: FakeRow = { id: randomUUID(), createdAt: new Date(), activatedAt: data.activatedAt ?? null, ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<FakeRow> }) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: { where: Partial<Pick<FakeRow, "projectId" | "status">>; data: Partial<FakeRow> }) => {
      const matches = rows.filter((r) => (where.projectId === undefined || r.projectId === where.projectId) && (where.status === undefined || r.status === where.status));
      for (const r of matches) Object.assign(r, data);
      return { count: matches.length };
    },
  };

  return {
    icpProfile,
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    __rows: rows,
  };
}

function makeProjectsStub() {
  return { findOneOrThrow: async () => ({ id: "proj1" }) };
}

const VALID_ICP_DRAFT: Omit<IcpDraftDefinition, "clarifications"> = {
  schemaVersion: 1,
  name: "US SaaS",
  summary: "Test",
  targetPersonas: [],
  criteria: [
    {
      id: "country_us",
      label: "US",
      kind: "DETERMINISTIC",
      field: "firmographics.country",
      operator: "EQ",
      value: "US",
      weight: 8,
      required: true,
      enrichIfMissing: true,
    },
  ],
  scoring: { qualifiedThreshold: 70, needsReviewThreshold: 40, minCoverage: 60, unknownRequiredPolicy: "NEEDS_REVIEW" },
};

function extraction(overrides: Partial<IcpExtractionOutput> = {}): IcpExtractionOutput {
  return {
    draft: VALID_ICP_DRAFT,
    clarifications: [],
    unsupported: [],
    assistantMessage: "ok",
    ...overrides,
  };
}

function makeAiStub(sequence: IcpExtractionOutput[]) {
  let call = 0;
  return {
    extractIcp: jest.fn(async () => {
      const data = sequence[Math.min(call, sequence.length - 1)]!;
      call += 1;
      return { data, aiRunId: "ai-run-1" };
    }),
  };
}

const ws = { id: "ws1", role: "OWNER" as const };

describe("IcpService", () => {
  it("chat() creates version 1 with a zero-criteria draft when the extractor returns none", async () => {
    const prisma = makeFakePrisma();
    const ai = makeAiStub([extraction({ draft: { ...VALID_ICP_DRAFT, criteria: [] } })]);
    const service = new IcpService(prisma as never, makeProjectsStub() as never, ai as never);

    const state = await service.chat(ws, "proj1", "user1", "target mid-size companies");

    expect(state.draft?.version).toBe(1);
    expect(state.draft?.definition.criteria).toHaveLength(0);
    expect(state.activatable).toBe(false);
  });

  it("activate() rejects a zero-criteria draft with 409 ICP_NOT_ACTIVATABLE", async () => {
    const prisma = makeFakePrisma();
    const ai = makeAiStub([extraction({ draft: { ...VALID_ICP_DRAFT, criteria: [] } })]);
    const service = new IcpService(prisma as never, makeProjectsStub() as never, ai as never);
    await service.chat(ws, "proj1", "user1", "target mid-size companies");

    await expect(service.activate(ws, "proj1")).rejects.toMatchObject({ code: "ICP_NOT_ACTIVATABLE" });
    try {
      await service.activate(ws, "proj1");
    } catch (e) {
      expect((e as AppException).getStatus()).toBe(409);
    }
  });

  it("an open BLOCKING clarification prevents activation even with criteria present", async () => {
    const prisma = makeFakePrisma();
    const draftWithBlocking = {
      ...VALID_ICP_DRAFT,
      clarifications: [
        {
          id: "clar:general:ambiguous_scope",
          type: "ambiguous_scope" as const,
          question: "range?",
          severity: "BLOCKING" as const,
          answer: null,
          proposedDefault: "100-500",
          resolvedBy: "UNRESOLVED" as const,
        },
      ],
    };
    const ai = makeAiStub([{ draft: VALID_ICP_DRAFT, clarifications: [{ type: "ambiguous_scope", question: "range?", severity: "BLOCKING", proposedDefault: "100-500" }], unsupported: [], assistantMessage: "?" }]);
    const service = new IcpService(prisma as never, makeProjectsStub() as never, ai as never);
    const state = await service.chat(ws, "proj1", "user1", "hello");
    expect(state.activatable).toBe(false);
    void draftWithBlocking;

    const err = await service.activate(ws, "proj1").catch((e: AppException) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe("ICP_NOT_ACTIVATABLE");
  });

  it("resolveClarification() requires the clarification to exist (404 CLARIFICATION_NOT_FOUND)", async () => {
    const prisma = makeFakePrisma();
    const ai = makeAiStub([extraction()]);
    const service = new IcpService(prisma as never, makeProjectsStub() as never, ai as never);
    await service.chat(ws, "proj1", "user1", "hi");

    const err = await service.resolveClarification(ws, "proj1", "user1", "clar:does:not-exist", "answer").catch((e: AppException) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe("CLARIFICATION_NOT_FOUND");
  });

  it("resolveClarification() sets resolvedBy USER with the given answer and the answer survives the next chat turn", async () => {
    const prisma = makeFakePrisma();
    const blockingProposal = { type: "ambiguous_scope" as const, question: "What employee range do you mean by mid-size?", severity: "BLOCKING" as const, proposedDefault: "100-500 employees" };
    const ai = makeAiStub([

      { draft: { ...VALID_ICP_DRAFT, criteria: [] }, clarifications: [blockingProposal], unsupported: [], assistantMessage: "what range?" },

      { draft: VALID_ICP_DRAFT, clarifications: [], unsupported: [], assistantMessage: "got it" },

      { draft: VALID_ICP_DRAFT, clarifications: [], unsupported: [], assistantMessage: "anything else?" },
    ]);
    const service = new IcpService(prisma as never, makeProjectsStub() as never, ai as never);

    const afterChat = await service.chat(ws, "proj1", "user1", "target mid-size companies");
    const clarId = afterChat.unresolvedClarifications[0]!.id;

    const afterResolve = await service.resolveClarification(ws, "proj1", "user1", clarId, "100-500 employees");
    const resolved = afterResolve.draft!.definition.clarifications.find((c) => c.id === clarId)!;
    expect(resolved.resolvedBy).toBe("USER");
    expect(resolved.answer).toBe("100-500 employees");
    expect(afterResolve.unresolvedClarifications).toHaveLength(0);

    const afterNextTurn = await service.chat(ws, "proj1", "user1", "anything else to add?");
    const stillResolved = afterNextTurn.draft!.definition.clarifications.find((c) => c.id === clarId)!;
    expect(stillResolved.resolvedBy).toBe("USER");
    expect(stillResolved.answer).toBe("100-500 employees");
  });

  it("activating a valid ICP archives the previous ACTIVE version and preserves version history", async () => {
    const prisma = makeFakePrisma();
    const ai = makeAiStub([extraction()]);
    const service = new IcpService(prisma as never, makeProjectsStub() as never, ai as never);

    await service.chat(ws, "proj1", "user1", "build the icp");
    const firstActivation = await service.activate(ws, "proj1");
    expect(firstActivation.active?.version).toBe(1);

    const ai2Sequence = extraction({ draft: { ...VALID_ICP_DRAFT, name: "V2 ICP" } });
    (ai as unknown as { extractIcp: jest.Mock }).extractIcp.mockResolvedValueOnce({ data: ai2Sequence, aiRunId: "run-2" });
    await service.chat(ws, "proj1", "user1", "refine the icp");
    const secondActivation = await service.activate(ws, "proj1");

    expect(secondActivation.active?.version).toBe(2);
    expect(secondActivation.active?.definition.name).toBe("V2 ICP");

    const versions = await service.versions(ws, "proj1");
    expect(versions).toHaveLength(2);
    const v1 = versions.find((v) => v.version === 1)!;
    const v2 = versions.find((v) => v.version === 2)!;
    expect(v1.status).toBe("ARCHIVED");
    expect(v2.status).toBe("ACTIVE");
  });
});
