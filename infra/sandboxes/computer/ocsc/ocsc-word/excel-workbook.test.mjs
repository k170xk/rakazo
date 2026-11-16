import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { expandSharedFormulas, sanitizeWorkbookXml } from "./excel-workbook.mjs";

async function sheetXml(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  return zip.file("xl/worksheets/sheet1.xml").async("string");
}

test("a new workbook is saved without the page setup Excel repairs", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Schedule");
  sheet.getCell("A1").value = "Door";
  sheet.getCell("B1").value = 1;
  const raw = await book.xlsx.writeBuffer();
  const xml = await sheetXml(raw);
  assert.match(xml, /horizontalDpi="4294967295"/);
  assert.match(xml, /fitToWidth="1"/);

  const clean = await sanitizeWorkbookXml(raw);
  const next = await sheetXml(clean);
  assert.doesNotMatch(next, /horizontalDpi|verticalDpi|fitToWidth|fitToHeight/);
  assert.match(next, /<c r="A1" t="s">/);
  assert.match(next, /<pageSetup orientation="portrait" scale="100"\/>/);
});

test("shared formulas become ordinary formulas, including a cell ExcelJS would leave out of the range", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("UJIMA");
  sheet.getCell("A1").value = 1;
  sheet.getCell("A2").value = 2;
  sheet.getCell("A3").value = 3;
  sheet.getCell("B1").value = { formula: "A1+1", result: 2 };
  sheet.getCell("B2").value = { sharedFormula: "B1", result: 3 };
  sheet.getCell("B3").value = { formula: "A3+9", result: 12 };
  expandSharedFormulas(book);
  const bytes = await book.xlsx.writeBuffer();
  const xml = await sheetXml(bytes);
  assert.doesNotMatch(xml, /t="shared"/);
  assert.match(xml, /<f>A1\+1<\/f>/);
  assert.match(xml, /<f>A2\+1<\/f>/);
  assert.match(xml, /<f>A3\+9<\/f>/);
});

test("print areas become absolute and a printer-settings part keeps a content type", async () => {
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">&apos;UJIMA&apos;!$A1:$BD22</definedName></definedNames></workbook>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><pageSetup horizontalDpi="4294967295" verticalDpi="4294967295" scale="68" fitToWidth="1" fitToHeight="1"/></worksheet>`,
  );
  zip.file("xl/printerSettings/printerSettings1.bin", Buffer.from([1, 2, 3]));
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>`,
  );
  const clean = await sanitizeWorkbookXml(await zip.generateAsync({ type: "nodebuffer" }));
  const out = await JSZip.loadAsync(clean);
  const book = await out.file("xl/workbook.xml").async("string");
  const sheet = await out.file("xl/worksheets/sheet1.xml").async("string");
  const types = await out.file("[Content_Types].xml").async("string");
  assert.match(book, /\$A\$1:\$BD\$22/);
  assert.doesNotMatch(sheet, /Dpi=/);
  assert.match(sheet, /fitToWidth="1"/);
  assert.match(types, /Extension="bin"/);
});
