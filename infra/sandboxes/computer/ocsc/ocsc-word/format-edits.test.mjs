import assert from "node:assert/strict";
import { test } from "node:test";
import { addCharts, restoreOfficeParts } from "./excel-workbook.mjs";
import {
  applyExcelFormat,
  applyWordPageSetup,
  applyWordRunStyle,
  colourHex,
  fillPptxSlide,
  formatPptxParagraph,
  formatPptxShape,
  formatWordDocument,
  formatWordParagraph,
  placePptxShape,
} from "./format-edits.mjs";

test("names the OCSC green and a short hex", () => {
  assert.equal(colourHex("green"), "76BF43");
  assert.equal(colourHex("#abc"), "AABBCC");
  assert.equal(colourHex("not a colour"), null);
});

test("colours one word in a Word paragraph and leaves the rest", () => {
  const paragraph =
    '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr><w:t>Change the colour here</w:t></w:r></w:p>';
  const { paragraph: next, count } = formatWordParagraph(paragraph, "colour", { color: "green" });
  assert.equal(count, 1);
  assert.match(next, /<w:t[^>]*>Change the <\/w:t>/);
  assert.match(next, /<w:color w:val="76BF43"\/>/);
  assert.match(next, /<w:t[^>]*>colour<\/w:t>/);
  assert.match(next, /<w:t[^>]*> here<\/w:t>/);
  assert.match(next, /w:ascii="Calibri"/);
});

test("shades a Word cell whose text is the whole find", () => {
  const xml =
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Header</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const { xml: next, count } = formatWordDocument(xml, "Header", { fill: "#76BF43", bold: true });
  assert.equal(count, 1);
  assert.match(next, /<w:b\/>/);
  assert.match(next, /<w:tcPr><w:shd[^>]*w:fill="76BF43"\/>/);
});

test("keeps an existing Word bold tag when adding a colour", () => {
  assert.match(applyWordRunStyle("<w:rPr><w:b/></w:rPr>", { color: "red" }), /<w:b\/><w:color w:val="C00000"\/>/);
});

test("colours one PowerPoint word and fills a shape", () => {
  const paragraph = '<a:p><a:r><a:rPr lang="en-GB" sz="1800"/><a:t>Make this green</a:t></a:r></a:p>';
  const coloured = formatPptxParagraph(paragraph, "green", { color: "brand", bold: true });
  assert.equal(coloured.count, 1);
  assert.match(coloured.paragraph, /<a:srgbClr val="76BF43"\/>/);
  assert.match(coloured.paragraph, /b="1"/);
  assert.match(coloured.paragraph, /<a:t>Make this <\/a:t>/);

  const shape =
    '<p:sp><p:nvSpPr><p:cNvPr id="4" name="Card"/></p:nvSpPr><p:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Card</a:t></a:r></a:p></p:txBody></p:sp>';
  const filled = formatPptxShape(shape, 4, { fill: "green", color: "white" });
  assert.equal(filled.found, true);
  assert.match(filled.xml, /<a:prstGeom prst="rect"><a:avLst\/><\/a:prstGeom><a:solidFill><a:srgbClr val="76BF43"\/>/);
  assert.match(filled.xml, /<a:srgbClr val="FFFFFF"\/>/);
});

test("sets a Word font, line spacing and page margins", () => {
  const paragraph = "<w:p><w:r><w:t>Body text</w:t></w:r></w:p>";
  const styled = formatWordParagraph(paragraph, "Body", { font: "Arial", spacing: "1.5", indent: 1 });
  assert.equal(styled.count, 1);
  assert.match(styled.paragraph, /w:ascii="Arial"/);
  assert.match(styled.paragraph, /w:line="360"/);
  assert.match(styled.paragraph, /w:left="567"/);
  const page = applyWordPageSetup("<w:body><w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/></w:sectPr></w:body>", {
    margin: 2,
    orientation: "landscape",
  });
  assert.match(page, /w:top="1134"/);
  assert.match(page, /w:orient="landscape"/);
  assert.match(page, /w:w="16838"/);
});

test("moves a PowerPoint shape and fills the slide", () => {
  const shape =
    '<p:sp><p:nvSpPr><p:cNvPr id="4" name="Card"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr></p:sp>';
  const moved = placePptxShape(shape, 4, { x: 1, y: 2 });
  assert.equal(moved.found, true);
  assert.match(moved.xml, /<a:off x="360000" y="720000"\/>/);
  const slide = fillPptxSlide('<p:cSld><p:spTree></p:spTree></p:cSld>', "navy");
  assert.match(slide, /<p:bg>[\s\S]*val="0D1B2A"/);
});

test("formats an Excel cell without clearing its value", () => {
  const cell = { value: 12, font: { name: "Calibri" }, alignment: { vertical: "middle" } };
  applyExcelFormat(cell, { color: "red", fill: "yellow", bold: true, align: "centre" });
  assert.equal(cell.value, 12);
  assert.equal(cell.font.color.argb, "FFC00000");
  assert.equal(cell.font.bold, true);
  assert.equal(cell.font.name, "Calibri");
  assert.equal(cell.fill.fgColor.argb, "FFFFC000");
  assert.equal(cell.alignment.horizontal, "center");
  assert.equal(cell.alignment.vertical, "middle");
  applyExcelFormat(cell, { font: "Arial", wrap: true });
  assert.equal(cell.font.name, "Arial");
  assert.equal(cell.alignment.wrapText, true);
});

test("keeps a chart when a workbook is saved again and can add one", async () => {
  const original = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`;
  const book = `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Costs" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const sheet = `<?xml version="1.0"?><worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData></sheetData><drawing r:id="rId1"/></worksheet>`;
  const sheetRels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`;
  const { default: JSZip } = await import("jszip");
  const src = new JSZip();
  src.file("[Content_Types].xml", original);
  src.file("xl/workbook.xml", book);
  src.file("xl/_rels/workbook.xml.rels", rels);
  src.file("xl/worksheets/sheet1.xml", sheet);
  src.file("xl/worksheets/_rels/sheet1.xml.rels", sheetRels);
  src.file("xl/drawings/drawing1.xml", "<xdr:wsDr></xdr:wsDr>");
  src.file(
    "xl/drawings/_rels/drawing1.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>`,
  );
  src.file("xl/charts/chart1.xml", "<c:chartSpace></c:chartSpace>");
  const saved = new JSZip();
  saved.file("[Content_Types].xml", original.replace(/<Override PartName="\/xl\/charts[\s\S]*<Override PartName="\/xl\/drawings[^/]*\/>/, ""));
  saved.file("xl/workbook.xml", book);
  saved.file("xl/_rels/workbook.xml.rels", rels);
  saved.file("xl/worksheets/sheet1.xml", sheet.replace("<drawing r:id=\"rId1\"/>", ""));
  saved.file("xl/worksheets/_rels/sheet1.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);
  const restored = await restoreOfficeParts(await src.generateAsync({ type: "nodebuffer" }), await saved.generateAsync({ type: "nodebuffer" }));
  const back = await JSZip.loadAsync(restored.buffer);
  assert.ok(back.file("xl/charts/chart1.xml"));
  assert.match(await back.file("xl/worksheets/sheet1.xml").async("string"), /<drawing /);
  const withChart = await addCharts(restored.buffer, [{ sheet: "Costs", type: "column", range: "A1:B4", title: "Costs" }]);
  const next = await JSZip.loadAsync(withChart);
  assert.match(Object.keys(next.files).join(" "), /xl\/charts\/chart2\.xml/);
});
