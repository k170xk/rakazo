import test from "node:test";
import assert from "node:assert/strict";
import { replaceWordParagraph } from "./word-replace.mjs";
import { xmlWellFormed } from "./ooxml-safe.mjs";
import { mapParagraphs } from "./word-paragraphs.mjs";

function fakeRev() {
  let id = 100;
  return { attrs: () => `w:id="${id++}" w:author="Test" w:date="2026-11-26T00:00:00Z"` };
}

test("replaceWordParagraph splices across split runs while keeping untouched inline formatting", () => {
  const p =
    '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Intro </w:t></w:r>' +
    '<w:r><w:t xml:space="preserve">the candi</w:t></w:r>' +
    '<w:r><w:t xml:space="preserve">date\u2019s role </w:t></w:r>' +
    '<w:r><w:rPr><w:i/></w:rPr><w:t>at OCSC</w:t></w:r></w:p>';

  // Clean replacement with plain ASCII apostrophe matching curly apostrophe across 2 runs
  const clean = replaceWordParagraph(p, "candidate's role", "engineer's duties", { all: true, rev: null });
  assert.equal(clean.count, 1);
  assert.equal(xmlWellFormed(clean.paragraph).ok, true);
  assert.ok(clean.paragraph.includes("<w:b/>"), "bold intro run kept");
  assert.ok(clean.paragraph.includes("<w:i/>"), "italic tail run kept");
  assert.ok(clean.paragraph.includes("engineer's duties"));
  assert.ok(!clean.paragraph.includes("candi"));

  // Tracked replacement only strikes the matched span, NOT the whole paragraph
  const tracked = replaceWordParagraph(p, "candidate's role", "engineer's duties", { all: true, rev: fakeRev() });
  assert.equal(tracked.count, 1);
  assert.equal(xmlWellFormed(tracked.paragraph).ok, true);
  assert.ok(tracked.paragraph.includes("<w:del "));
  assert.ok(tracked.paragraph.includes("<w:ins "));
  assert.ok(tracked.paragraph.includes("<w:r><w:rPr><w:b/></w:rPr><w:t>Intro </w:t></w:r>"), "untouched bold run stays outside w:del");
  assert.ok(tracked.paragraph.includes("<w:r><w:rPr><w:i/></w:rPr><w:t>at OCSC</w:t></w:r>"), "untouched italic run stays outside w:del");
});

test("replaceWordParagraph preserves text boxes and drawings without dropping ocscbox markers", () => {
  const xml =
    '<w:body><w:p><w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>Box Label</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r>' +
    '<w:r><w:t>Main body old phrase</w:t></w:r></w:p></w:body>';
  let hits = 0;
  const out = mapParagraphs(xml, (p) => {
    const res = replaceWordParagraph(p, "old phrase", "new phrase", { all: true, rev: null });
    hits += res.count;
    return res.paragraph;
  });
  assert.equal(hits, 1);
  assert.equal(xmlWellFormed(out).ok, true);
  assert.ok(out.includes("Main body new phrase"));
  assert.ok(out.includes("Box Label"), "text box content preserved");
});
