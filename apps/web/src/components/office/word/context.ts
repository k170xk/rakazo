import type { DocumentStudioFocus, DocumentStudioSelected } from "@rakazo/contracts";
import { clip, markdownTable } from "../context";

/** What the editor reports as selected. */
export type WordSelection =
  | { kind: "text"; text: string }
  | { kind: "table"; caption: string | null; rows: string[][] }
  | {
      kind: "image";
      alt: string | null;
      name: string | null;
      width: number | null;
      height: number | null;
    };

/** Where the person is in the document, as the editor reports it. */
export type WordView = {
  page: number;
  pages: number;
  /** The text painted on that page, when the editor can read it. */
  pageText: string | null;
  /** Headings found on that page, in order. */
  headings: string[];
  selection: WordSelection | null;
};

/** The person's language for the chip; the assistant's lines stay in English. */
export type WordChipWords = {
  page: (page: number) => string;
  table: (name: string) => string;
  tableUnnamed: string;
  image: (name: string) => string;
  imageUnnamed: string;
  text: (excerpt: string) => string;
};

const PAGE_TEXT_MAX = 900;
const TABLE_CELLS_MAX = 200;
const SELECTED_TEXT_MAX = 4000;

function size(width: number | null, height: number | null): string {
  return width && height ? `${Math.round(width)} × ${Math.round(height)} px` : "";
}

/** The studio note's focus and selection for a Word document. */
export function wordContext(
  view: WordView,
  words: WordChipWords,
): { focus: DocumentStudioFocus; selected: DocumentStudioSelected | null } {
  const page = Math.max(1, view.page);
  const detail = [
    view.headings.length ? `Headings: ${view.headings.map((h) => clip(h, 120)).join(" / ")}` : "",
    view.pageText ? `Text: ${clip(view.pageText, PAGE_TEXT_MAX)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const focus: DocumentStudioFocus = {
    where: view.pages > 0 ? `page ${page} of ${view.pages}` : `page ${page}`,
    short: words.page(page),
    detail: detail || undefined,
  };
  const selection = view.selection;
  if (!selection) return { focus, selected: null };
  if (selection.kind === "table") {
    const caption = clip(selection.caption, 60);
    const cells = selection.rows.reduce((sum, row) => sum + row.length, 0);
    return {
      focus,
      selected: {
        what: "table",
        label: caption ? words.table(caption) : words.tableUnnamed,
        content: `${caption ? `Caption: ${caption}\n` : ""}${markdownTable(selection.rows, TABLE_CELLS_MAX)}`,
        position: `page ${page}, ${selection.rows.length} rows, ${cells} cells`,
      },
    };
  }
  if (selection.kind === "image") {
    const name = clip(selection.alt || selection.name, 60);
    const dims = size(selection.width, selection.height);
    return {
      focus,
      selected: {
        what: "image",
        label: name ? words.image(name) : words.imageUnnamed,
        content: selection.alt ? `Alt text: ${clip(selection.alt, 300)}` : undefined,
        position: [`page ${page}`, dims].filter(Boolean).join(", "),
        imageAttached: true,
      },
    };
  }
  const text = selection.text.trim();
  if (!text) return { focus, selected: null };
  const paragraphs = text.split(/\n+/).filter((line) => line.trim()).length;
  const capped =
    text.length > SELECTED_TEXT_MAX ? `${text.slice(0, SELECTED_TEXT_MAX)}\n… (truncated)` : text;
  return {
    focus,
    selected: {
      what: paragraphs > 1 ? `${paragraphs} paragraphs` : "text",
      label: words.text(clip(text, 40)),
      content: capped,
      position: `page ${page}`,
    },
  };
}
