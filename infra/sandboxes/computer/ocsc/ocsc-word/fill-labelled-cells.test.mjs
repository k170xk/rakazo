import assert from "node:assert/strict";
import test from "node:test";
import {
  addTableRow,
  deleteTableRow,
  fillContentControls,
  fillLabelledTableCells,
  labelKey,
  setTableCell,
} from "./fill-labelled-cells.mjs";
import { xmlWellFormed } from "./ooxml-safe.mjs";

const form = `<w:document><w:body><w:tbl>
<w:tr>
  <w:tc><w:p><w:r><w:t>Applicant Name</w:t></w:r></w:p></w:tc>
  <w:tc><w:p><w:r><w:t></w:t></w:r></w:p></w:tc>
</w:tr>
<w:tr><w:trPr><w:trHeight w:val="340"/></w:trPr>
  <w:tc><w:p><w:r><w:t>Dates of employment at your company:</w:t></w:r></w:p></w:tc>
  <w:tc><w:p><w:pPr><w:rPr><w:rFonts w:ascii="Arial"/></w:rPr></w:pPr></w:p></w:tc>
</w:tr>
<w:tr><w:trPr><w:trHeight w:val="340"/></w:trPr>
  <w:tc><w:p><w:r><w:t>Referee’s Position:</w:t></w:r></w:p></w:tc>
  <w:tc><w:p></w:p></w:tc>
</w:tr>
<w:tr><w:trPr><w:trHeight w:val="300"/></w:trPr>
  <w:tc><w:p><w:r><w:t>Please tick</w:t></w:r></w:p></w:tc>
  <w:tc><w:p><w:r><w:t>Excellent</w:t></w:r></w:p></w:tc>
  <w:tc><w:p><w:r><w:t>Very Good</w:t></w:r></w:p></w:tc>
  <w:tc><w:p><w:r><w:t>Good</w:t></w:r></w:p></w:tc>
</w:tr>
<w:tr><w:trPr><w:trHeight w:val="300"/></w:trPr>
  <w:tc><w:p><w:r><w:t>Written and oral communication</w:t></w:r></w:p></w:tc>
  <w:tc><w:p></w:p></w:tc>
  <w:tc><w:p></w:p></w:tc>
  <w:tc><w:p></w:p></w:tc>
</w:tr>
<w:tr><w:trPr><w:trHeight w:val="300"/></w:trPr>
  <w:tc><w:p><w:r><w:t>Comments</w:t></w:r></w:p></w:tc>
  <w:tc><w:p></w:p></w:tc>
</w:tr>
<w:tr><w:trPr><w:trHeight w:val="300"/></w:trPr>
  <w:tc><w:p><w:r><w:t>Comments</w:t></w:r></w:p></w:tc>
  <w:tc><w:p><w:r><w:t> </w:t></w:r></w:p></w:tc>
</w:tr>
<w:tr>
  <w:tc><w:p><w:r><w:t>Already</w:t></w:r></w:p></w:tc>
  <w:tc><w:p><w:r><w:t>kept</w:t></w:r></w:p></w:tc>
</w:tr>
<w:tr><w:tc><w:p><w:r><w:t>Outer</w:t></w:r></w:p>
  <w:tbl><w:tr><w:trPr><w:trHeight w:val="200"/></w:trPr>
    <w:tc><w:p><w:r><w:t>Would you rehire?</w:t></w:r></w:p></w:tc>
    <w:tc><w:p><w:r><w:t></w:t></w:r></w:p></w:tc>
  </w:tr></w:tbl>
</w:tc></w:tr>
</w:tbl></w:body></w:document>`;

