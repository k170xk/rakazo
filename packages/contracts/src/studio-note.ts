import { whiteboardSelectionNote } from "./whiteboard.js";

const OPEN = "‹studio›";
const CLOSE = "‹/studio›";

/** The document studios, with the name the person sees and the `ocsc` program that edits each. */
const DOCUMENT_STUDIOS = {
  word: { studio: "Word studio", program: "word", extension: ".docx" },
  slides: { studio: "Presentation studio", program: "pptx", extension: ".pptx" },
  sheet: { studio: "Excel studio", program: "xlsx", extension: ".xlsx" },
  pdf: { studio: "Evolve PDF Studio", program: "pdf", extension: ".pdf" },
} as const;

const DOCUMENT_EXTENSION = /\.(docx|pptx|xlsx|pdf)$/i;

export type DocumentStudioKind = keyof typeof DOCUMENT_STUDIOS;

/** Where the person is in an open document, and what is on screen there. */
export type DocumentStudioFocus = {
  /** For the assistant: "page 3 of 12", "slide 4 of 9", "sheet Budget, A1:H32 visible". */
  where: string;
  /** For the chip: "Page 3", "Slide 4", "Budget". */
  short?: string;
  /** What is on screen there: headings and a text excerpt, or a slide's title, text and notes. */
  detail?: string;
};

/** What the person has selected in an open document. */
export type DocumentStudioSelected = {
  /** What it is, for the instruction: "text", "table", "image", "text box", "cell range". */
  what: string;
  /** For the chip: "Table: BIM essentials", "Title", "Sheet1!B2:D9 (24 cells)". */
  label: string;
  /** The selected content: its text, a markdown table, or cells with values and formulas. */
  content?: string;
  /** Where it sits and how big it is, when that helps. */
  position?: string;
  /** A picture of it is attached to the message. */
  imageAttached?: boolean;
};

/** The context chip a sent message shows for the open document. */
export type StudioNoteChip = { kind: DocumentStudioKind; title: string; label: string };

/** One line without the block's own markers, so no title or selection can end the block early. */
function oneLine(value: string | undefined): string {
  return (value ?? "").replace(/[‹›]/g, "").replace(/\s+/g, " ").trim();
}

/** Several lines without the block's own markers, capped with a note that the rest is left out. */
function block(value: string | undefined, max: number): string {
  const clean = (value ?? "")
    .replace(/[‹›]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}\n… (truncated)` : clean;
}

const SELECTION_NOTE_MAX = 500;
const FOCUS_DETAIL_MAX = 1500;
const SELECTED_CONTENT_MAX = 6000;
const CHIP_PREFIX = "Chip: ";

/** The chip's short label: where they are, then what is selected. */
export function documentChipLabel(
  focus: DocumentStudioFocus | undefined,
  selected: DocumentStudioSelected | null | undefined,
): string {
  const short = oneLine(focus?.short);
  const label = oneLine(selected?.label);
  if (!label) return short;
  if (!short || label.startsWith(short)) return label;
  return `${short} · ${label}`;
}

function documentStudioLine(input: {
  kind: DocumentStudioKind;
  title: string;
  documentId: string;
  artifactId: string;
  version?: number;
  selection?: string;
  focus?: DocumentStudioFocus;
  selected?: DocumentStudioSelected | null;
}): string {
  const { studio, program, extension } = DOCUMENT_STUDIOS[input.kind];
  const path = `attachments/${input.artifactId}${extension}`;
  const named = input.title ? ` with "${input.title}" open` : "";
  const version = input.version ? `latest version ${input.version}, ` : "";
  if (input.kind === "pdf") return pdfStudioLine(input, { studio, path, named, version });
  const lines = [
    `The person is in the ${studio}${named} (documentId ${input.documentId}, ${version}artifactId ${input.artifactId}). This is the document they are looking at right now, including any edits they made by hand since the last reply. When they ask for a change, edit THIS version with ocsc ${program} edit --in ${path}; call fetch_file with ${path} first if it is not on your computer. Always use this message's artifactId — never reuse an older attachment from earlier in the chat. fetch_file always reaches this file, even when another agent made it, so never ask them to attach or export it. Attach the result with attach_file under the same name${input.title ? `, "${input.title}"` : ""}, so it becomes the next version. Do not create a new document unless they ask.`,
  ];
  const where = oneLine(input.focus?.where);
  if (where) lines.push(`They are looking at ${where}.`);
  const detail = block(input.focus?.detail, FOCUS_DETAIL_MAX);
  if (detail) lines.push(`On screen there:\n${detail}`);
  const selected = input.selected;
  const what = oneLine(selected?.what);
  if (selected && what) {
    const at = oneLine(selected.position);
    const content = block(selected.content, SELECTED_CONTENT_MAX);
    lines.push(`Selected: the ${what}${at ? ` (${at})` : ""}${content ? `:\n${content}` : "."}`);
    if (selected.imageAttached)
      lines.push(`A picture of the selected ${what} is attached to this message.`);
    if (what === "image") {
      if (input.kind === "word") {
        lines.push(
          `To replace that picture in place, edit with {"op":"replace_image","picture":"<its Word name from the selection, for example Picture 1002>","image":"<https URL or path>"}. Do not refuse: ocsc-word can replace an existing embedded image.`,
        );
      } else if (input.kind === "slides") {
        lines.push(
          `To replace that picture in place, edit with {"op":"replace_image","slide":<slide number>,"picture":<picture number>,"image":"<https URL or path>"}.`,
        );
      }
    }
    lines.push(
      `Their message is about the selected ${what}. Change only that part, in the newest version (${input.version ? `version ${input.version}, ` : ""}artifactId ${input.artifactId}), and leave the rest of the document as it is unless they ask for more.`,
    );
  } else {
    const selection = oneLine(input.selection).slice(0, SELECTION_NOTE_MAX);
    if (selection) lines.push(`Selected in the document: ${JSON.stringify(selection)}`);
  }
  lines.push(
    `Formatting changes are supported. Do not say colour, font, spacing, margins, freeze, filter or a chart is unsupported. Word: {"op":"format_text","find":"<exact words>","color":"green","font":"Calibri","spacing":"1.5"} and {"op":"page_setup","margin":2.5,"paper":"A4","orientation":"landscape"}. PowerPoint: format_text with "slide", {"op":"format_shape","slide":<n>,"shape":<n>,"fill":"green"}, {"op":"place_shape","slide":<n>,"shape":<n>,"x":2,"y":3,"w":10,"h":4} in centimetres, and {"op":"slide_background","slide":<n>,"fill":"navy"}. Excel: {"op":"format_cells","sheet":"<sheet>","range":"<cells>","fill":"green","color":"white","font":"Calibri"}, {"op":"freeze","sheet":"<sheet>","rows":1}, {"op":"filter","sheet":"<sheet>","range":"A1:D20"}, {"op":"conditional_format","sheet":"<sheet>","range":"C2:C20","rule":"greater","value":1000,"fill":"green"} and {"op":"chart","sheet":"<sheet>","type":"column","range":"A1:B6","title":"..."}. "color" is the words and "fill" is the background. Green means OCSC green #76BF43. Existing Excel charts, pivot tables and macros are kept; a new pivot table or a new macro cannot be written.`,
  );
  lines.push(chipLine(input, selected));
  return lines.join("\n");
}

