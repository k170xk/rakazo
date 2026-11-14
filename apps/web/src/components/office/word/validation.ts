export type DocxIssue = {
  level: "error" | "warning";
  code: string;
  message: string;
  partName?: string;
};

function issueKey(issue: DocxIssue): string {
  return `${issue.code}\n${issue.partName ?? ""}\n${issue.message}`;
}

/**
 * Errors a save would add. Errors the file already had when it opened are not the studio's
 * doing, so they never block saving; warnings never do.
 */
export function newDocxErrors(
  opened: readonly DocxIssue[] | null,
  saving: readonly DocxIssue[],
): DocxIssue[] {
  const known = new Set((opened ?? []).filter((i) => i.level === "error").map(issueKey));
  return saving.filter((issue) => issue.level === "error" && !known.has(issueKey(issue)));
}

/** The package checks Word runs before opening a file. Loads the checker on first use. */
export async function checkDocx(bytes: Uint8Array): Promise<DocxIssue[]> {
  const kit = await import("@office-kit/docx");
  try {
    return kit.validate(kit.openDocx(bytes)).map((issue) => ({
      level: issue.level,
      code: issue.code,
      message: issue.message,
      ...(issue.partName ? { partName: issue.partName } : {}),
    }));
  } catch (error) {
    return [
      {
        level: "error",
        code: "UNREADABLE",
        message: error instanceof Error ? error.message : "The file could not be read.",
      },
    ];
  }
}
