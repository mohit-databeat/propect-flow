import { GenerateEmailStepHandler } from "./generate-email.step";

const run = { id: "run2", projectId: "proj1" } as never;

function makePrisma(opts: { qualified: { id: string; companyId: string }[]; existingMessages: { companyId: string; sendStatus: string }[] }) {
  return {
    project: { findUniqueOrThrow: async () => ({ id: "proj1", workspaceId: "ws1" }) },
    prospect: { findMany: async () => opts.qualified },
    message: {
      findMany: async ({ where }: { where: { sendStatus: string } }) => opts.existingMessages.filter((m) => m.sendStatus === where.sendStatus).map((m) => ({ companyId: m.companyId })),
    },
  };
}

describe("GenerateEmailStepHandler", () => {
  it("does not draft a second email for a company that already has an unsent one from an EARLIER workflow run (different prospectId)", async () => {

    const prisma = makePrisma({
      qualified: [{ id: "prospect-from-run-2", companyId: "co1" }],
      existingMessages: [{ companyId: "co1", sendStatus: "NOT_SENT" }],
    });
    const generateDraft = jest.fn();
    const handler = new GenerateEmailStepHandler(prisma as never, { generateDraft } as never);

    const outcome = await handler.run(run);

    expect(generateDraft).not.toHaveBeenCalled();
    expect(outcome.summary).toMatchObject({ qualified: 1, alreadyDrafted: 1, drafted: 0 });
  });

  it("drafts a fresh email when the company's only prior message was already sent (new outreach cycle)", async () => {
    const prisma = makePrisma({
      qualified: [{ id: "prospect-from-run-2", companyId: "co1" }],
      existingMessages: [{ companyId: "co1", sendStatus: "SENT_SIMULATED" }],
    });
    const generateDraft = jest.fn(async () => ({}));
    const handler = new GenerateEmailStepHandler(prisma as never, { generateDraft } as never);

    const outcome = await handler.run(run);

    expect(generateDraft).toHaveBeenCalledWith(expect.anything(), "proj1", "prospect-from-run-2");
    expect(outcome.summary).toMatchObject({ drafted: 1 });
  });

  it("drafts for a company with no prior message at all", async () => {
    const prisma = makePrisma({ qualified: [{ id: "p1", companyId: "co1" }], existingMessages: [] });
    const generateDraft = jest.fn(async () => ({}));
    const handler = new GenerateEmailStepHandler(prisma as never, { generateDraft } as never);

    const outcome = await handler.run(run);

    expect(generateDraft).toHaveBeenCalledTimes(1);
    expect(outcome.summary).toMatchObject({ drafted: 1, alreadyDrafted: 0 });
  });
});
