/** One markup as the history compares it. */
export type PdfMarkup = { kind: string; text: string; key: string };

export type PdfPageSnapshot = { text: string; markups: PdfMarkup[] };

export type PdfSnapshot = { pages: PdfPageSnapshot[] };

export type PdfPageDiff = {
  page: number;
  status: "added" | "removed" | "changed";
  textChanged: boolean;
  added: PdfMarkup[];
  removed: PdfMarkup[];
};

export type PdfDiff = { pages: PdfPageDiff[]; markupsAdded: number; markupsRemoved: number };

const MARKUP_TEXT_MAX = 160;

/** The markup's key: what it is, what it says and where it sits, to the nearest point. */
export function markupOf(annotation: {
  subtype?: unknown;
  contentsObj?: { str?: unknown };
  contents?: unknown;
  rect?: unknown;
}): PdfMarkup | null {
  const kind = typeof annotation.subtype === "string" ? annotation.subtype : "";
  if (!kind || kind === "Link" || kind === "Widget" || kind === "Popup") return null;
  const raw =
    typeof annotation.contentsObj?.str === "string"
      ? annotation.contentsObj.str
      : typeof annotation.contents === "string"
        ? annotation.contents
        : "";
  const text = raw.replace(/\s+/g, " ").trim().slice(0, MARKUP_TEXT_MAX);
  const rect = Array.isArray(annotation.rect)
    ? annotation.rect.map((n) => (typeof n === "number" ? Math.round(n) : 0)).join(",")
    : "";
  return { kind, text, key: `${kind}|${text}|${rect}` };
}

function minus(a: readonly PdfMarkup[], b: readonly PdfMarkup[]): PdfMarkup[] {
  const left = new Map<string, number>();
  for (const markup of b) left.set(markup.key, (left.get(markup.key) ?? 0) + 1);
  return a.filter((markup) => {
    const count = left.get(markup.key) ?? 0;
    if (count === 0) return true;
    left.set(markup.key, count - 1);
    return false;
  });
}

/** What `after` changed against `before`, page by page. */
export function diffPdf(before: PdfSnapshot | null, after: PdfSnapshot): PdfDiff {
  const old = before?.pages ?? [];
  const pages: PdfPageDiff[] = [];
  const count = Math.max(old.length, after.pages.length);
  for (let index = 0; index < count; index += 1) {
    const was = old[index];
    const now = after.pages[index];
    if (!was && now) {
      pages.push({
        page: index + 1,
        status: "added",
        textChanged: false,
        added: now.markups,
        removed: [],
      });
    } else if (was && !now) {
      pages.push({
        page: index + 1,
        status: "removed",
        textChanged: false,
        added: [],
        removed: was.markups,
      });
    } else if (was && now) {
      const added = minus(now.markups, was.markups);
      const removed = minus(was.markups, now.markups);
      const textChanged = was.text !== now.text;
      if (added.length || removed.length || textChanged) {
        pages.push({ page: index + 1, status: "changed", textChanged, added, removed });
      }
    }
  }
  return {
    pages,
    markupsAdded: pages.reduce((sum, page) => sum + page.added.length, 0),
    markupsRemoved: pages.reduce((sum, page) => sum + page.removed.length, 0),
  };
}
