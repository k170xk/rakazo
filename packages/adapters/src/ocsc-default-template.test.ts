import { DEFAULT_COMPANY_TOOLS } from "@rakazo/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callEvolveDocumentLibrary = vi.fn();
vi.mock("./evolve-plugins.js", () => ({ callEvolveDocumentLibrary }));

const { setCompanyPolicy } = await import("./company-policy.js");
const { resetLibraryTemplateCache, withDefaultWordTemplate } = await import("./ocsc-tool.js");

const ID = "7f9c2d4e-1b3a-4c5d-8e6f-0a1b2c3d4e5f";
const URL = "https://evolve.example/storage/v1/object/public/forum-attachments/report.docx";
const connection = { url: "https://evolve.example/functions/v1/plugin-builder", secret: "s" };

function ctx(evolvePlugins: unknown = connection) {
  return {
    deps: {
      evolvePlugins,
      prisma: { user: { findUnique: async () => ({ email: "keith@ocsc.co.uk" }) } },
    },
    run: { userId: "u1" },
  } as never;
}

const NEW = ["new", "--spec", "spec.json", "--out", "outputs/Report.docx"];

describe("withDefaultWordTemplate", () => {
  beforeEach(() => {
    resetLibraryTemplateCache();
    callEvolveDocumentLibrary.mockReset();
    setCompanyPolicy({ tools: { ...DEFAULT_COMPANY_TOOLS, defaultWordTemplateId: ID } });
  });
  afterEach(() => setCompanyPolicy({ tools: null }));

  it("adds the Library default to a new document that names no template", async () => {
    callEvolveDocumentLibrary.mockResolvedValueOnce({ title: "OCSC Report", fileUrl: URL });
    await expect(withDefaultWordTemplate(ctx(), "word", NEW)).resolves.toEqual([
      ...NEW,
      "--default-template-url",
      URL,
      "--default-template-name",
      "OCSC Report",
    ]);
    expect(callEvolveDocumentLibrary).toHaveBeenCalledWith(connection, "keith@ocsc.co.uk", {
      action: "template",
      id: ID,
    });
  });

  it("asks Evolve once for several documents", async () => {
    callEvolveDocumentLibrary.mockResolvedValueOnce({ title: "OCSC Report", fileUrl: URL });
    await withDefaultWordTemplate(ctx(), "word", NEW);
    await withDefaultWordTemplate(ctx(), "word", NEW);
    expect(callEvolveDocumentLibrary).toHaveBeenCalledOnce();
  });

  it("leaves a named template, edits and other programs alone", async () => {
    const named = [...NEW, "--template", "QF18"];
    await expect(withDefaultWordTemplate(ctx(), "word", named)).resolves.toEqual(named);
    const edit = ["edit", "--in", "a.docx", "--spec", "e.json"];
    await expect(withDefaultWordTemplate(ctx(), "word", edit)).resolves.toEqual(edit);
    await expect(withDefaultWordTemplate(ctx(), "pptx", NEW)).resolves.toEqual(NEW);
    expect(callEvolveDocumentLibrary).not.toHaveBeenCalled();
  });

  it("keeps the built-in report with no default, no Evolve, or a failed lookup", async () => {
    setCompanyPolicy({ tools: { ...DEFAULT_COMPANY_TOOLS, defaultWordTemplateId: null } });
    await expect(withDefaultWordTemplate(ctx(), "word", NEW)).resolves.toEqual(NEW);

    setCompanyPolicy({ tools: { ...DEFAULT_COMPANY_TOOLS, defaultWordTemplateId: ID } });
    await expect(withDefaultWordTemplate(ctx(null), "word", NEW)).resolves.toEqual(NEW);

    callEvolveDocumentLibrary.mockRejectedValueOnce(new Error("not a template"));
    await expect(withDefaultWordTemplate(ctx(), "word", NEW)).resolves.toEqual(NEW);
  });
});
