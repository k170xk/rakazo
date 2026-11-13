// node --test docx-print.test.mjs (after npm install in this folder)
import assert from "node:assert/strict";
import { test } from "node:test";
import { alignFallbacks, anchorLeft, insetOf, placedStyle } from "./docx-fallback.mjs";
import { markPageFields, markSections, PAGE_MARK, SECTION_MARK } from "./docx-pages.mjs";

// A4 with the OCSC report's 1134-twip margins: 595.35 pt wide, 56.7 pt each side.
const A4 = { width: 11907 / 20, left: 56.7, right: 56.7 };
const anchor = (h, cx) =>
  `<wp:anchor><wp:positionH relativeFrom="${h.from}">${
    "offset" in h ? `<wp:posOffset>${h.offset}</wp:posOffset>` : `<wp:align>${h.align}</wp:align>`
  }</wp:positionH><wp:extent cx="${cx}" cy="100"/></wp:anchor>`;

test("places boxes as Word measures them", () => {
  // The banner title: 150604 EMU from the page edge.
  assert.equal(anchorLeft(anchor({ from: "page", offset: 150604 }, 5676900), A4), 150604 / 12700);
  // The back cover address: centred between the margins.
  const centred = anchorLeft(anchor({ from: "margin", align: "center" }, 2933700), A4);
  assert.ok(Math.abs(centred + 2933700 / 12700 / 2 - A4.width / 2) < 0.01);
  assert.equal(anchorLeft(anchor({ from: "margin", align: "left" }, 100), A4), 56.7);
  // Positions Word measures from a character or a column inside a table are left alone.
  assert.equal(anchorLeft(anchor({ from: "character", offset: 0 }, 100), A4), null);
});

test("rewrites only the horizontal part of a VML style", () => {
  const style =
    "position:absolute;margin-left:-60.15pt;margin-top:-31.05pt;width:447pt;mso-position-horizontal:absolute;mso-position-horizontal-relative:text";
  assert.equal(
    placedStyle(style, 11.858, { left: 7.2, right: 7.2 }),
    "position:absolute;margin-top:-31.05pt;width:447pt;left:11.86pt;margin-left:0;--ob-inset-l:7.2pt;--ob-inset-r:7.2pt",
  );
  assert.deepEqual(insetOf('<wps:bodyPr lIns="0" rIns="45720"/>'), { left: 0, right: 3.6 });
  assert.deepEqual(insetOf("<wps:bodyPr/>"), { left: 7.2, right: 7.2 });
});

test("moves a fallback shape to its DrawingML position and keeps the rest of the part", () => {
  const xml = `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>${anchor(
    { from: "page", offset: 127000 },
    1270000,
  )}<wps:bodyPr lIns="0" rIns="0"/></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape id="t" style="position:absolute;left:0;margin-left:-60pt;width:100pt"><v:textbox/></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p><w:p/>`;
  const out = alignFallbacks(xml, () => A4);
  assert.match(
    out,
    /style="position:absolute;width:100pt;left:10pt;margin-left:0;--ob-inset-l:0pt;--ob-inset-r:0pt"/,
  );
  assert.equal(out.replace(/style="[^"]*"/, ""), xml.replace(/style="[^"]*"/, ""));
  // Shapes in the flow of text, without position:absolute, are not moved.
  const inline = xml.replace("position:absolute;", "");
  assert.equal(
    alignFallbacks(inline, () => A4),
    inline,
  );
});

test("marks PAGE fields but not PAGEREF or NUMPAGES", () => {
  const field = (instr) =>
    `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const xml = `<w:p>${field("PAGE")}${field("NUMPAGES")}${field("PAGEREF _Toc1 \\h")}</w:p>`;
  const out = markPageFields(xml);
  assert.equal(out.split(PAGE_MARK).length - 1, 1);
  assert.ok(out.indexOf(PAGE_MARK) < out.indexOf("NUMPAGES"));
  assert.equal(
    markPageFields(
      '<w:fldSimple w:instr=" PAGE \\* MERGEFORMAT "><w:r><w:t>4</w:t></w:r></w:fldSimple>',
    ),
    `<w:fldSimple w:instr=" PAGE \\* MERGEFORMAT "><w:r><w:t>${PAGE_MARK}</w:t></w:r></w:fldSimple>`,
  );
});

test("bookmarks where each section starts and reads its numbering", () => {
  const body = `<w:document><w:body><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Cover</w:t></w:r></w:p><w:p><w:pPr><w:sectPr><w:pgNumType w:fmt="lowerRoman" w:start="0"/></w:sectPr></w:pPr></w:p><w:p><w:r><w:t>Notice</w:t></w:r></w:p><w:p><w:pPr><w:sectPr><w:pgNumType w:start="1"/></w:sectPr></w:pPr></w:p><w:p><w:r><w:t>Body</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`;
  const { xml, numbering } = markSections(body);
  assert.deepEqual(numbering, [
    { start: 0, format: "lowerRoman" },
    { start: 1, format: "decimal" },
    { start: null, format: "decimal" },
  ]);
  const at = (i) => xml.indexOf(`w:name="${SECTION_MARK}${i}"`);
  assert.ok(at(0) > xml.indexOf("</w:pPr>") && at(0) < xml.indexOf("Cover"));
  assert.ok(at(1) > xml.indexOf("lowerRoman") && at(1) < xml.indexOf("Notice"));
  assert.ok(at(2) > xml.indexOf('w:start="1"') && at(2) < xml.indexOf("Body"));
  assert.equal(xml.replace(/<w:bookmark(Start|End)\b[^>]*\/>/g, ""), body);
});
