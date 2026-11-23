import { describe, expect, it } from "vitest";
import {
  annotateDocumentWriteResult,
  annotateOfficeAttachFailure,
  FIX_DOCUMENT_BEFORE_READY,
  isDocumentWrite,
} from "./document-write-check.js";

const okWrite = (path: string) => ({
  stdout: JSON.stringify({ ok: true, path }),
  stderr: "",
  code: 0,
});

describe("isDocumentWrite", () => {
  it("covers Word, Excel, PowerPoint writes and PDF convert", () => {
    expect(isDocumentWrite("word", ["edit", "--in", "a.docx"])).toBe(true);
    expect(isDocumentWrite("xlsx", ["new", "--out", "a.xlsx"])).toBe(true);
    expect(isDocumentWrite("pptx", ["edit"])).toBe(true);
    expect(isDocumentWrite("pdf", ["convert", "--in", "a.docx"])).toBe(true);
    expect(isDocumentWrite("word", ["read", "--in", "a.docx"])).toBe(false);
    expect(isDocumentWrite("xlsx", ["read"])).toBe(false);
    expect(isDocumentWrite("video", ["render"])).toBe(false);
  });
});

describe("annotateDocumentWriteResult", () => {
  it("leaves a clean successful write alone", () => {
    const result = okWrite("outputs/Plan.xlsx");
    expect(annotateDocumentWriteResult("xlsx", ["edit", "--in", "a.xlsx"], result)).toEqual(
      result,
    );
  });

  it("leaves reads alone even when they fail", () => {
    const result = {
      stdout: JSON.stringify({ ok: false, error: "missing file" }),
      code: 1,
    };
    expect(annotateDocumentWriteResult("xlsx", ["read", "--in", "a.xlsx"], result)).toEqual(
      result,
    );
  });

  it("adds next when ocsc reports ok: false", () => {
    const result = {
      stdout: JSON.stringify({ ok: false, error: "bad shared formula range" }),
      code: 1,
    };
    expect(annotateDocumentWriteResult("xlsx", ["edit", "--in", "a.xlsx"], result)).toMatchObject({
      ok: false,
      documentCheck: "problems",
      problems: [expect.stringContaining("shared formula")],
      next: FIX_DOCUMENT_BEFORE_READY,
    });
  });

  it("adds next when the runner returns an error with no stdout", () => {
    expect(
      annotateDocumentWriteResult("word", ["new", "--out", "a.docx"], {
        error: "the document runner failed",
      }),
    ).toMatchObject({
      ok: false,
      documentCheck: "problems",
      problems: ["the document runner failed"],
      next: FIX_DOCUMENT_BEFORE_READY,
    });
  });

  it("adds next when success omits a path", () => {
    expect(
      annotateDocumentWriteResult("pptx", ["edit"], {
        stdout: JSON.stringify({ ok: true }),
        code: 0,
      }),
    ).toMatchObject({
      ok: false,
      documentCheck: "problems",
      next: FIX_DOCUMENT_BEFORE_READY,
    });
  });

  it("treats a clear repair warning as a problem, not a soft kept-parts note", () => {
    const soft = {
      stdout: JSON.stringify({
        ok: true,
        path: "outputs/a.xlsx",
        warning: "Charts were kept from the original workbook.",
      }),
      code: 0,
    };
    expect(annotateDocumentWriteResult("xlsx", ["edit"], soft)).toEqual(soft);

    const clear = {
      stdout: JSON.stringify({
        ok: true,
        path: "outputs/a.xlsx",
        warning: "Excel refuses the file and may offer to repair it.",
      }),
      code: 0,
    };
    expect(annotateDocumentWriteResult("xlsx", ["edit"], clear)).toMatchObject({
      ok: false,
      documentCheck: "problems",
      next: FIX_DOCUMENT_BEFORE_READY,
    });
  });

  it("adds next when the open studio draft could not be saved", () => {
    expect(
      annotateDocumentWriteResult("xlsx", ["edit", "--in", "a.xlsx"], okWrite("outputs/a.xlsx"), {
        draftOutcome: "failed",
      }),
    ).toMatchObject({
      ok: false,
      documentCheck: "problems",
      problems: [expect.stringContaining("live draft")],
      next: FIX_DOCUMENT_BEFORE_READY,
    });
  });

  it("does not reshape a still-running command", () => {
    const running = { stdout: "", stderr: "", code: null, running: true };
    expect(annotateDocumentWriteResult("word", ["edit"], running)).toEqual(running);
  });

  it("enforces closed critical-path logic on ocsc-plan new and edit", () => {
    const unlinked = {
      stdout: JSON.stringify({
        ok: true,
        path: "outputs/p.jantt",
        taskCount: 4,
        schedule: {
          leafTaskCount: 3,
          dependencyCount: 0,
          criticalCount: 1,
          criticalLinks: 0,
          unlinkedLeafTasks: ["t1", "t2", "t3"],
        },
      }),
      code: 0,
    };
    expect(annotateDocumentWriteResult("plan", ["new"], unlinked)).toMatchObject({
      ok: false,
      documentCheck: "problems",
      problems: expect.arrayContaining([
        expect.stringContaining("zero predecessor links"),
        expect.stringContaining("3 unlinked leaf task"),
      ]),
      next: FIX_DOCUMENT_BEFORE_READY,
    });

    const summaryLinked = {
      stdout: JSON.stringify({
        ok: true,
        path: "outputs/p.jantt",
        taskCount: 3,
        schedule: {
          leafTaskCount: 2,
          dependencyCount: 1,
          criticalCount: 2,
          criticalLinks: 1,
          summaryLinkWarnings: ["p1 → t2"],
        },
      }),
      code: 0,
    };
    expect(annotateDocumentWriteResult("plan", ["edit"], summaryLinked)).toMatchObject({
      ok: false,
      documentCheck: "problems",
      problems: [expect.stringContaining("summary/phase rows")],
      next: FIX_DOCUMENT_BEFORE_READY,
    });

    const valid = {
      stdout: JSON.stringify({
        ok: true,
        path: "outputs/p.jantt",
        taskCount: 5,
        schedule: {
          leafTaskCount: 4,
          dependencyCount: 4,
          criticalCount: 3,
          criticalLinks: 2,
        },
      }),
      code: 0,
    };
    expect(annotateDocumentWriteResult("plan", ["new"], valid)).toEqual(valid);
  });
});

describe("annotateOfficeAttachFailure", () => {
  it("adds next for Office and PDF paths", () => {
    expect(annotateOfficeAttachFailure("outputs/Cost.xlsx", "file not found", undefined)).toEqual({
      ok: false,
      error: "file not found",
      path: "outputs/Cost.xlsx",
      documentCheck: "problems",
      problems: ["file not found"],
      next: FIX_DOCUMENT_BEFORE_READY,
    });
  });

  it("leaves ordinary attach failures without the document iterate loop", () => {
    expect(annotateOfficeAttachFailure("logs/run.txt", "file not found", "text/plain")).toEqual({
      error: "file not found",
      path: "logs/run.txt",
    });
  });
});
