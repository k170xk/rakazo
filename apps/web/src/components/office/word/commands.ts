import {
  alignCenter,
  alignJustify,
  alignLeft,
  alignRight,
  applyStyle,
  clearFormatting,
  clearHighlight,
  clearTextColor,
  createStyleResolver,
  decreaseIndent,
  decreaseListLevel,
  increaseIndent,
  increaseListLevel,
  insertHyperlink,
  removeHyperlink,
  setFontFamily,
  setFontSize,
  setHighlight,
  setHyperlink,
  setLineSpacing,
  setTextColor,
  TextSelection,
  toggleBold,
  toggleBulletList,
  toggleItalic,
  toggleNumberedList,
  toggleStrike,
  toggleUnderline,
} from "@stll/folio-core/prosemirror";
import {
  acceptAllChanges,
  acceptChange,
  findChangeAtPosition,
  findNextChange,
  findPreviousChange,
  rejectAllChanges,
  rejectChange,
} from "@stll/folio-core/prosemirror/commands/comments";
import {
  executeEditorCommand,
  executeFirstEditorCommand,
} from "@stll/folio-core/prosemirror/executeEditorCommand";
import type { Document } from "@stll/folio-core/types/document";
import type { Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

/** Built-in paragraph styles the Styles menu offers, by their OOXML style id. */
export const PARAGRAPH_STYLES = [
  "Normal",
  "Title",
  "Heading1",
  "Heading2",
  "Heading3",
  "Quote",
] as const;
export type ParagraphStyleId = (typeof PARAGRAPH_STYLES)[number];

export const FONT_FAMILIES: readonly string[] = [
  "Aptos",
  "Arial",
  "Calibri",
  "Cambria",
  "Courier New",
  "Georgia",
  "Segoe UI",
  "Tahoma",
  "Times New Roman",
  "Verdana",
];

/** Line spacing as Word stores it: 240 twips is single spacing. */
export const LINE_SPACINGS: readonly { value: number; label: string }[] = [
  { value: 240, label: "1.0" },
  { value: 276, label: "1.15" },
  { value: 360, label: "1.5" },
  { value: 480, label: "2.0" },
  { value: 600, label: "2.5" },
  { value: 720, label: "3.0" },
];

/** The highlight colours a Word file can store, with how they look. */
export const HIGHLIGHTS: readonly { name: string; hex: string }[] = [
  { name: "yellow", hex: "#FFFF00" },
  { name: "green", hex: "#00FF00" },
  { name: "cyan", hex: "#00FFFF" },
  { name: "magenta", hex: "#FF00FF" },
  { name: "blue", hex: "#0000FF" },
  { name: "red", hex: "#FF0000" },
  { name: "darkBlue", hex: "#000080" },
  { name: "darkCyan", hex: "#008080" },
  { name: "darkGreen", hex: "#008000" },
  { name: "darkMagenta", hex: "#800080" },
  { name: "darkRed", hex: "#800000" },
  { name: "darkYellow", hex: "#808000" },
  { name: "darkGray", hex: "#808080" },
  { name: "lightGray", hex: "#C0C0C0" },
  { name: "black", hex: "#000000" },
];

export type Alignment = "left" | "center" | "right" | "both";

const ALIGN: Record<Alignment, Command> = {
  left: alignLeft,
  center: alignCenter,
  right: alignRight,
  both: alignJustify,
};

export type WordAction =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "clearFormatting"
  | "bulletList"
  | "numberedList"
  | "indent"
  | "outdent"
  | "clearTextColor"
  | "clearHighlight"
  | "removeLink"
  | { type: "align"; value: Alignment }
  | { type: "fontFamily"; value: string }
  | { type: "fontSize"; points: number }
  | { type: "textColor"; hex: string }
  | { type: "highlight"; name: string }
  | { type: "lineSpacing"; twips: number };

/** Runs one formatting action on the selection; false when it did not apply. */
export function runWordAction(view: EditorView, action: WordAction): boolean {
  const run = (command: Command) => executeEditorCommand(view, command);
  if (typeof action === "string") {
    switch (action) {
      case "bold":
        return run(toggleBold);
      case "italic":
        return run(toggleItalic);
      case "underline":
        return run(toggleUnderline);
      case "strikethrough":
        return run(toggleStrike);
      case "clearFormatting":
        return run(clearFormatting);
      case "bulletList":
        return run(toggleBulletList);
      case "numberedList":
        return run(toggleNumberedList);
      case "indent":
        return executeFirstEditorCommand(view, [increaseListLevel, increaseIndent()]);
      case "outdent":
        return executeFirstEditorCommand(view, [decreaseListLevel, decreaseIndent()]);
      case "clearTextColor":
        return run(clearTextColor);
      case "clearHighlight":
        return run(clearHighlight);
      case "removeLink":
        return run(removeHyperlink);
    }
  }
  switch (action.type) {
    case "align":
      return run(ALIGN[action.value]);
    case "fontFamily":
      return run(setFontFamily(action.value));
    case "fontSize":
      // Word stores sizes in half points.
      return run(setFontSize(Math.round(action.points * 2)));
    case "textColor":
      return run(setTextColor({ rgb: action.hex.replace(/^#/, "").toUpperCase() }));
    case "highlight":
      return run(setHighlight(action.name));
    case "lineSpacing":
      return run(setLineSpacing(action.twips));
  }
}

/** Applies a paragraph style, resolved against the document's own style definitions. */
export function applyParagraphStyle(
  view: EditorView,
  doc: Document | null,
  styleId: string,
): boolean {
  const styles = doc?.package.styles;
  if (!styles) return executeEditorCommand(view, applyStyle(styleId));
  const resolver = createStyleResolver(styles);
  const resolved = resolver.resolveParagraphStyle(styleId);
  const name = resolver.getStyle(styleId)?.name;
  return executeEditorCommand(
    view,
    applyStyle(styleId, {
      ...(resolved.paragraphFormatting
        ? { paragraphFormatting: resolved.paragraphFormatting }
        : {}),
      ...(resolved.runFormatting ? { runFormatting: resolved.runFormatting } : {}),
      ...(name ? { styleName: name } : {}),
    }),
  );
}

/** A web address as typed, with https:// added when it has no scheme; null when it is empty. */
export function normalizeLink(text: string): string | null {
  const href = text.trim();
  if (!href) return null;
  if (/^(https?:|mailto:|tel:|#)/i.test(href)) return href;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(href)) return `mailto:${href}`;
  return `https://${href}`;
}

/** Links the selected words, or inserts the address as a link where the cursor is. */
export function insertLink(view: EditorView, href: string): boolean {
  const { from, to } = view.state.selection;
  if (from === to) return executeEditorCommand(view, insertHyperlink(href, href));
  return executeEditorCommand(view, setHyperlink(href));
}

/** Selects a tracked change and scrolls it into view. */
function selectChange(
  view: EditorView,
  change: { from: number; to: number } | null,
  scrollTo: (pos: number) => void,
): boolean {
  if (!change) return false;
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, change.from, change.to)),
  );
  view.focus();
  requestAnimationFrame(() => scrollTo(change.from));
  return true;
}

export function nextChange(view: EditorView, scrollTo: (pos: number) => void): boolean {
  return selectChange(view, findNextChange(view.state, view.state.selection.to), scrollTo);
}

export function previousChange(view: EditorView, scrollTo: (pos: number) => void): boolean {
  return selectChange(view, findPreviousChange(view.state, view.state.selection.from), scrollTo);
}

/** Accepts or rejects the tracked change at the cursor; false when there is none. */
export function resolveChangeAtCursor(view: EditorView, accept: boolean): boolean {
  const { from, to } = view.state.selection;
  const range = findChangeAtPosition(view.state, from, to);
  if (range.from === range.to) return false;
  const command = accept ? acceptChange(range.from, range.to) : rejectChange(range.from, range.to);
  return command(view.state, view.dispatch);
}

export function resolveAllChanges(view: EditorView, accept: boolean): boolean {
  const command = accept ? acceptAllChanges() : rejectAllChanges();
  return command(view.state, view.dispatch);
}
