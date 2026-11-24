import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const CLI = new URL("./ocsc-extract.mjs", import.meta.url).pathname;

// Minimal valid 2x2 red PNG
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVR4nGP4z8DAwMAAAA8AAf4i7J8AAAAASUVORK5CYII=",
  "base64",
);

function makeZip(outPath, entries) {
  const script = `
import json, sys, zipfile, base64
out_path, payload = sys.argv[1], json.loads(sys.argv[2])
with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
    for name, val in payload.items():
        if isinstance(val, dict) and "b64" in val:
            zf.writestr(name, base64.b64decode(val["b64"]))
        else:
            zf.writestr(name, val.encode("utf-8"))
`;
  const res = spawnSync("python3", ["-c", script, outPath, JSON.stringify(entries)], {
    encoding: "utf8",
  });
  assert.equal(res.status, 0, res.stderr);
}

function runCli(workspace, args) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: workspace,
    env: { ...process.env, WORKSPACE_DIR: workspace },
    encoding: "utf8",
  });
  return { status: res.status, json: JSON.parse(res.stdout), stderr: res.stderr };
}

test("ocsc-extract all extracts docx, pptx, csv, and safely rejects zip-slip", () => {
  const ws = mkdtempSync(join(tmpdir(), "ocsc-extract-test-"));
  try {
    const att = join(ws, "attachments");
    mkdirSync(att, { recursive: true });

    // 1. Minimal .docx with heading, paragraph, table, and embedded PNG
    makeZip(join(att, "Site-Report.docx"), {
      "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Site Inspection</w:t></w:r></w:p>
    <w:p><w:r><w:t>Bridge abutment shows minor spalling.</w:t></w:r></w:p>
    <w:p><w:r><w:drawing><wp:docPr id="1" name="Abutment Photo" descr="North abutment"/><a:graphic><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></w:drawing></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>Element</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Condition</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>Pier 1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Good</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
  </w:body>
</w:document>`,
      "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/photo1.png"/>
</Relationships>`,
      "word/media/photo1.png": { b64: TINY_PNG.toString("base64") },
    });

    // 2. Minimal .pptx with slide title, notes, table, and embedded PNG
    makeZip(join(att, "Client-Deck.pptx"), {
      "ppt/slides/slide1.xml": `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Overview Slide</a:t></a:r></a:p></p:txBody></p:sp>
    <p:pic><p:nvPicPr><p:cNvPr id="2" name="Site Map" descr="Site location"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic>
  </p:spTree></p:cSld>
</p:sld>`,
      "ppt/slides/_rels/slide1.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/map.png"/>
</Relationships>`,
      "ppt/media/map.png": { b64: TINY_PNG.toString("base64") },
    });

    // 3. CSV file
    writeFileSync(join(att, "Costs.csv"), "Item,Cost\nSteel,1200\nConcrete,800\n", "utf8");

    // 4. ZIP with a safe file and a zip-slip attempt
    makeZip(join(att, "Bundle.zip"), {
      "notes.txt": "Included note",
      "../../evil.txt": "should be rejected",
    });

    const { status, json } = runCli(ws, ["all", "--out", "work/extracted"]);
    assert.equal(status, 0);
    assert.equal(json.ok, true);
    assert.equal(json.filesProcessed, 4);
    assert.ok(existsSync(join(ws, json.manifest)));

    const docx = json.files.find((f) => f.type === "word");
    assert.equal(docx.headings[0], "Site Inspection");
    assert.equal(docx.tables.length, 1);
    assert.equal(docx.images.length, 1);
    assert.equal(docx.images[0].section, "Site Inspection");
    assert.equal(docx.images[0].width, 2);
    assert.equal(docx.images[0].height, 2);
    assert.ok(existsSync(join(ws, docx.images[0].path)));
    assert.match(readFileSync(join(ws, docx.tables[0].csv), "utf8"), /Pier 1,Good/);

    const pptx = json.files.find((f) => f.type === "pptx");
    assert.equal(pptx.slidesCount, 1);
    assert.equal(pptx.slideTitles[0], "Overview Slide");
    assert.equal(pptx.images.length, 1);
    assert.deepEqual(pptx.images[0].slides, [1]);
    assert.ok(existsSync(join(ws, pptx.images[0].path)));

    const csv = json.files.find((f) => f.type === "csv");
    assert.equal(csv.rows, 2);
    assert.deepEqual(csv.headers, ["Item", "Cost"]);

    const zip = json.files.find((f) => f.type === "zip");
    assert.equal(zip.unpackedFiles.length, 1);
    assert.ok(zip.skipped.some((s) => s.includes("evil.txt")));
    assert.equal(existsSync(join(ws, "evil.txt")), false);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("ocsc-extract rejects paths outside the workspace", () => {
  const ws = mkdtempSync(join(tmpdir(), "ocsc-extract-escape-"));
  try {
    const { status, json } = runCli(ws, ["inspect", "--in", "/etc/passwd"]);
    assert.equal(status, 1);
    assert.equal(json.ok, false);
    assert.match(json.error, /inside the workspace/i);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
