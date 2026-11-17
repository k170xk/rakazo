import { printedJson } from "./ocsc-tool.js";

/**
 * Told to the builder after a refused or broken Word/Excel/PowerPoint/PDF write so it iterates
 * like App Studio / Lovable, instead of declaring the document ready.
 */
export const FIX_DOCUMENT_BEFORE_READY =
  "Fix this with the ocsc tool (edit the same file, or new only if they asked for a new document), then attach_file the result under the same name before telling the person the document is ready. Do not present a broken or incomplete file as done.";

/** ocsc commands that create or change a document file the person may open or download. */
export const DOCUMENT_WRITE_STEPS: Readonly<Record<string, readonly string[]>> = {
  word: ["new", "edit", "accept"],
  pptx: ["new", "edit"],
  xlsx: ["new", "edit"],
  pdf: ["convert"],
};

/** Clear failure text from OCSC / Excel repair / open errors — soft "kept chart" warnings do not match. */
const CLEAR_FAILURE =
  /corrupt|unreadable|could not open|couldn't open|failed to (?:write|save|open|update)|did not (?:write|save|update)|not (?:a )?valid|invalid (?:docx|xlsx|pptx|pdf|zip|workbook|presentation|document)|repair|refuses the file|found a problem with some content|shared formula|page setup|exceljs|zip|empty file|0 bytes|not updated/i;

export function isDocumentWrite(program: string, args: readonly string[]): boolean {
  const step = args[0] ?? "";
  return DOCUMENT_WRITE_STEPS[program]?.includes(step) === true;
}

export type DocumentDraftOutcome = "saved" | "skipped" | "failed";

function problemText(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

/**
 * When an ocsc write failed or left a clear problem, add `documentCheck`, `problems` and `next` so
 * the agent must fix and retry before telling the person the document is ready. Read-only commands
 * and clean successes pass through unchanged.
 */
export function annotateDocumentWriteResult(
  program: string,
  args: readonly string[],
  result: Record<string, unknown>,
  extras?: { draftOutcome?: DocumentDraftOutcome },
): Record<string, unknown> {
  if (!isDocumentWrite(program, args)) return result;
  if (result.running === true) return result;

  const step = args[0] ?? "write";
  const problems: string[] = [];
  const printed = printedJson(result);
  const code = typeof result.code === "number" ? result.code : undefined;
  const topError = typeof result.error === "string" ? result.error : undefined;

  if (topError && result.stdout === undefined) {
    problems.push(topError);
  }
  if (code !== undefined && code !== 0) {
    problems.push(
      problemText(
        printed?.error,
        `ocsc ${program} ${step} exited with code ${code} and did not update the document.`,
      ),
    );
  }
  if (printed?.ok === false) {
    problems.push(
      problemText(printed.error, `ocsc ${program} ${step} did not update the document.`),
    );
  }
  if (printed?.ok === true && (typeof printed.path !== "string" || !printed.path.trim())) {
    problems.push(`ocsc ${program} ${step} reported success without a file path.`);
  }
  const warning = typeof printed?.warning === "string" ? printed.warning : undefined;
  if (warning && CLEAR_FAILURE.test(warning)) {
    problems.push(warning);
  }
  if (extras?.draftOutcome === "failed") {
    problems.push(
      "The open studio could not take this edit as a live draft. Attach the file with attach_file under the document's exact name so the studio can load it, or fix the file and edit again.",
    );
  }

  if (problems.length === 0) return result;
  return {
    ...result,
    ok: false,
    documentCheck: "problems",
    problems: [...new Set(problems)],
    next: FIX_DOCUMENT_BEFORE_READY,
  };
}

/** Office attach failures get the same iterate instruction as a failed ocsc write. */
export function annotateOfficeAttachFailure(
  path: string,
  error: string,
  mimeType: string | undefined,
): Record<string, unknown> {
  const office =
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mimeType === "application/pdf" ||
    /\.(docx|xlsx|pptx|pdf)$/i.test(path);
  if (!office) return { error, path };
  return {
    ok: false,
    error,
    path,
    documentCheck: "problems",
    problems: [error],
    next: FIX_DOCUMENT_BEFORE_READY,
  };
}
