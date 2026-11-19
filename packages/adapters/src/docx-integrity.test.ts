import { describe, expect, it } from "vitest";
import {
  BOXED_DOCUMENT_XML,
  DAMAGED_DOCUMENT_XML,
  damagedDocx,
  soundDocx,
  zipOf,
} from "./docx.test-support.js";
import { brokenWordParts, xmlTagsBalanced } from "./docx-integrity.js";

describe("xmlTagsBalanced", () => {
  it("accepts well-formed Word XML with comments, declarations and quoted >", () => {
    const xml = `${BOXED_DOCUMENT_XML.replace("<w:body>", '<w:body><w:sectPr w:rsid="a>b"/>')}<!-- <w:p> --><![CDATA[</w:p>]]>`;
    expect(xmlTagsBalanced(xml)).toBe(true);
  });

  it("refuses a text box whose opening was dropped", () => {
    expect(xmlTagsBalanced(DAMAGED_DOCUMENT_XML)).toBe(false);
  });

  it("refuses unclosed, mis-nested and truncated XML", () => {
    expect(xmlTagsBalanced("<a><b></a></b>")).toBe(false);
    expect(xmlTagsBalanced("<a><b/>")).toBe(false);
    expect(xmlTagsBalanced('<a b="x')).toBe(false);
    expect(xmlTagsBalanced("")).toBe(false);
  });
});

describe("brokenWordParts", () => {
  it("is empty for a sound document with headers and footers", () => {
    const docx = zipOf({
      "[Content_Types].xml": "<Types/>",
      "word/document.xml": BOXED_DOCUMENT_XML,
      "word/header1.xml": "<w:hdr><w:p/></w:hdr>",
      "word/footer2.xml": "<w:ftr><w:p/></w:ftr>",
    });
    expect(brokenWordParts(docx)).toEqual([]);
    expect(brokenWordParts(soundDocx())).toEqual([]);
  });

  it("names each damaged part", () => {
    const docx = zipOf({
      "word/document.xml": DAMAGED_DOCUMENT_XML,
      "word/footer1.xml": "<w:ftr><w:p></w:ftr>",
    });
    expect(brokenWordParts(docx)).toEqual(["word/document.xml", "word/footer1.xml"]);
    expect(brokenWordParts(damagedDocx())).toEqual(["word/document.xml"]);
  });

  it("does not flag files it cannot read", () => {
    expect(brokenWordParts(new Uint8Array([1, 2, 3]))).toEqual([]);
    expect(brokenWordParts(zipOf({ "a.txt": "<" }))).toEqual([]);
  });
});
