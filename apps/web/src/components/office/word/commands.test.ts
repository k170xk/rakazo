import { createDocx, repackDocx } from "@stll/folio-core/docx/rezip";
import { TextSelection } from "@stll/folio-core/prosemirror";
import { fromProseDoc, toProseDoc } from "@stll/folio-core/prosemirror/conversion";
import { parseDocx } from "@stll/folio-core/server";
import type { Document } from "@stll/folio-core/types/document";
import { createEmptyDocument } from "@stll/folio-core/utils/createDocument";
import { EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { describe, expect, it } from "vitest";
import {
  applyParagraphStyle,
  insertLink,
  normalizeLink,
  resolveChangeAtCursor,
  runWordAction,
} from "./commands";

type Editing = { view: EditorView; parsed: Document };

/** A one-paragraph document in the editor model, with a stand-in for the editor view. */
async function editing(text: string): Promise<Editing> {
  const parsed = await parseDocx(await createDocx(createEmptyDocument()));
  const doc = toProseDoc(parsed, {
    styles: parsed.package?.styles,
    numbering: parsed.package?.numbering,
    theme: parsed.package?.theme ?? null,
  });
  let state = EditorState.create({ doc, schema: doc.type.schema });
  const view = {
    get state() {
      return state;
    },
    dispatch(tr: Parameters<EditorView["dispatch"]>[0]) {
      state = state.apply(tr);
    },
    focus() {},
  } as unknown as EditorView;
  view.dispatch(state.tr.insertText(text, 1));
  return { view, parsed };
}

function select(view: EditorView, from: number, to: number) {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
}

/** Saves the edited model as a .docx and opens it again, as the studio's save does. */
async function reopen({ view, parsed }: Editing): Promise<Document> {
  const rebuilt = fromProseDoc(view.state.doc, parsed, { stylesheetSource: { type: "package" } });
  return parseDocx(await repackDocx(rebuilt));
}

function firstParagraph(doc: Document) {
  const block = doc.package.document?.content[0];
  if (block?.type !== "paragraph") throw new Error("no paragraph");
  return block;
}

function firstRun(doc: Document) {
  const run = firstParagraph(doc).content.find((item) => item.type === "run");
  if (run?.type !== "run") throw new Error("no run");
  return run;
}

describe("Word ribbon commands", () => {
  it("keeps character formatting through a save", async () => {
    const doc = await editing("Hello world");
    select(doc.view, 1, 6);
    for (const action of ["bold", "italic", "underline", "strikethrough"] as const) {
      expect(runWordAction(doc.view, action)).toBe(true);
    }
    expect(runWordAction(doc.view, { type: "fontSize", points: 14 })).toBe(true);
    expect(runWordAction(doc.view, { type: "fontFamily", value: "Georgia" })).toBe(true);
    expect(runWordAction(doc.view, { type: "textColor", hex: "#c00000" })).toBe(true);
    expect(runWordAction(doc.view, { type: "highlight", name: "yellow" })).toBe(true);
    const run = firstRun(await reopen(doc));
    expect(run.formatting).toMatchObject({
      bold: true,
      italic: true,
      strike: true,
      fontSize: 28,
      highlight: "yellow",
      color: { rgb: "C00000" },
      fontFamily: { ascii: "Georgia" },
    });
    expect(run.formatting?.underline).toBeTruthy();
  });

  it("clears formatting, colour and highlight", async () => {
    const doc = await editing("Hello world");
    select(doc.view, 1, 6);
    runWordAction(doc.view, "bold");
    runWordAction(doc.view, { type: "highlight", name: "green" });
    runWordAction(doc.view, { type: "textColor", hex: "#FF0000" });
    expect(runWordAction(doc.view, "clearHighlight")).toBe(true);
    expect(runWordAction(doc.view, "clearTextColor")).toBe(true);
    expect(runWordAction(doc.view, "clearFormatting")).toBe(true);
    const run = firstRun(await reopen(doc));
    expect(run.formatting?.bold).not.toBe(true);
    expect(run.formatting?.highlight).toBeUndefined();
    expect(run.formatting?.color).toBeUndefined();
  });

  it("keeps paragraph formatting, lists and styles through a save", async () => {
    const doc = await editing("Heading text");
    select(doc.view, 2, 2);
    expect(applyParagraphStyle(doc.view, doc.parsed, "Heading1")).toBe(true);
    expect(runWordAction(doc.view, { type: "align", value: "center" })).toBe(true);
    expect(runWordAction(doc.view, { type: "lineSpacing", twips: 360 })).toBe(true);
    expect(runWordAction(doc.view, "numberedList")).toBe(true);
    const paragraph = firstParagraph(await reopen(doc));
    expect(paragraph.formatting).toMatchObject({
      styleId: "Heading1",
      alignment: "center",
      lineSpacing: 360,
    });
    expect(paragraph.formatting?.numPr).toBeTruthy();
  });

  it("indents and outdents a plain paragraph", async () => {
    const doc = await editing("Indented");
    select(doc.view, 2, 2);
    expect(runWordAction(doc.view, "indent")).toBe(true);
    expect(firstParagraph(await reopen(doc)).formatting?.indentLeft).toBeGreaterThan(0);
    expect(runWordAction(doc.view, "outdent")).toBe(true);
    expect(firstParagraph(await reopen(doc)).formatting?.indentLeft ?? 0).toBe(0);
  });

  it("links the selection and saves the link", async () => {
    const doc = await editing("Visit OCSC today");
    select(doc.view, 7, 11);
    expect(insertLink(doc.view, "https://ocsc.ie")).toBe(true);
    const saved = JSON.stringify(firstParagraph(await reopen(doc)));
    expect(saved).toContain("https://ocsc.ie");
  });

  it("reports when there is no tracked change at the cursor", async () => {
    const doc = await editing("No changes here");
    select(doc.view, 3, 3);
    expect(resolveChangeAtCursor(doc.view, true)).toBe(false);
  });

  it("adds a scheme to typed links", () => {
    expect(normalizeLink(" ocsc.ie ")).toBe("https://ocsc.ie");
    expect(normalizeLink("http://a.b")).toBe("http://a.b");
    expect(normalizeLink("info@ocsc.ie")).toBe("mailto:info@ocsc.ie");
    expect(normalizeLink("   ")).toBeNull();
  });
});
