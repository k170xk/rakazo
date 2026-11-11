#!/usr/bin/env node
/**
 * OCSC PDF: turn a workspace file into a PDF on a Bot's computer.
 *
 *   ocsc-pdf convert --in outputs/Report.docx --out outputs/Report.pdf [--show-changes]
 *   ocsc-pdf read --in uploads/Drawing.pdf
 *
 * Converts Word, Excel, CSV, PowerPoint, images, text and HTML. The file is drawn the same way the
 * computer screen shows it and printed by a headless Chromium that has no network: nothing in the
 * document can fetch anything while it prints.
 *
 * A Word file prints as its final text; --show-changes keeps tracked changes marked up.
 *
 * For a report, build it with ocsc-word first (templates, headings, tables) and convert that.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
} from "node:path";
import { pathToFileURL } from "node:url";
import { escapeHtml, kindOf, renderPreview, showOnScreen } from "./screen.mjs";

const WORKSPACE =
  process.env.WORKSPACE_DIR || process.env.HOME || process.cwd();
const PLAYWRIGHT =
  process.env.OCSC_PLAYWRIGHT_MODULE ||
  "/app/node_modules/playwright/index.mjs";
process.env.PLAYWRIGHT_BROWSERS_PATH ||= "/ms-playwright";

class UsageError extends Error {}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[a.slice(2)] = true;
    else {
      out[a.slice(2)] = next;
      i += 1;
    }
  }
  return out;
}

function inWorkspace(p, label) {
  if (typeof p !== "string" || !p.trim())
    throw new UsageError(`${label} is required.`);
  const full = isAbsolute(p) ? resolve(p) : resolve(WORKSPACE, p);
  const rel = relative(WORKSPACE, full);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new UsageError(
      `${label} must be inside the workspace (${WORKSPACE}).`,
    );
  }
  return { full, rel: rel.split("\\").join("/") };
}

function downloadLink(rel) {
  const name = basename(rel);
  const bot = process.env.COMPUTER_BOT_ID;
  if (!bot) return { name, path: rel };
  const url = `/api/computers/${encodeURIComponent(bot)}/files/download?path=${encodeURIComponent(rel)}`;
  return { name, path: rel, url, link: `[${name}](${url})` };
}

const SHEET_CSS =
  "@page{size:A4 landscape;margin:10mm}.ob-sheet{overflow:visible;max-width:none;margin:0 0 6mm;break-after:page}.ob-sheet:last-child{break-after:auto}.ob-sheet h2{position:static}.ob-grid th{position:static}.ob-grid td{white-space:pre-wrap;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;max-width:none}.ob-grid tr{break-inside:avoid}";
/** A4 landscape less 10 mm margins, in CSS pixels. */
const SHEET_PRINT_WIDTH = Math.floor((277 / 25.4) * 96);

const PRINT = {
  Word: { css: "@page{size:A4;margin:0}", format: "A4" },
  Excel: { css: SHEET_CSS, landscape: true, fit: true },
  CSV: { css: SHEET_CSS, landscape: true, fit: true },
  PowerPoint: {
    css: "@page{size:13.333in 7.5in;margin:0}.ob-slide{width:13.333in!important;height:7.5in!important;aspect-ratio:auto;margin:0!important}.ob-slide .num{display:none}",
  },
  Image: {
    css: "@page{size:A4;margin:10mm}.ob-image{max-height:270mm;object-fit:contain}",
  },
  Text: {
    css: "@page{size:A4;margin:16mm}pre.ob-text{box-shadow:none;padding:0;max-width:none}",
  },
};

async function browser() {
  let chromium;
  try {
    ({ chromium } = await import(pathToFileURL(PLAYWRIGHT).href));
  } catch (error) {
    throw new Error(
      `The PDF printer is not available on this computer (${error.message}).`,
    );
  }
  return chromium.launch({
    headless: true,
    ...(process.env.OCSC_CHROMIUM
      ? { executablePath: process.env.OCSC_CHROMIUM }
      : {}),
  });
}

async function printHtml(
  html,
  { css = "", landscape = false, scripts = true, ready = true, fit = false },
  outFull,
) {
  const b = await browser();
  try {
    const context = await b.newContext({
      javaScriptEnabled: scripts,
      offline: true,
      viewport: { width: 1240, height: 1754 },
    });
    await context.route("**/*", (route) => {
      const url = route.request().url();
      return url.startsWith("data:") || url.startsWith("blob:")
        ? route.continue()
        : route.abort();
    });
    const page = await context.newPage();
    const styled = html.replace("</head>", `<style>${css}</style></head>`);
    await page.setContent(styled, { waitUntil: "load", timeout: 60_000 });
    if (ready) {
      await page.waitForFunction(
        () => document.body?.dataset.ready === "1",
        null,
        { timeout: 60_000 },
      );
    }
    await page.emulateMedia({ media: "print" });
    let scale = 1;
    if (fit) {
      const widest = await page.evaluate(() =>
        Math.max(0, ...[...document.querySelectorAll("table.ob-grid")].map((t) => t.scrollWidth)),
      );
      if (widest > SHEET_PRINT_WIDTH) scale = Math.max(0.3, SHEET_PRINT_WIDTH / widest);
    }
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      landscape,
      scale,
    });
    mkdirSync(dirname(outFull), { recursive: true });
    writeFileSync(outFull, pdf);
    return pdf.length;
  } finally {
    await b.close();
  }
}

