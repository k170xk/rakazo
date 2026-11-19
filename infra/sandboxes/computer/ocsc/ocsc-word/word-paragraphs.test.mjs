import assert from "node:assert/strict";
import { test } from "node:test";
import { applyWordRunStyle, formatWordDocument } from "./format-edits.mjs";
import { firstElement, firstRunProps, mapParagraphs, xmlTagsBalanced } from "./word-paragraphs.mjs";

const BOX =
  '<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:txbx><w:txbxContent><w:p><w:r><w:t>Box words</w:t></w:r></w:p></w:txbxContent></wps:txbx></w:drawing></mc:Choice><mc:Fallback><w:pict><v:textbox><w:txbxContent><w:p><w:r><w:t>Box words</w:t></w:r></w:p></w:txbxContent></v:textbox></w:pict></mc:Fallback></mc:AlternateContent></w:r>';
const BOXED = `<w:body><w:p><w:r><w:t>Lead in</w:t></w:r>${BOX}<w:r><w:t>tail words</w:t></w:r></w:p></w:body>`;
const TRACKED_RUN =
  '<w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:rPrChange w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:rPr><w:b/></w:rPr></w:rPrChange></w:rPr><w:t>Change the colour</w:t></w:r>';

const texts = (xml) => [...xml.matchAll(/<w:t>([^<]*)<\/w:t>/g)].map((m) => m[1]);
const dropRuns = (p) =>
  p.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (r) => (r.includes("<w:t>") ? "" : r));

test("edits XML without text boxes exactly as replace does", () => {
  const xml =
    "<w:body><w:p><w:r><w:t>One</w:t></w:r></w:p><w:p/><w:p><w:r><w:t>Two</w:t></w:r></w:p></w:body>";
  const edit = (p) => p.replace("<w:t>", "<w:t>x");
  assert.equal(
    mapParagraphs(xml, edit),
    xml.replace(/<w:p(?=[\s>])[^>]*(?<!\/)>[\s\S]*?<\/w:p>/g, edit),
  );
});

test("sees a paragraph holding a text box whole and keeps the box when its text runs are rewritten", () => {
  const seen = [];
  const next = mapParagraphs(BOXED, (p) => {
    seen.push(texts(p));
    return dropRuns(p);
  });
  assert.deepEqual(seen, [["Box words"], ["Box words"], ["Lead in", "tail words"]]);
  assert.ok(xmlTagsBalanced(next));
  assert.equal((next.match(/<w:txbxContent>/g) ?? []).length, 2);
});

test("keeps a paragraph as it was when an edit drops its text box", () => {
  const next = mapParagraphs(BOXED, (p) => (p.includes("Lead in") ? "<w:p/>" : p));
  assert.equal(next, BOXED);
});

test("formats wording beside and inside a text box without breaking it", () => {
  for (const find of ["tail words", "Box words", "Lead in"]) {
    const { xml, count } = formatWordDocument(BOXED, find, { bold: true });
    assert.ok(count > 0, find);
    assert.ok(xmlTagsBalanced(xml), find);
    assert.equal((xml.match(/<w:txbxContent>/g) ?? []).length, 2, find);
  }
});

test("formats runs carrying a tracked formatting change without breaking them", () => {
  const { xml, count } = formatWordDocument(
    `<w:body><w:p>${TRACKED_RUN}</w:p></w:body>`,
    "colour",
    {
      color: "green",
    },
  );
  assert.equal(count, 1);
  assert.ok(xmlTagsBalanced(xml));
  assert.match(
    xml,
    /<w:rFonts w:ascii="Arial"\/><w:color w:val="76BF43"\/><w:rPrChange [^>]*><w:rPr><w:b\/><\/w:rPr><\/w:rPrChange><\/w:rPr>/,
  );
  assert.equal(
    applyWordRunStyle("<w:rPr><w:rPrChange><w:rPr><w:b/></w:rPr></w:rPrChange></w:rPr>", {
      bold: true,
    }),
    "<w:rPr><w:b/><w:rPrChange><w:rPr><w:b/></w:rPr></w:rPrChange></w:rPr>",
  );
});

test("reads an element through its own close, matching the plain pattern when nothing nests", () => {
  assert.equal(
    firstElement(TRACKED_RUN, "rPr"),
    '<w:rPr><w:rFonts w:ascii="Arial"/><w:rPrChange w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:rPr><w:b/></w:rPr></w:rPrChange></w:rPr>',
  );
  const plain =
    '<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>x</w:t></w:r></w:p>';
  assert.equal(firstElement(plain, "pPr"), /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(plain)[0]);
  assert.equal(firstRunProps(plain), "<w:rPr><w:i/></w:rPr>");
  assert.equal(firstElement("<w:p><w:rPr/></w:p>", "rPr"), "");
  assert.equal(firstElement("<w:rPr><w:b/>", "rPr"), "");
});

test("tells balanced XML from XML with dropped or crossed tags", () => {
  assert.ok(
    xmlTagsBalanced(
      `<?xml version="1.0"?><w:document a="x>y">${BOXED}<!-- </w:p> --></w:document>`,
    ),
  );
  assert.ok(!xmlTagsBalanced(BOXED.replace("<w:txbxContent>", "")));
  assert.ok(!xmlTagsBalanced("<a><b></a></b>"));
  assert.ok(!xmlTagsBalanced(""));
});
