import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { applyEdits, readDeck } from "./pptx-package.mjs";
import { xmlWellFormed } from "./ooxml-safe.mjs";

async function makeSlideDeck(slideXml) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`,
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000"/>
</p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`,
  );
  zip.file("ppt/slides/slide1.xml", slideXml);
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

test("pptx handles attributed a:p / a:r / a:t tags, smart quotes, set_text and table ops cleanly", async () => {
  const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
      <p:spPr/>
      <p:txBody><a:bodyPr/><a:lstStyle/>
        <a:p lang="en-GB"><a:r dirty="0"><a:rPr lang="en-GB" b="1"/><a:t xml:space="preserve">Client\u2019s Design Review</a:t></a:r></a:p>
      </p:txBody>
    </p:sp>
    <p:sp>
      <p:nvSpPr><p:cNvPr id="3" name="Body 2"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr/>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p lang="en-GB"><a:r><a:t>Old body</a:t></a:r></a:p></p:txBody>
    </p:sp>
    <p:graphicFrame>
      <p:nvGraphicFramePr><p:cNvPr id="4" name="Table 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
        <a:tbl>
          <a:tr h="370840">
            <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Discipline</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
            <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Fee</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
          </a:tr>
          <a:tr h="370840">
            <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Structural</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
            <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody><a:tcPr/></a:tc>
          </a:tr>
        </a:tbl>
      </a:graphicData></a:graphic>
    </p:graphicFrame>
  </p:spTree></p:cSld>
</p:sld>`;

  const bytes = await makeSlideDeck(slideXml);
  const edited = await applyEdits(
    bytes,
    [
      { op: "replace_text", slide: 1, find: "Client's Design Review", replace: "OCSC Stage 3 Review" },
      { op: "set_text", slide: 1, shape: 3, bullets: ["Point A", "Point B"] },
      { op: "set_table_cell", slide: 1, label: "Structural", text: "£45,000" },
      { op: "add_table_row", slide: 1, cells: ["Civil", "£30,000"] },
      { op: "format_text", slide: 1, find: "OCSC Stage 3", bold: true, color: "green" },
    ],
    { clean: true, replacementImages: new Map() },
  );

  const deck = await readDeck(edited.bytes);
  assert.equal(deck.slides[0].title, "OCSC Stage 3 Review");
  assert.equal(deck.slides[0].texts.find((t) => t.shape === 3)?.text, "Point A\nPoint B");
  assert.deepEqual(deck.slides[0].tables[0], [
    ["Discipline", "Fee"],
    ["Structural", "£45,000"],
    ["Civil", "£30,000"],
  ]);

  // Verify delete_table_row by label and by index, and XML well-formedness
  const deletedByLabel = await applyEdits(
    edited.bytes,
    [{ op: "delete_table_row", slide: 1, label: "Structural" }],
    { clean: true, replacementImages: new Map() },
  );
  const deckLabel = await readDeck(deletedByLabel.bytes);
  assert.deepEqual(deckLabel.slides[0].tables[0], [
    ["Discipline", "Fee"],
    ["Civil", "£30,000"],
  ]);

  const deleted = await applyEdits(
    edited.bytes,
    [{ op: "delete_table_row", slide: 1, row: 1 }],
    { clean: true, replacementImages: new Map() },
  );
  const deck2 = await readDeck(deleted.bytes);
  assert.deepEqual(deck2.slides[0].tables[0], [
    ["Discipline", "Fee"],
    ["Civil", "£30,000"],
  ]);

  const zip = await JSZip.loadAsync(deleted.bytes);
  assert.equal(xmlWellFormed(await zip.file("ppt/slides/slide1.xml").async("string")).ok, true);
});