const LEGACY = {
  doc: ["Word", ".docx"],
  xls: ["Excel", ".xlsx"],
  ppt: ["PowerPoint", ".pptx"],
};

/** Report.pdf, or Report-xlsx.pdf when another Report.* beside it could print to the same name. */
function defaultOut(src) {
  const stem = src.rel.replace(/\.[^./]+$/, "");
  const ext = extname(src.rel).slice(1).toLowerCase();
  const dir = dirname(src.full);
  const base = basename(stem);
  const siblings = existsSync(dir)
    ? readdirSync(dir).filter(
        (n) =>
          n.slice(0, n.length - extname(n).length) === base &&
          extname(n).toLowerCase() !== `.${ext}` &&
          kindOf(n) &&
          kindOf(n) !== "PDF",
      )
    : [];
  return siblings.length ? `${stem}-${ext}.pdf` : `${stem}.pdf`;
}

async function cmdConvert(o) {
  const src = inWorkspace(o.in, "--in");
  if (!existsSync(src.full)) throw new UsageError(`${src.rel} does not exist.`);
  if (statSync(src.full).size > 40 * 1024 * 1024)
    throw new UsageError(`${src.rel} is larger than 40 MB.`);
  const out = inWorkspace(o.out || defaultOut(src), "--out");
  if (!/\.pdf$/i.test(out.full)) throw new UsageError("--out must end in .pdf");
  const kind = kindOf(src.rel);
  const legacy = LEGACY[extname(src.rel).slice(1).toLowerCase()];
  if (legacy) {
    throw new UsageError(
      `${src.rel} is an old ${legacy[0]} 97-2003 file, which cannot be converted here. Ask the person to open it and save it as ${legacy[1]} (File > Save As), then upload that and convert it.`,
    );
  }
  if (!kind || kind === "PDF") {
    throw new UsageError(
      `${src.rel} cannot be converted. Word (.docx), Excel (.xlsx), CSV, PowerPoint (.pptx), images, text and HTML can.`,
    );
  }
  let bytes;
  if (kind === "Web page") {
    // The Bot's own page, printed as it is, with its scripts off.
    const html = readFileSync(src.full, "utf8");
    bytes = await printHtml(
      html.includes("</head>")
        ? html
        : `<html><head></head><body>${html}</body></html>`,
      { css: "@page{size:A4;margin:14mm}", scripts: false, ready: false },
      out.full,
    );
  } else {
    const { html } = await renderPreview(src.full, basename(src.rel), {
      changes: o["show-changes"] === true,
      print: true,
    });
    bytes = await printHtml(html, PRINT[kind] || {}, out.full);
  }
  return { ok: true, from: src.rel, bytes, ...downloadLink(out.rel) };
}

async function cmdRead(o) {
  const src = inWorkspace(o.in, "--in");
  if (!existsSync(src.full)) throw new UsageError(`${src.rel} does not exist.`);
  if (extname(src.full).toLowerCase() !== ".pdf")
    throw new UsageError("--in must be a .pdf file.");
  const b = await browser();
  try {
    const context = await b.newContext({ offline: true });
    const page = await context.newPage();
    const pdfjs = readFileSync(
      new URL("./node_modules/pdfjs-dist/build/pdf.min.mjs", import.meta.url),
    ).toString("base64");
    const worker = readFileSync(
      new URL(
        "./node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ),
    ).toString("base64");
    const data = readFileSync(src.full).toString("base64");
    await page.setContent(
      `<!doctype html><title>${escapeHtml(src.rel)}</title>`,
    );
    return {
      ok: true,
      file: src.rel,
      ...(await page.evaluate(
        async ({ pdfjs, worker, data }) => {
          const blob = (b64, type) => {
            const raw = atob(b64);
            const buf = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i += 1) buf[i] = raw.charCodeAt(i);
            return new Blob([buf], { type });
          };
          const lib = await import(
            URL.createObjectURL(blob(pdfjs, "text/javascript"))
          );
          lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
            blob(worker, "text/javascript"),
          );
          const doc = await lib.getDocument({
            data: new Uint8Array(await blob(data).arrayBuffer()),
            isEvalSupported: false,
          }).promise;
          const pages = [];
          for (let n = 1; n <= Math.min(doc.numPages, 200); n += 1) {
            const content = await (await doc.getPage(n)).getTextContent();
            pages.push(
              content.items
                .map((item) => item.str + (item.hasEOL ? "\n" : ""))
                .join("")
                .trim(),
            );
          }
          return {
            pages: doc.numPages,
            text: pages
              .map((t, i) => `--- Page ${i + 1} ---\n${t}`)
              .join("\n\n")
              .slice(0, 200_000),
          };
        },
        { pdfjs, worker, data },
      )),
    };
  } finally {
    await b.close();
  }
}

const USAGE = `ocsc-pdf convert --in outputs/X.docx|.xlsx|.pptx|.csv|.png|.txt|.html [--out outputs/X.pdf] [--show-changes]
ocsc-pdf read --in X.pdf`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const o = args(rest);
  try {
    let result;
    if (command === "convert") result = await cmdConvert(o);
    else if (command === "read") result = await cmdRead(o);
    else throw new UsageError(`Usage:\n${USAGE}`);
    if (command === "convert")
      Object.assign(
        result,
        await showOnScreen(resolve(WORKSPACE, result.path), result.path),
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: error instanceof UsageError ? error.message : String(error?.message || error) }, null, 2)}\n`,
    );
    process.exit(1);
  }
}

main();