function chipLine(
  input: { kind: DocumentStudioKind; title: string; focus?: DocumentStudioFocus },
  selected: DocumentStudioSelected | null | undefined,
): string {
  const chip: StudioNoteChip = {
    kind: input.kind,
    title: input.title.replace(DOCUMENT_EXTENSION, ""),
    label: documentChipLabel(input.focus, selected),
  };
  return `${CHIP_PREFIX}${JSON.stringify(chip)}`;
}

/** A PDF is marked up on the assistant's computer in the same app, then attached as the next version. */
function pdfStudioLine(
  input: Parameters<typeof documentStudioLine>[0],
  parts: { studio: string; path: string; named: string; version: string },
): string {
  const { studio, path, named, version } = parts;
  const name = input.title.replace(DOCUMENT_EXTENSION, "") || "document";
  const lines = [
    `The person is in ${studio}${named} (documentId ${input.documentId}, ${version}artifactId ${input.artifactId}). This is the PDF they are looking at right now, including any markups they saved by hand. To read it, run ocsc-pdf read --in ${path}. When they ask for markups, comments, redlines, checks, measurements or any other change, follow the skill /ocsc-pdf-markup on your computer: call fetch_file with ${path} first if it is not there, open it with ocsc-pdf-studio open ${path} --out "outputs/${name}.pdf", make the changes, run ocsc-pdf-studio save, then attach the saved file with attach_file under the same name${input.title ? `, "${input.title}"` : ""}, so it becomes the next version in their studio. Always use this message's artifactId — never reuse an older attachment from earlier in the chat. fetch_file always reaches this file, even when another agent made it, so never ask them to attach or export it. Do not create a new document unless they ask.`,
  ];
  const where = oneLine(input.focus?.where);
  if (where) lines.push(`They are looking at ${where}.`);
  const detail = block(input.focus?.detail, FOCUS_DETAIL_MAX);
  if (detail) lines.push(`On screen there:\n${detail}`);
  const selected = input.selected;
  const what = oneLine(selected?.what);
  if (selected && what) {
    const content = block(selected.content, SELECTED_CONTENT_MAX);
    lines.push(`Selected: the ${what}${content ? `:\n${content}` : "."}`);
    if (selected.imageAttached)
      lines.push(`A picture of the selected ${what} and the drawing around it is attached to this message.`);
    lines.push(
      `Their message is about the selected ${what}. Change only that, and leave the rest of the PDF as it is unless they ask for more. A markup's id stays the same in the saved file, so use it with get_annotation, update_annotation, delete_annotation and comment_thread after you open the PDF.`,
    );
  }
  if (where || selected)
    lines.push(
      "Positions here are app points: PDF points (1/72 inch) from the top-left corner of the page at 100% zoom, y downward, the same units as every ocsc-pdf-studio tool. ocsc-pdf-studio call context gives the same view from your computer.",
    );
  lines.push(chipLine(input, selected));
  return lines.join("\n");
}

