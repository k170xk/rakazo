#!/usr/bin/env node
/**
 * Evolve PDF Studio on the Bot's computer: the OCSC-branded Open PDF Studio, open in the visible
 * browser so a person watches every markup, with its tools callable from here.
 *
 *   ocsc-pdf-studio open <file.pdf> [--out <file.pdf>] [--discard]
 *   ocsc-pdf-studio tools [<tool>]
 *   ocsc-pdf-studio call <tool> ['{"json":"arguments"}' | @args.json]
 *   ocsc-pdf-studio save
 *   ocsc-pdf-studio status
 *   ocsc-pdf-studio screenshot [--out <file.png>]
 *
 * A small server on 127.0.0.1 serves the app and a host page that answers the app's open, save and
 * list requests from the workspace. Saving writes to --out (by default outputs/<name>-markup.pdf),
 * so the original stays as it was. Tools run inside the page through window.__OPDS_APP__, the same
 * tool set the desktop app offers over MCP, minus file system, printing and extensions.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = process.env.PDF_STUDIO_APP || join(HERE, "app");
const WORKSPACE = realpathSync(process.env.WORKSPACE_DIR || process.env.HOME || process.cwd());
const STATE_DIR = join(WORKSPACE, ".openbot", "pdf-studio");
const SERVER_FILE = join(STATE_DIR, "server.json");
const MAX_PDF_BYTES = 300 * 1024 * 1024;
const OPEN_TIMEOUT_MS = 90_000;
const MAX_PRINTED_CHARS = 20_000;

class StudioError extends Error {}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".pfb": "application/octet-stream",
  ".bcmap": "application/octet-stream",
  ".map": "application/json",
};

// ---------- workspace paths ----------

function workspacePath(p, { pdf = true } = {}) {
  if (!p) throw new StudioError("A file path is needed.");
  const full = resolve(isAbsolute(p) ? p : join(process.cwd(), p));
  const rel = relative(WORKSPACE, full);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new StudioError(`${p} is outside the workspace.`);
  if (pdf && extname(full).toLowerCase() !== ".pdf") throw new StudioError(`${p} is not a PDF.`);
  return { full, rel: rel.split(sep).join("/") };
}

function servedPath(rel, { pdf = true } = {}) {
  const full = resolve(WORKSPACE, rel || ".");
  const back = relative(WORKSPACE, full);
  if (back.startsWith("..") || isAbsolute(back)) throw new StudioError("outside the workspace");
  if (existsSync(full)) {
    const real = realpathSync(full);
    if (real !== WORKSPACE && !real.startsWith(WORKSPACE + sep))
      throw new StudioError("outside the workspace");
  }
  if (pdf && extname(full).toLowerCase() !== ".pdf") throw new StudioError("only PDF files");
  return { full, rel: back.split(sep).join("/") };
}

function freeName(full) {
  if (!existsSync(full)) return full;
  const ext = extname(full);
  const stem = full.slice(0, -ext.length);
  for (let n = 2; ; n++) {
    const next = `${stem} (${n})${ext}`;
    if (!existsSync(next)) return next;
  }
}

// ---------- the server ----------

function readBody(req, limit) {
  return new Promise((done, fail) => {
    const parts = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        fail(new StudioError("file too large"));
        req.destroy();
        return;
      }
      parts.push(chunk);
    });
    req.on("end", () => done(Buffer.concat(parts)));
    req.on("error", fail);
  });
}

function serve() {
  if (!existsSync(join(APP_DIR, "index.html"))) {
    throw new StudioError("Evolve PDF Studio is not installed on this computer (no app bundle).");
  }
  const token = randomBytes(24).toString("hex");
  const hostPage = readFileSync(join(HERE, "host.html"), "utf8").replace("__TOKEN__", token);
  const json = (res, status, value) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(value));
  };
  const server = createServer(async (req, res) => {
    try {
      const { port } = server.address();
      if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
        return json(res, 403, { error: "wrong host" });
      }
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname === "/health") return json(res, 200, { ok: true, workspace: WORKSPACE });
      if (url.pathname === "/studio" && req.method === "GET") {
        res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
        return res.end(hostPage);
      }
      if (!url.pathname.startsWith("/api/") && req.method === "GET") {
        const rel = decodeURIComponent(url.pathname.slice(1)) || "index.html";
        const full = resolve(APP_DIR, rel);
        if (!full.startsWith(APP_DIR + sep) || !existsSync(full) || !statSync(full).isFile()) {
          return json(res, 404, { error: "not found" });
        }
        res.writeHead(200, {
          "content-type": MIME[extname(full).toLowerCase()] || "application/octet-stream",
          "cache-control": rel === "index.html" ? "no-store" : "max-age=3600",
        });
        return createReadStream(full).pipe(res);
      }
      if (req.headers["x-pdf-studio"] !== token) return json(res, 403, { error: "forbidden" });

      if (url.pathname === "/api/file" && req.method === "GET") {
        const { full } = servedPath(url.searchParams.get("path"));
        if (!existsSync(full)) return json(res, 404, { error: "file not found" });
        res.writeHead(200, { "content-type": "application/pdf", "cache-control": "no-store" });
        return createReadStream(full).pipe(res);
      }
      if (url.pathname === "/api/file" && req.method === "PUT") {
        const { full: wanted } = servedPath(url.searchParams.get("path"));
        const body = await readBody(req, MAX_PDF_BYTES);
        if (body.subarray(0, 5).toString("latin1") !== "%PDF-") throw new StudioError("not a PDF");
        const full = url.searchParams.get("mode") === "new" ? freeName(wanted) : wanted;
        mkdirSync(dirname(full), { recursive: true });
        const temp = `${full}.${process.pid}.tmp`;
        writeFileSync(temp, body);
        renameSync(temp, full);
        return json(res, 200, {
          path: relative(WORKSPACE, full).split(sep).join("/"),
          bytes: body.length,
        });
      }
      if (url.pathname === "/api/list" && req.method === "GET") {
        const { full, rel } = servedPath(url.searchParams.get("dir") || ".", { pdf: false });
        const entries = existsSync(full) ? readdirSync(full, { withFileTypes: true }) : [];
        const list = entries
          .filter(
            (e) =>
              !e.name.startsWith(".") &&
              (e.isDirectory() || extname(e.name).toLowerCase() === ".pdf"),
          )
          .map((e) => ({
            id: rel && rel !== "." ? `${rel}/${e.name}` : e.name,
            name: e.name,
            modified: statSync(join(full, e.name)).mtime.toISOString(),
            soort: e.isDirectory() ? "map" : "bestand",
          }));
        return json(res, 200, list);
      }
      return json(res, 404, { error: "not found" });
    } catch (error) {
      json(res, error instanceof StudioError ? 400 : 500, { error: error.message });
    }
  });
  server.listen(0, "127.0.0.1", () => {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(SERVER_FILE, JSON.stringify({ port: server.address().port, pid: process.pid }));
  });
}

// ---------- reaching the server and the page ----------

async function healthy(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok && (await response.json()).workspace === WORKSPACE;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readServer() {
  try {
    return JSON.parse(readFileSync(SERVER_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function ensureServer() {
  const known = readServer();
  if (known && (await healthy(known.port))) return `http://127.0.0.1:${known.port}`;
  if (!existsSync(join(APP_DIR, "index.html"))) {
    throw new StudioError("Evolve PDF Studio is not installed on this computer (no app bundle).");
  }
  mkdirSync(STATE_DIR, { recursive: true });
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "serve"], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, WORKSPACE_DIR: WORKSPACE },
  });
  child.unref();
  for (let i = 0; i < 50; i++) {
    await sleep(200);
    const started = readServer();
    if (started && started.pid === child.pid && (await healthy(started.port)))
      return `http://127.0.0.1:${started.port}`;
  }
  throw new StudioError("The Evolve PDF Studio server did not start.");
}

function debugPort() {
  let display = String(process.env.DISPLAY || ":1")
    .replace(/^.*:/, "")
    .split(".")[0];
  if (!/^\d+$/.test(display)) display = "1";
  return 9221 + Number(display);
}

async function playwright() {
  return import(process.env.OCSC_PLAYWRIGHT_MODULE || "playwright-core");
}

async function connect(openUrl) {
  const { chromium } = await playwright();
  const endpoint = `http://127.0.0.1:${debugPort()}`;
  try {
    return { browser: await chromium.connectOverCDP(endpoint), launched: false };
  } catch {}
  const opener = process.env.OCSC_SCREEN_OPEN || "rakazo-browser";
  const child = spawn(opener, [openUrl], { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      return { browser: await chromium.connectOverCDP(endpoint), launched: true };
    } catch {}
  }
  throw new StudioError("The computer's browser did not start.");
}

function studioPages(browser, origin) {
  return browser
    .contexts()
    .flatMap((c) => c.pages())
    .filter((p) => p.url().startsWith(`${origin}/studio`));
}

function appFrame(page) {
  return page.frames().find((f) => f.url().includes("/index.html#")) || null;
}

async function waitForApp(page) {
  const until = Date.now() + OPEN_TIMEOUT_MS;
  while (Date.now() < until) {
    const frame = appFrame(page);
    if (frame) {
      try {
        if (await frame.evaluate(() => !!window.__OPDS_APP__)) return frame;
      } catch {}
    }
    await sleep(300);
  }
  throw new StudioError("Evolve PDF Studio did not load in the browser.");
}

async function session() {
  const origin = await ensureServer();
  const { chromium } = await playwright();
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort()}`);
  } catch {
    throw new StudioError("Evolve PDF Studio is not open. Run: ocsc-pdf-studio open <file.pdf>");
  }
  const page = studioPages(browser, origin)[0];
  if (!page)
    throw new StudioError("Evolve PDF Studio is not open. Run: ocsc-pdf-studio open <file.pdf>");
  return { origin, page, frame: await waitForApp(page) };
}

function toolName(name) {
  if (!name) throw new StudioError("Name a tool. See: ocsc-pdf-studio tools");
  if (name.startsWith("pdf_")) return name;
  if (name.startsWith("app_")) return `pdf_${name.slice(4)}`;
  return `pdf_${name}`;
}

async function run(frame, name, args = {}) {
  const result = await frame.evaluate(
    async ([tool, input]) => {
      try {
        return { ok: true, value: await window.__OPDS_APP__.run(tool, input) };
      } catch (error) {
        return { ok: false, error: String(error?.message || error), code: error?.code || null };
      }
    },
    [toolName(name), args],
  );
  if (!result.ok)
    throw new StudioError(
      `${toolName(name)}: ${result.error}${result.code ? ` (${result.code})` : ""}`,
    );
  return result.value;
}

// The active document's id, which the inspection tools ask for; only page text reports it.
async function documentId(frame) {
  return frame
    .evaluate(
      async () =>
        (await window.__OPDS_APP__.run("pdf_get_page_text", { page: 1 }))?.documentId ?? null,
    )
    .catch(() => null);
}

// Images inside a tool result go to files, so the answer stays small enough to read.
function keepImages(value, label) {
  const walk = (v, key) => {
    if (typeof v === "string") {
      const match = /^data:image\/(png|jpeg);base64,(.+)$/s.exec(v);
      const raw = match
        ? match[2]
        : /^(png|image|data)$|base64$/i.test(key || "") && v.length > 2000
          ? v
          : null;
      if (!raw) return v;
      mkdirSync(STATE_DIR, { recursive: true });
      const file = join(
        STATE_DIR,
        `${label}-${Date.now()}-${randomBytes(3).toString("hex")}.${match?.[1] === "jpeg" ? "jpg" : "png"}`,
      );
      writeFileSync(file, Buffer.from(raw, "base64"));
      return relative(WORKSPACE, file).split(sep).join("/");
    }
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return walk(value);
}

// ---------- commands ----------

function option(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith("--")) throw new StudioError(`${name} needs a value.`);
  args.splice(i, 2);
  return value;
}

function flag(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
}

function defaultOutput(rel) {
  const name = basename(rel, extname(rel));
  return `outputs/${name.endsWith("-markup") ? name : `${name}-markup`}.pdf`;
}

async function cmdOpen(args) {
  const out = option(args, "--out");
  const discard = flag(args, "--discard");
  const { full, rel } = workspacePath(args[0]);
  if (!existsSync(full)) throw new StudioError(`${args[0]} does not exist.`);
  const target = workspacePath(out || defaultOutput(rel)).rel;
  const origin = await ensureServer();
  const url = `${origin}/studio?${new URLSearchParams({ file: rel, out: target })}`;
  const { browser, launched } = await connect(url);
  let page = studioPages(browser, origin)[0];
  if (page && !discard) {
    const frame = appFrame(page);
    const tabs = frame ? await run(frame, "list_tabs").catch(() => null) : null;
    const list = Array.isArray(tabs) ? tabs : tabs?.tabs || [];
    if (list.some((t) => t.modified)) {
      throw new StudioError(
        "The open PDF has unsaved markups. Run ocsc-pdf-studio save first, or add --discard.",
      );
    }
  }
  if (!page && launched) {
    for (let i = 0; i < 20 && !page; i++) {
      await sleep(250);
      page = studioPages(browser, origin)[0];
    }
  }
  if (!page) page = await browser.contexts()[0].newPage();
  if (page.url() !== url) await page.goto(url);
  await page.bringToFront().catch(() => {});
  const frame = await waitForApp(page);
  const until = Date.now() + OPEN_TIMEOUT_MS;
  let stand = null;
  while (Date.now() < until) {
    stand = await run(frame, "stand").catch(() => null);
    if ((stand?.tabs || []).some((t) => t.active && t.fileName === basename(rel) && t.pageCount))
      break;
    await sleep(400);
  }
  await run(frame, "fit_page").catch(() => {});
  return {
    ok: true,
    file: rel,
    saves_to: target,
    documentId: await documentId(frame),
    state: stand,
    next: "ocsc-pdf-studio tools, then ocsc-pdf-studio call <tool> '<json>'",
  };
}

async function cmdTools(args) {
  const { frame } = await session();
  const definitions = await frame.evaluate(() => window.__OPDS_APP__.definitions());
  if (args[0]) {
    const wanted = toolName(args[0]);
    const one = definitions.find((d) => d.name === wanted);
    if (!one) throw new StudioError(`No tool ${wanted}. See: ocsc-pdf-studio tools`);
    return { ok: true, tool: one };
  }
  return {
    ok: true,
    tools: definitions.map((d) => `${d.name}: ${String(d.description).split(/(?<=\.)\s/)[0]}`),
    more: "ocsc-pdf-studio tools <name> shows a tool's arguments.",
  };
}

function parseArgs(text) {
  if (text === undefined) return {};
  const raw = text.startsWith("@")
    ? readFileSync(workspacePath(text.slice(1), { pdf: false }).full, "utf8")
    : text;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new StudioError(`The arguments are not valid JSON: ${error.message}`);
  }
}

async function cmdCall(args) {
  const { frame } = await session();
  const name = toolName(args[0]);
  const result = keepImages(await run(frame, name, parseArgs(args[1])), name);
  const json = JSON.stringify(result, null, 2);
  if (json.length <= MAX_PRINTED_CHARS) return { ok: true, tool: name, result };
  mkdirSync(STATE_DIR, { recursive: true });
  const file = join(STATE_DIR, `${name}-${Date.now()}.json`);
  writeFileSync(file, json);
  return {
    ok: true,
    tool: name,
    result_file: relative(WORKSPACE, file).split(sep).join("/"),
    chars: json.length,
    note: "The whole answer is in result_file. Search it (grep, jq) or read it in parts.",
    preview: json.slice(0, 1500),
  };
}

async function cmdSave() {
  const { page, frame } = await session();
  const before = await page.evaluate(() => window.evolvePdfHost.saves.length);
  // The title bar's Save button; its tooltip ends in the shortcut in every language.
  const button = frame.locator('button.quick-access-btn[title$="(Ctrl+S)"]');
  if (await button.isDisabled())
    throw new StudioError("Nothing to save: no PDF is open, or it is open read-only.");
  await button.click();
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    const host = await page.evaluate(() => ({
      saves: window.evolvePdfHost.saves,
      messages: window.evolvePdfHost.messages,
    }));
    if (host.saves.length > before)
      return { ok: true, saved: host.saves.at(-1).path, bytes: host.saves.at(-1).bytes };
    await sleep(300);
  }
  throw new StudioError("Saving did not finish. Check the computer screen for a message.");
}

async function cmdStatus() {
  const { page, frame } = await session();
  const host = await page.evaluate(() => ({
    file: window.evolvePdfHost.opened,
    saves: window.evolvePdfHost.saves,
  }));
  return {
    ok: true,
    ...host,
    documentId: await documentId(frame),
    state: await run(frame, "stand"),
  };
}

async function cmdScreenshot(args) {
  const out = option(args, "--out");
  const { page } = await session();
  const target = out ? workspacePath(out, { pdf: false }) : null;
  const file = target?.full || join(STATE_DIR, `screen-${Date.now()}.png`);
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file });
  return { ok: true, screenshot: relative(WORKSPACE, file).split(sep).join("/") };
}

const COMMANDS = {
  open: cmdOpen,
  tools: cmdTools,
  call: cmdCall,
  save: cmdSave,
  status: cmdStatus,
  screenshot: cmdScreenshot,
};

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "serve") return serve();
  try {
    const handler = COMMANDS[command];
    if (!handler)
      throw new StudioError(`Usage: ocsc-pdf-studio ${Object.keys(COMMANDS).join("|")} ...`);
    const result = await handler(args);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(0);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: error instanceof StudioError ? error.message : String(error?.stack || error) }, null, 2)}\n`,
    );
    process.exit(1);
  }
}

main();