test("fills rows with w:trPr, ticks matching rating columns, handles curly apostrophes and nested tables", () => {
  assert.equal(labelKey("Referee’s Position:"), labelKey("Referee's Position"));
  const { xml, filled } = fillLabelledTableCells(form, {
    "Applicant Name": "Rory",
    "Dates of employment at your company:": "2020 - 2026",
    "Referee's Position": "Chief Technology Officer",
    "Written and oral communication": "Very Good",
    Comments: "First comment",
    Already: "replaced",
    "Would you rehire?": "Yes",
    Missing: "no row",
  });
  assert.deepEqual(filled, [
    "Applicant Name",
    "Dates of employment at your company:",
    "Referee's Position",
    "Written and oral communication",
    "Comments",
    "Would you rehire?",
  ]);
  assert.match(xml, /Applicant Name<\/w:t>[\s\S]*<w:t xml:space="preserve">Rory<\/w:t>/);
  assert.match(xml, /2020 - 2026<\/w:t>/);
  assert.match(xml, /<w:t xml:space="preserve">Chief Technology Officer<\/w:t>/);
  // "Very Good" ticks column 2 (second empty cell after label), leaving column 1 blank.
  assert.match(
    xml,
    /Written and oral communication<\/w:t><\/w:r><\/w:p><\/w:tc>\s*<w:tc><w:p><\/w:p><\/w:tc>\s*<w:tc><w:p><w:r><w:t xml:space="preserve">✓<\/w:t>/,
  );
  assert.match(xml, /<w:t xml:space="preserve">Yes<\/w:t>/);
  assert.match(xml, /<w:t>kept<\/w:t>/);
  assert.doesNotMatch(xml, /replaced/);
});

test("setTableCell updates duplicate labels by occurrence and overwrites existing cells by coordinates", () => {
  const r1 = setTableCell(form, {
    label: "Comments",
    occurrence: 2,
    text: "Second comment",
  });
  assert.equal(r1.updated, true);
  assert.match(r1.xml, /Second comment<\/w:t>/);

  const r2 = setTableCell(r1.xml, {
    table: 0,
    row: 7,
    column: 1,
    text: "overwritten",
  });
  assert.equal(r2.updated, true);
  assert.match(r2.xml, /overwritten<\/w:t>/);
  assert.doesNotMatch(r2.xml, />kept</);
});

test("fillContentControls fills text and checkbox content controls cleanly", () => {
  const doc = `<w:document><w:body>
    <w:sdt>
      <w:sdtPr><w:alias w:val="Project Title"/><w:tag w:val="project_title"/><w:showingPlcHdr/></w:sdtPr>
      <w:sdtContent><w:p><w:r><w:t>Click here to enter text.</w:t></w:r></w:p></w:sdtContent>
    </w:sdt>
    <w:sdt>
      <w:sdtPr><w:tag w:val="approved"/><w14:checkbox><w14:checked w14:val="0"/></w14:checkbox></w:sdtPr>
      <w:sdtContent><w:r><w:t>☐</w:t></w:r></w:sdtContent>
    </w:sdt>
  </w:body></w:document>`;
  const { xml, filled } = fillContentControls(doc, {
    "Project Title": "Dublin Metro",
    approved: "yes",
  });
  assert.deepEqual(filled, ["Project Title", "approved"]);
  assert.equal(xmlWellFormed(xml).ok, true);
  assert.ok(xml.includes("Dublin Metro"));
  assert.ok(!xml.includes("showingPlcHdr"));
  assert.ok(xml.includes('w14:val="1"'));
  assert.ok(xml.includes("☒"));
});

test("addTableRow and deleteTableRow preserve table structure and refuse deleting the last row", () => {
  const tbl = `<w:document><w:body><w:tbl>
    <w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cost</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:p><w:r><w:t>Steel</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>£100</w:t></w:r></w:p></w:tc></w:tr>
  </w:tbl></w:body></w:document>`;
  const added = addTableRow(tbl, { table: 0, cells: ["Concrete", "£250"] });
  assert.equal(added.updated, true);
  assert.equal(xmlWellFormed(added.xml).ok, true);
  assert.ok(added.xml.includes("Concrete") && added.xml.includes("£250"));

  const del1 = deleteTableRow(added.xml, { label: "Steel" });
  assert.equal(del1.updated, true);
  assert.ok(!del1.xml.includes("Steel"));
  assert.ok(del1.xml.includes("Concrete"));

  const del2 = deleteTableRow(del1.xml, { table: 0, row: 1 });
  assert.equal(del2.updated, true);
  const delLast = deleteTableRow(del2.xml, { table: 0, row: 0 });
  assert.equal(delLast.updated, false);
});
