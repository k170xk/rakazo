import { zipEntry } from "./word-edit-match.js";

const PART_MAX_BYTES = 64 * 1024 * 1024;
const NUMBERED_PARTS = 20;

const WORD_TEXT_PARTS = [
  "word/document.xml",
  "word/footnotes.xml",
  "word/endnotes.xml",
  ...Array.from({ length: NUMBERED_PARTS }, (_, i) => `word/header${i + 1}.xml`),
  ...Array.from({ length: NUMBERED_PARTS }, (_, i) => `word/footer${i + 1}.xml`),
];

export const DAMAGED_WORD_OUTPUT =
  "The saved Word file is damaged: its XML no longer nests correctly, so Word would report unreadable content. This usually comes from changing wording in a paragraph that holds a text box or shape. Nothing from this edit was kept and the file must not be attached. Run the edit again on the same --in file, leaving wording in or beside text boxes and shapes unchanged, or replace those whole paragraphs with replace_paragraphs.";

export const DAMAGED_WORD_INPUT =
  "The Word file this edit started from (--in) is already damaged, so Word reports unreadable content and every edit of it stays damaged. Nothing from this edit was kept and the file must not be attached. Start again from an earlier version that opens correctly, or make the document afresh with new.";

export const DAMAGED_WORD_ATTACHMENT =
  "This Word file is damaged (its XML does not nest correctly), so Word would report unreadable content; it was not attached. Make the edit again from a version that opens correctly, then attach that file.";

/**
 * Whether every element in `xml` closes in the order it opened. Comments, processing
 * instructions, CDATA and declarations are skipped; `>` inside quoted attribute values is allowed.
 */
export function xmlTagsBalanced(xml: string): boolean {
  const open: string[] = [];
  let elements = 0;
  let at = xml.indexOf("<");
  while (at !== -1) {
    const skipTo = (marker: string, from: number) => {
      const end = xml.indexOf(marker, from);
      return end < 0 ? -1 : end + marker.length;
    };
    let next: number;
    if (xml.startsWith("<!--", at)) next = skipTo("-->", at + 4);
    else if (xml.startsWith("<![CDATA[", at)) next = skipTo("]]>", at + 9);
    else if (xml.startsWith("<?", at)) next = skipTo("?>", at + 2);
    else if (xml.startsWith("<!", at)) next = skipTo(">", at + 2);
    else {
      let end = at + 1;
      let quote = "";
      for (; end < xml.length; end += 1) {
        const ch = xml[end];
        if (quote) {
          if (ch === quote) quote = "";
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === ">") break;
      }
      if (end >= xml.length) return false;
      const closing = xml[at + 1] === "/";
      const name = /^[^\s/>]+/.exec(xml.slice(closing ? at + 2 : at + 1, end))?.[0];
      if (!name) return false;
      if (closing) {
        if (open.pop() !== name) return false;
      } else if (xml[end - 1] !== "/") {
        open.push(name);
        elements += 1;
      } else {
        elements += 1;
      }
      next = end + 1;
    }
    if (next < 0) return false;
    at = xml.indexOf("<", next);
  }
  return open.length === 0 && elements > 0;
}

/**
 * The text parts of a .docx whose elements do not nest, which Word reports as unreadable content.
 * Parts that are missing or cannot be read here are not counted, so this never flags a file it
 * does not understand.
 */
export function brokenWordParts(docx: Uint8Array): string[] {
  const broken: string[] = [];
  for (const name of WORD_TEXT_PARTS) {
    let part: Uint8Array | null;
    try {
      part = zipEntry(docx, name, PART_MAX_BYTES);
    } catch {
      continue;
    }
    if (!part) continue;
    if (!xmlTagsBalanced(new TextDecoder().decode(part))) broken.push(name);
  }
  return broken;
}
