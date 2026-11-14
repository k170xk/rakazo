// Round-trips real OCSC documents through the studio engines and compares `ocsc read` before and
// after. Needs the runner scripts' own packages: `npm ci` in infra/sandboxes/computer/ocsc/ocsc-word.
// Run from the repo root: node apps/web/scripts/office-fidelity/run.mjs [--keep]
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ocsc = path.resolve(here, "../../../../infra/sandboxes/computer/ocsc/ocsc-word");
const JSZip = createRequire(path.join(ocsc, "package.json"))("jszip");
const keep = process.argv.includes("--keep");
const workspace = mkdtempSync(path.join(tmpdir(), "office-fidelity-"));
mkdirSync(path.join(workspace, "work"));
mkdirSync(path.join(workspace, "outputs"));
copyFileSync(
  path.join(ocsc, "templates/ocsc-offices-map.png"),
  path.join(workspace, "work/visual.png"),
);

const env = {
  ...process.env,
  WORKSPACE_DIR: workspace,
  OCSC_PPTX_TEMPLATE: path.join(ocsc, "templates/ocsc-company.pptx"),
};

function run(tool, ...args) {
  const out = execFileSync("node", [path.join(ocsc, `${tool}.mjs`), ...args], {
    cwd: workspace,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const json = JSON.parse(out);
  if (!json.ok) throw new Error(`${tool} ${args.join(" ")}: ${json.error}`);
  return json;
}

function spec(name, body) {
  writeFileSync(path.join(workspace, "work", name), JSON.stringify(body));
  return `work/${name}`;
}

const file = (rel) => path.join(workspace, rel);
const bytes = (rel) => new Uint8Array(readFileSync(file(rel)));
const save = (rel, data) =>
  writeFileSync(file(rel), data instanceof ArrayBuffer ? new Uint8Array(data) : data);

/** `ocsc read` output without the fields that name the file itself. */
function readOf(tool, rel) {
  const { path: _path, file: _file, ...rest } = run(tool, "read", "--in", rel);
  return rest;
}

/** Leaf-level differences between two JSON values, as `path: before -> after`. */
function diff(a, b, at = "") {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((key) => diff(a[key], b[key], `${at}/${key}`));
  }
  const show = (v) => (v === undefined ? "(missing)" : JSON.stringify(v).slice(0, 140));
  return [`${at}: ${show(a)} -> ${show(b)}`];
}

/** Zip parts that disappeared, appeared or changed. */
async function parts(beforeRel, afterRel) {
  const [a, b] = await Promise.all([
    JSZip.loadAsync(readFileSync(file(beforeRel))),
    JSZip.loadAsync(readFileSync(file(afterRel))),
  ]);
  const names = (zip) => Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const before = new Set(names(a));
  const after = new Set(names(b));
  const changed = [];
  const elements = {};
  for (const name of before) {
    if (!after.has(name)) continue;
    const [x, y] = await Promise.all([
      a.file(name).async("uint8array"),
      b.file(name).async("uint8array"),
    ]);
    if (Buffer.compare(Buffer.from(x), Buffer.from(y)) === 0) continue;
    changed.push(name);
    if (!/\.xml$/.test(name) || /^docProps\//.test(name)) continue;
    const counts = (data) => {
      const map = {};
      for (const [, tag] of Buffer.from(data)
        .toString("utf8")
        .matchAll(/<([a-zA-Z0-9]+:[a-zA-Z0-9]+)[\s/>]/g)) {
        map[tag] = (map[tag] ?? 0) + 1;
      }
      return map;
    };
    const [cx, cy] = [counts(x), counts(y)];
    const moved = [...new Set([...Object.keys(cx), ...Object.keys(cy)])]
      .filter((tag) => (cx[tag] ?? 0) !== (cy[tag] ?? 0))
      .map((tag) => `${tag} ${cx[tag] ?? 0}->${cy[tag] ?? 0}`);
    if (moved.length) elements[name] = moved;
  }
  return {
    lost: [...before].filter((n) => !after.has(n)),
    added: [...after].filter((n) => !before.has(n)),
    changed,
    elements,
  };
}

const issues = (list) =>
  list.map((issue) =>
    `${issue.level ?? issue.severity}: ${issue.code} ${issue.message}`.slice(0, 200),
  );

async function attempt(label, work) {
  try {
    return await work();
  } catch (error) {
    return {
      label,
      crashed: String(error?.stack ?? error)
        .split("\n")
        .slice(0, 4)
        .join(" | "),
    };
  }
}

async function compare(label, tool, source, out, expected = "none") {
  const before = readOf(tool, source);
  const after = readOf(tool, out);
  return {
    label,
    expected,
    readDiff: diff(before, after),
    parts: await parts(source, out),
  };
}

/** The assistant keeps editing after a studio save, so its edit must still work on our output. */
function agentEdits(tool, rel, edits) {
  try {
    const out = rel.replace(/(\.\w+)$/, "-agent$1");
    run(
      tool,
      "edit",
      "--in",
      rel,
      "--spec",
      spec(`${path.basename(out)}.json`, { edits }),
      "--out",
      out,
    );
    return "ok";
  } catch (error) {
    return `failed: ${String(error.message).slice(0, 300)}`;
  }
}

const report = {};

// ---------- Word ----------
run(
  "ocsc-word",
  "new",
  "--out",
  "outputs/Report.docx",
  "--spec",
  spec("doc.json", {
    title: "Flood Risk Assessment",
    office: "Dublin",
    fields: {
      project_number: "HEL18",
      project_name: "HEL 18 Design and Build",
      client_name: "Dublin City Council",
      author: "Test Author",
    },
    blocks: [
      { type: "heading", level: 1, text: "Introduction" },
      { type: "paragraph", text: "Plain text with **bold** and *italic* words." },
      { type: "bullets", items: ["Point one", { text: "Sub-point", level: 1 }] },
      { type: "numbered", items: ["Step one", "Step two"] },
      {
        type: "table",
        header: ["Item", "Owner"],
        rows: [
          ["Survey", "Civil"],
          ["Model", "Water"],
        ],
        caption: "Table 1: Programme",
      },
      { type: "heading", level: 2, text: "Scope" },
      { type: "paragraph", text: "The scope covers the site." },
      { type: "pagebreak" },
      { type: "heading", level: 1, text: "Conclusions" },
      { type: "paragraph", text: "Flood risk is low." },
    ],
  }),
);
// A tracked change from the assistant, the way the studio will usually receive Word files.
run(
  "ocsc-word",
  "edit",
  "--in",
  "outputs/Report.docx",
  "--out",
  "outputs/Report-tracked.docx",
  "--spec",
  spec("doc-edits.json", {
    edits: [{ op: "replace_text", find: "Flood risk is low.", replace: "Flood risk is very low." }],
  }),
);

{
  const docx = await import("@office-kit/docx");
  const word = { source: "outputs/Report-tracked.docx" };
  word.validateSource = issues(docx.validate(docx.openDocx(bytes(word.source))));
  word.officeKit = await attempt("office-kit", async () => {
    const plain = docx.openDocx(bytes(word.source));
    save("outputs/Report-ok.docx", docx.toUint8Array(plain));
    const edited = docx.openDocx(bytes(word.source));
    const replaced = docx.replaceText(
      edited,
      "The scope covers the site.",
      "The scope covers the whole site.",
    );
    const validation = issues(docx.validate(edited));
    save("outputs/Report-ok-edit.docx", docx.toUint8Array(edited));
    return {
      unchanged: await compare(
        "save without changes",
        "ocsc-word",
        word.source,
        "outputs/Report-ok.docx",
      ),
      edited: {
        replaced,
        validation,
        revisionsAfter: docx.revisions(edited).length,
        ...(await compare(
          "replace one sentence",
          "ocsc-word",
          word.source,
          "outputs/Report-ok-edit.docx",
          "Scope paragraph only",
        )),
        agent: agentEdits("ocsc-word", "outputs/Report-ok-edit.docx", [
          {
            op: "add_to_section",
            heading: "Scope",
            blocks: [{ type: "paragraph", text: "Added by the assistant." }],
          },
        ]),
      },
    };
  });

  word.folio = await attempt("folio", async () => {
    const core = {
      ...(await import("@stll/folio-core/server")),
      ...(await import("@stll/folio-core/docx/rezip")),
    };
    const conversion = await import("@stll/folio-core/prosemirror/conversion");
    const source = bytes(word.source);
    const parsed = await core.parseDocx(
      source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
    );
    save("outputs/Report-folio.docx", await core.repackDocx(parsed));
    const out = {
      unchanged: await compare(
        "parse and repack",
        "ocsc-word",
        word.source,
        "outputs/Report-folio.docx",
      ),
    };
    out.editorPath = await attempt("editor path", async () => {
      const pm = conversion.toProseDoc(parsed, {
        styles: parsed.package?.styles,
        numbering: parsed.package?.numbering,
        theme: parsed.package?.theme ?? null,
      });
      let target = null;
      pm.descendants((node, pos) => {
        if (!target && node.isText && node.text.includes("The scope covers the site."))
          target = { node, pos };
      });
      if (!target) throw new Error("paragraph not found in the editor document");
      const offset = target.node.text.indexOf("the site") + "the ".length;
      const at = target.pos + offset;
      const edited = pm.replace(
        at,
        at,
        new (await import("prosemirror-model")).Slice(
          (await import("prosemirror-model")).Fragment.from(pm.type.schema.text("whole ")),
          0,
          0,
        ),
      );
      const rebuilt = conversion.fromProseDoc(edited, parsed, {
        stylesheetSource: { type: "package" },
      });
      save("outputs/Report-folio-edit.docx", await core.repackDocx(rebuilt));
      const result = await compare(
        "type one word in the editor model",
        "ocsc-word",
        word.source,
        "outputs/Report-folio-edit.docx",
        "Scope paragraph only",
      );
      result.validation = issues(
        docx.validate(docx.openDocx(bytes("outputs/Report-folio-edit.docx"))),
      );
      result.agent = agentEdits("ocsc-word", "outputs/Report-folio-edit.docx", [
        {
          op: "add_to_section",
          heading: "Scope",
          blocks: [{ type: "paragraph", text: "Added by the assistant." }],
        },
      ]);
      return result;
    });
    return out;
  });
  report.word = word;
}

// ---------- PowerPoint ----------
run(
  "ocsc-pptx",
  "new",
  "--out",
  "outputs/Deck.pptx",
  "--spec",
  spec("deck.json", {
    title: "Design Review",
    slides: [
      {
        layout: "cover",
        title: "Design Review",
        name: "Test Presenter",
        date: "November 2026",
        notes: "Cover notes",
      },
      {
        layout: "agenda",
        items: [
          { title: "Scope", text: "What we cover" },
          { title: "Programme", text: "When" },
        ],
      },
      {
        heading: "Our approach",
        subheading: "Three steps",
        style: "steps",
        points: [
          { title: "Survey", text: "Walk the site" },
          { title: "Model", text: "Build the model" },
          { title: "Report", text: "Write it up" },
        ],
        visual: "work/visual.png",
        notes: "Approach notes",
      },
      {
        layout: "chart",
        heading: "Costs",
        chart: { type: "bar", categories: ["A", "B"], series: [{ name: "Cost", values: [3, 5] }] },
      },
      {
        layout: "table",
        heading: "Owners",
        header: ["Item", "Owner"],
        rows: [["Survey", "Civil"]],
      },
      {
        layout: "closing",
        subtitle: "Questions",
        takeaways: ["One", "Two", "Three"],
        presenter: { name: "Test Presenter", role: "Engineer", email: "test@example.com" },
      },
    ],
  }),
);

{
  const pptx = await import("@office-kit/pptx");
  const deck = { source: "outputs/Deck.pptx" };
  deck.officeKit = await attempt("office-kit", async () => {
    const plain = await pptx.loadPresentation(bytes(deck.source));
    deck.validateSource = issues(pptx.validatePresentation(plain));
    save("outputs/Deck-ok.pptx", await pptx.savePresentation(plain));
    const edited = await pptx.loadPresentation(bytes(deck.source));
    const slides = pptx.getSlides(edited);
    const shape = pptx
      .getSlideShapes(slides[2])
      .find((s) => pptx.getShapeText(s) === "Walk the site");
    if (!shape) throw new Error("shape 'Walk the site' not found on slide 3");
    pptx.setShapeText(shape, "Walk the whole site", { preserveFormatting: true });
    pptx.setSlideNotes(slides[0], "Cover notes, edited");
    const validation = issues(pptx.validatePresentation(edited));
    save("outputs/Deck-ok-edit.pptx", await pptx.savePresentation(edited));
    return {
      unchanged: await compare(
        "save without changes",
        "ocsc-pptx",
        deck.source,
        "outputs/Deck-ok.pptx",
      ),
      edited: {
        validation,
        ...(await compare(
          "one text box and one note",
          "ocsc-pptx",
          deck.source,
          "outputs/Deck-ok-edit.pptx",
          "slide 3 text and slide 1 notes",
        )),
        agent: agentEdits("ocsc-pptx", "outputs/Deck-ok-edit.pptx", [
          {
            op: "replace_text",
            find: "Build the model",
            replace: "Build the flood model",
            slide: 3,
          },
        ]),
      },
    };
  });
  report.pptx = deck;
}

// ---------- Excel ----------
run(
  "ocsc-xlsx",
  "new",
  "--out",
  "outputs/Book.xlsx",
  "--spec",
  spec("book.json", {
    sheets: [
      {
        name: "Costs",
        columns: [
          { header: "Item", width: 30 },
          { header: "Qty" },
          { header: "Rate", format: "£#,##0.00" },
          { header: "Cost", format: "£#,##0.00", total: true },
        ],
        rows: [
          ["Steel beams", 12, 450, { formula: "B2*C2" }],
          ["Concrete (m3)", 40, 98.5, { formula: "B3*C3" }],
          ["Survey", 1, 1200, { formula: "B4*C4" }],
        ],
        total_row: true,
      },
      {
        name: "Notes",
        columns: ["Note"],
        rows: [["Prices exclude VAT"], [{ date: "2026-10-22" }]],
      },
    ],
  }),
);

{
  const io = await import("@office-kit/xlsx/io");
  const book = await import("@office-kit/xlsx/workbook");
  const styles = await import("@office-kit/xlsx/styles");
  const sheet = { source: "outputs/Book.xlsx" };
  sheet.officeKit = await attempt("office-kit", async () => {
    const plain = await io.loadWorkbook(io.fromArrayBuffer(bytes(sheet.source)));
    save("outputs/Book-ok.xlsx", await io.workbookToBytes(plain));
    const edited = await io.loadWorkbook(io.fromArrayBuffer(bytes(sheet.source)));
    book.setCellAtAddress(edited, "Costs!C2", 475);
    const display = ["Costs!C2", "Costs!D2", "Costs!D5", "Notes!A3"].map((a) => {
      const cell = book.getCellAtAddress(edited, a);
      return `${a}=${cell ? styles.getCellDisplayText(edited, cell) : "(empty)"}`;
    });
    save("outputs/Book-ok-edit.xlsx", await io.workbookToBytes(edited));
    const zip = await JSZip.loadAsync(readFileSync(file("outputs/Book-ok-edit.xlsx")));
    const calcPr =
      (await zip.file("xl/workbook.xml").async("string")).match(/<calcPr[^>]*>/)?.[0] ?? null;
    return {
      unchanged: await compare(
        "save without changes",
        "ocsc-xlsx",
        sheet.source,
        "outputs/Book-ok.xlsx",
      ),
      edited: {
        display,
        calcPr,
        ...(await compare(
          "change one rate",
          "ocsc-xlsx",
          sheet.source,
          "outputs/Book-ok-edit.xlsx",
          "C2 only (D2 and the total keep their cached values)",
        )),
        agent: agentEdits("ocsc-xlsx", "outputs/Book-ok-edit.xlsx", [
          { op: "set", sheet: "Costs", cell: "B3", value: 42 },
        ]),
      },
    };
  });
  report.xlsx = sheet;
}

console.log(JSON.stringify(report, null, 2));
if (keep) console.error(`Files kept in ${workspace}`);
else rmSync(workspace, { recursive: true, force: true });
