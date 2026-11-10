import { beforeEach, describe, expect, it, vi } from "vitest";

class EvolvePluginsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
const callEvolveDocumentLibrary = vi.fn();
vi.mock("@rakazo/adapters", () => ({ callEvolveDocumentLibrary, EvolvePluginsError }));
const setCompanyTools = vi.fn();
vi.mock("./company-admin.js", () => ({ setCompanyTools }));
vi.mock("./routes/bots.js", () => ({
  actorEmail: async () => "keith@ocsc.co.uk",
}));

const { listLibraryDocuments, setDefaultLibraryTemplate, setLibraryDocumentAccess } = await import(
  "./company-document-library.js"
);

const connection = { url: "https://evolve.example/functions/v1/plugin-builder", secret: "s" };
const actor = { userId: "u1" } as never;
const ID = "7f9c2d4e-1b3a-4c5d-8e6f-0a1b2c3d4e5f";

function deps(admin = true) {
  return {
    evolvePlugins: connection,
    env: { adminEmails: ["keith@ocsc.co.uk"] },
    prisma: {
      deploymentSettings: {
        findUnique: async () => ({ companyTools: { defaultWordTemplateId: ID } }),
      },
      user: {
        findUnique: async () => ({
          email: admin ? "keith@ocsc.co.uk" : "someone@ocsc.co.uk",
          emailVerified: true,
        }),
      },
    },
  } as never;
}

const document = {
  id: ID,
  title: "Fee proposal",
  folder: "Templates",
  fileName: "fee.docx",
  type: "document",
  aiAccess: "read_only",
  hasInstructions: false,
  canBeTemplate: true,
};

describe("company document library", () => {
  beforeEach(() => {
    callEvolveDocumentLibrary.mockReset();
    setCompanyTools.mockReset();
  });

  it("lists documents from Evolve as the admin and drops malformed rows", async () => {
    callEvolveDocumentLibrary.mockResolvedValueOnce({ documents: [document, { id: 3 }] });
    await expect(listLibraryDocuments(deps(), actor)).resolves.toEqual({
      documents: [document],
      defaultTemplateId: ID,
    });
    expect(callEvolveDocumentLibrary).toHaveBeenCalledWith(connection, "keith@ocsc.co.uk", {
      action: "list",
    });
  });

  it("refuses people who are not company admins without asking Evolve", async () => {
    await expect(listLibraryDocuments(deps(false), actor)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(callEvolveDocumentLibrary).not.toHaveBeenCalled();
  });

  it("sets one document's access", async () => {
    callEvolveDocumentLibrary.mockResolvedValueOnce({ ok: true });
    await expect(
      setLibraryDocumentAccess(deps(), actor, { id: ID, aiAccess: "template" }),
    ).resolves.toEqual({ id: ID, aiAccess: "template" });
    expect(callEvolveDocumentLibrary).toHaveBeenCalledWith(connection, "keith@ocsc.co.uk", {
      action: "set",
      id: ID,
      aiAccess: "template",
    });
  });

  it("passes on Evolve's own refusal", async () => {
    callEvolveDocumentLibrary.mockRejectedValueOnce(
      new EvolvePluginsError(
        "Only Evolve admins and Document Library managers can change AI access.",
        403,
      ),
    );
    await expect(listLibraryDocuments(deps(), actor)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Only Evolve admins and Document Library managers can change AI access.",
    });
  });

  it("reports an unreachable Evolve plainly", async () => {
    callEvolveDocumentLibrary.mockRejectedValueOnce(new Error("fetch failed"));
    await expect(listLibraryDocuments(deps(), actor)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("makes only a current Word template the default", async () => {
    callEvolveDocumentLibrary.mockResolvedValueOnce({ documents: [document] });
    await expect(setDefaultLibraryTemplate(deps(), actor, { id: ID })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(setCompanyTools).not.toHaveBeenCalled();

    callEvolveDocumentLibrary.mockResolvedValueOnce({
      documents: [{ ...document, aiAccess: "template" }],
    });
    await expect(setDefaultLibraryTemplate(deps(), actor, { id: ID })).resolves.toEqual({
      defaultTemplateId: ID,
    });
    expect(setCompanyTools).toHaveBeenCalledWith(expect.anything(), actor, {
      defaultWordTemplateId: ID,
    });
  });

  it("returns to the built-in report without asking Evolve", async () => {
    await expect(setDefaultLibraryTemplate(deps(), actor, { id: null })).resolves.toEqual({
      defaultTemplateId: null,
    });
    expect(callEvolveDocumentLibrary).not.toHaveBeenCalled();
    expect(setCompanyTools).toHaveBeenCalledWith(expect.anything(), actor, {
      defaultWordTemplateId: null,
    });
  });
});