/**
 * What the model reads about the studio in front of the person. The chat hides this block;
 * the page chip stays the visible tag.
 */
export function openStudioNote(
  input:
    | {
        kind: "whiteboard" | "app" | "todo";
        title?: string;
        id?: string;
        blank?: boolean;
        selection?: Parameters<typeof whiteboardSelectionNote>[0];
      }
    | {
        kind: DocumentStudioKind;
        title?: string;
        /** The file family's root artifact id. */
        documentId: string;
        /** The newest version's artifact id. */
        artifactId: string;
        version?: number;
        /** Selected paragraph text, "slide 3", or a range such as "Sheet1!B2:D5". */
        selection?: string;
        /** Where they are and what is on screen. */
        focus?: DocumentStudioFocus;
        /** The selection with its content; replaces `selection` when given. */
        selected?: DocumentStudioSelected | null;
      },
): string {
  const title = oneLine(input.title);
  if ("documentId" in input) {
    const line = documentStudioLine({
      kind: input.kind,
      title,
      documentId: input.documentId.trim(),
      artifactId: input.artifactId.trim(),
      version: input.version,
      selection: input.selection,
      focus: input.focus,
      selected: input.selected,
    });
    return `${OPEN}\n${line}\n${CLOSE}`;
  }
  const id = (input.id ?? "").trim();
  const named = title && id ? ` with "${title}" open` : "";
  let line: string;
  if (input.kind === "whiteboard") {
    const which = id ? `${named} (whiteboardId ${id})` : named;
    line = input.blank
      ? `The person is in the Whiteboard studio${which}. The canvas is blank. When they ask for something to be drawn, draw it on this whiteboard. Do not create a new one unless they ask.`
      : `The person is in the Whiteboard studio${which}. This is the whiteboard they are looking at. When they ask for a change, make it on this whiteboard. Do not create a new one unless they ask.`;
  } else if (input.kind === "todo") {
    const which = id ? `${named} (todoListId ${id})` : named;
    line = input.blank
      ? `The person is in the To-do studio${which}. The board is empty. When they ask to add tasks, including from a document, a spreadsheet or their email, add them to this list with todo_add. Pass list_id ${id || "personal"}. Do not start another list unless they ask.`
      : `The person is in the To-do studio${which}. This is the to-do list they are looking at. When they ask to add, move, update or remove tasks, do it on this list with todo_list, todo_add, todo_update and todo_archive. Pass list_id ${id || "personal"}. Do not start another list unless they ask.`;
  } else if (input.blank || !id) {
    line =
      "The person is in the App Studio. No app is open and the canvas is blank. When they ask for an app, build it here.";
  } else {
    const which = id ? `${named} (appId ${id})` : named;
    line = `The person is in the App Studio${which}. This is the app they are looking at. When they ask for a change, make it on this app. Do not build a new one unless they ask.`;
  }
  const selection = input.selection?.length ? whiteboardSelectionNote(input.selection) : "";
  const body = selection ? `${line}\n${selection}` : line;
  return `${OPEN}\n${body}\n${CLOSE}`;
}

/** The document chip a message's studio block names, or null when it names none. */
export function studioNoteChip(text: string): StudioNoteChip | null {
  const found = /‹studio›([\s\S]*?)‹\/studio›/.exec(text);
  if (!found) return null;
  const line = found[1]!.split("\n").find((row) => row.startsWith(CHIP_PREFIX));
  if (!line) return null;
  try {
    const value: unknown = JSON.parse(line.slice(CHIP_PREFIX.length));
    if (!value || typeof value !== "object") return null;
    const { kind, title, label } = value as Record<string, unknown>;
    if (typeof kind !== "string" || !(kind in DOCUMENT_STUDIOS)) return null;
    if (typeof title !== "string" || typeof label !== "string") return null;
    return { kind: kind as DocumentStudioKind, title, label };
  } catch {
    return null;
  }
}

/**
 * The document a message's studio block says is open: its family root and the version the
 * studio showed. Null when the block names no document.
 */
export function studioNoteDocument(
  text: string,
): { documentId: string; artifactId: string } | null {
  const found = /‹studio›([\s\S]*?)‹\/studio›/.exec(text);
  const ids = found && /\(documentId ([\w-]+),[^)]*?artifactId ([\w-]+)\)/.exec(found[1]!);
  return ids ? { documentId: ids[1]!, artifactId: ids[2]! } : null;
}

/** The studio block, removed wherever a person reads the message. */
export function stripStudioNote(text: string): string {
  return text.replace(/\n*‹studio›[\s\S]*?‹\/studio›/g, "").replace(/\n{3,}/g, "\n\n");
}
