import test from "node:test";
import assert from "node:assert/strict";
import { assertXmlValid, findSmartMatches, topLevelElements, xmlWellFormed } from "./ooxml-safe.mjs";

test("findSmartMatches matches literal text first and falls back to smart quotes, dashes and NBSP", () => {
  const exact = findSmartMatches("Hello world, hello world", "world");
  assert.deepEqual(exact, [
    { start: 6, end: 11 },
    { start: 19, end: 24 },
  ]);

  const smart = "What were the candidate\u2019s duties \u2013 and\u00a0responsibilities?";
  const hits = findSmartMatches(smart, "candidate's duties - and responsibilities");
  assert.equal(hits.length, 1);
  assert.equal(
    smart.slice(hits[0].start, hits[0].end),
    "candidate\u2019s duties \u2013 and\u00a0responsibilities",
  );
});

test("xmlWellFormed catches mismatched tags, bare ampersands, control chars and accepts valid OOXML", () => {
  assert.equal(xmlWellFormed('<w:doc><w:p><w:t>O&apos;Connor &amp; Co</w:t></w:p></w:doc>').ok, true);
  assert.equal(xmlWellFormed('<w:doc><w:p><w:t>O&Connor</w:t></w:p></w:doc>').ok, false);
  assert.equal(xmlWellFormed('<w:doc><w:p><w:t>Broken</w:p></w:t></w:doc>').ok, false);
  assert.equal(xmlWellFormed('<w:doc><w:t>\u0007bell</w:t></w:doc>').ok, false);
  assert.throws(() => assertXmlValid('<a/><b', "slide1.xml"), /slide1\.xml/);
});

test("topLevelElements extracts nested elements without cutting at inner close tags", () => {
  const xml = "<root><tbl id='1'><tr id='a'><tc><tbl id='inner'><tr id='b'/></tbl></tc></tr></tbl><tbl id='2'/></root>";
  const tbls = topLevelElements(xml, "tbl");
  assert.equal(tbls.length, 2);
  assert.ok(tbls[0].xml.includes("id='inner'"));
  assert.equal(tbls[1].xml, "<tbl id='2'/>");
});
