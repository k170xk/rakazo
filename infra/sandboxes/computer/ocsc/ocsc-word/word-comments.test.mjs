import assert from "node:assert/strict";
import test from "node:test";
import {
  WordCommentStore,
  anchorCommentOnBlocks,
  anchorCommentOnParagraph,
  authorInitials,
  ensureCommentsPartsRegistered,
  extractComments,
} from "./word-comments.mjs";

test("authorInitials derives compact initials from full name", () => {
  assert.equal(authorInitials("Keith Knox"), "KK");
  assert.equal(authorInitials("OCSC Legal Team"), "OLT");
  assert.equal(authorInitials("Admin"), "AD");
});

test("WordCommentStore creates valid comments.xml and preserves existing counterparty comments", () => {
  const existing =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:comment w:id="4" w:author="Counterparty Solicitor" w:date="2026-11-20T10:00:00Z" w:initials="CS">' +
    "<w:p><w:r><w:t>Client requires uncapped indemnity.</w:t></w:r></w:p>" +
    "</w:comment></w:comments>";

  const store = new WordCommentStore(existing, {
    author: "Keith Knox",
    date: "2026-11-23T14:00:00Z",
  });
  const id = store.add("OCSC Clause Library (Liability Cap): Cap liability at 2x fee or PI limit.\nLine 2 rationale.");
  assert.equal(id, 5);
  assert.equal(store.addedCount, 1);

  const parsed = extractComments(store.xml);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].id, "4");
  assert.equal(parsed[0].author, "Counterparty Solicitor");
  assert.equal(parsed[1].id, "5");
  assert.equal(parsed[1].author, "Keith Knox");
  assert.equal(parsed[1].initials, "KK");
  assert.match(parsed[1].text, /Liability Cap/);
  assert.match(parsed[1].text, /Line 2 rationale/);
});

test("anchorCommentOnParagraph places range start after pPr and end+reference before </w:p>", () => {
  const para =
    '<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:del w:id="1"><w:r><w:delText>unlimited</w:delText></w:r></w:del><w:ins w:id="2"><w:r><w:t>capped at fee</w:t></w:r></w:ins></w:p>';
  const anchored = anchorCommentOnParagraph(para, 3);
  assert.ok(anchored.includes('</w:pPr><w:commentRangeStart w:id="3"/><w:del'));
  assert.ok(
    anchored.includes(
      '</w:ins><w:commentRangeEnd w:id="3"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="3"/></w:r></w:p>',
    ),
  );
});

test("anchorCommentOnBlocks spans multiple paragraphs cleanly", () => {
  const blocks =
    "<w:p><w:r><w:t>Clause 8.1</w:t></w:r></w:p><w:p><w:r><w:t>Liability shall not exceed fees.</w:t></w:r></w:p>";
  const anchored = anchorCommentOnBlocks(blocks, 7);
  assert.ok(anchored.startsWith('<w:p><w:commentRangeStart w:id="7"/><w:r><w:t>Clause 8.1'));
  assert.ok(anchored.endsWith('<w:commentReference w:id="7"/></w:r></w:p>'));
});

test("ensureCommentsPartsRegistered registers content type and relationship once", () => {
  const types = '<Types><Default Extension="xml" ContentType="application/xml"/></Types>';
  const rels = '<Relationships><Relationship Id="rId1" Type="foo" Target="bar.xml"/></Relationships>';
  const once = ensureCommentsPartsRegistered({ types, rels, nextRelId: () => "rId2" });
  assert.match(once.types, /PartName="\/word\/comments\.xml"/);
  assert.match(once.rels, /Id="rId2"[^>]*Target="comments\.xml"/);

  const twice = ensureCommentsPartsRegistered({
    types: once.types,
    rels: once.rels,
    nextRelId: () => "rId3",
  });
  assert.equal(twice.types, once.types);
  assert.equal(twice.rels, once.rels);
});
