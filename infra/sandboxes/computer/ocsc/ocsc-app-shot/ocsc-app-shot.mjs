#!/usr/bin/env node
// ocsc-app-shot <app.html> <out-dir> [--pages id,id] [--phone] [--check]
//
// Opens an App Studio app (a built document with its data inlined) in headless Chromium with every
// network request refused, clicks through its pages and writes report.json: crashes, console
// errors, blank screens and pages wider than a phone. Without --check it also saves JPEG
// screenshots of the pages asked for (the first page by default), on a desktop and with --phone
// on a phone, so the bot that built the app can see it.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PLAYWRIGHT = process.env.OCSC_PLAYWRIGHT_MODULE || "/opt/ocsc-word/node_modules/playwright-core/index.mjs";
const WORKSPACE = path.resolve(process.env.WORKSPACE_DIR || process.cwd());
const DESKTOP = { width: 1440, height: 900, scale: 1, maxHeight: 2400 };
const PHONE = { width: 390, height: 844, scale: 2, maxHeight: 1600 };
const MAX_PAGES = 8;
const SETTLE_MS = 900;
const CRASH_TEXT = "This app hit a problem";

function fail(message) {
  console.error(message);
  process.exit(2);
}

function inside(relative) {
  const resolved = path.resolve(WORKSPACE, relative);
  if (resolved !== WORKSPACE && !resolved.startsWith(`${WORKSPACE}${path.sep}`))
    fail(`${relative} is outside the work folder.`);
  return resolved;
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const positional = args.filter((arg, index) => !arg.startsWith("--") && !(index > 0 && args[index - 1] === "--pages"));
if (positional.length < 2) fail("usage: ocsc-app-shot <app.html> <out-dir> [--pages id,id] [--phone] [--check]");
const htmlPath = inside(positional[0]);
const outDir = inside(positional[1]);
const check = flag("--check");
const wanted = (option("--pages") ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter((id) => /^[A-Za-z0-9_-]{1,60}$/.test(id))
  .slice(0, MAX_PAGES);

const html = await readFile(htmlPath, "utf8");
await mkdir(outDir, { recursive: true });

let chromium;
try {
  ({ chromium } = await import(pathToFileURL(PLAYWRIGHT).href));
} catch (error) {
  fail(`The browser is not available here (${error.message}).`);
}

const report = { pages: [], errors: [], crashed: null, blank: [], overflow: [], blocked: [], shots: [] };
const note = (list, entry) => {
  if (list.length < 30 && !list.some((seen) => JSON.stringify(seen) === JSON.stringify(entry))) list.push(entry);
};

/** Minified stack frames mean nothing to the bot; the message does. */
const firstLine = (text) => text.split("\n")[0].slice(0, 400);

async function open(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.scale,
    isMobile: viewport === PHONE,
    hasTouch: viewport === PHONE,
    serviceWorkers: "block",
    // Screenshots show values settled, not mid count-up or below the fold still at zero.
    reducedMotion: "reduce",
    acceptDownloads: false,
  });
  // The app is sealed; anything that tries the network is reported, never sent.
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("data:") || url.startsWith("blob:") || url === "about:blank") return route.continue();
    note(report.blocked, url.slice(0, 160));
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  let where = "first page";
  page.on("console", (message) => {
    if (message.type() === "error") note(report.errors, { page: where, message: firstLine(message.text()) });
  });
  page.on("pageerror", (error) => note(report.errors, { page: where, message: firstLine(String(error.message ?? error)) }));
  await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(SETTLE_MS + 300);
  return { context, page, at: (label) => (where = label) };
}

async function inspect(page, label, viewport) {
  const state = await page.evaluate((crashText) => {
    const root = document.getElementById("root") ?? document.body;
    const text = (root.innerText || "").trim();
    return {
      crash: text.startsWith(crashText) ? text.slice(crashText.length).trim().slice(0, 400) : null,
      empty: text.length < 3 && !root.querySelector("svg, img, canvas"),
      scrollWidth: document.documentElement.scrollWidth,
    };
  }, CRASH_TEXT);
  if (state.crash !== null && !report.crashed) report.crashed = { page: label, message: state.crash || "unknown error" };
  if (state.empty) note(report.blank, label);
  if (viewport === PHONE && state.scrollWidth > viewport.width + 4)
    note(report.overflow, { page: label, width: state.scrollWidth });
}

async function pagesOf(page) {
  return page.evaluate(() => {
    const seen = new Map();
    for (const button of document.querySelectorAll("[data-app-page]")) {
      const id = button.getAttribute("data-app-page");
      if (id && !seen.has(id)) seen.set(id, (button.getAttribute("data-app-label") || button.textContent || id).trim().slice(0, 60));
    }
    return [...seen].map(([id, label]) => ({ id, label }));
  });
}

async function go(page, id) {
  const target = page.locator(`[data-app-page="${id}"]:visible`).first();
  if (!(await target.count())) return false;
  await target.click({ timeout: 5000 }).catch(() => {});
  await page.mouse.move(0, 0).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
  return true;
}

async function shoot(page, viewport, label, index) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const file = `${viewport === PHONE ? "phone" : "desktop"}-${index + 1}.jpg`;
  const clip = { x: 0, y: 0, width: viewport.width, height: Math.min(Math.max(height, viewport.height), viewport.maxHeight) };
  await page.screenshot({ path: path.join(outDir, file), type: "jpeg", quality: 72, fullPage: true, clip, timeout: 15_000 });
  report.shots.push({ file, page: label, viewport: viewport === PHONE ? "phone" : "desktop", width: clip.width, height: clip.height, cut: height > clip.height });
}

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run"],
  ...(process.env.OCSC_CHROMIUM ? { executablePath: process.env.OCSC_CHROMIUM } : {}),
});
/** Opens the app at one size and visits `targets` in order, checking each and shooting unless --check. */
async function visit(viewport, targets) {
  const { context, page, at } = await open(browser, viewport);
  try {
    if (!report.pages.length) report.pages = await pagesOf(page);
    let current = report.pages[0]?.id ?? "";
    const list = targets(report.pages);
    for (const [index, item] of list.entries()) {
      at(item.label);
      if (item.id !== current) {
        if (!(await go(page, item.id))) continue;
        current = item.id;
      }
      await inspect(page, item.label, viewport);
      if (!check) await shoot(page, viewport, item.label, index);
    }
  } finally {
    await context.close().catch(() => {});
  }
}

const firstPage = (pages) => [pages[0] ?? { id: "", label: "first page" }];
const targets = (pages) => {
  if (check) return pages.length ? pages.slice(0, MAX_PAGES) : firstPage(pages);
  const chosen = wanted.map((id) => pages.find((item) => item.id === id)).filter(Boolean);
  return chosen.length ? chosen : firstPage(pages);
};

try {
  await visit(DESKTOP, targets);
  if (check || flag("--phone")) await visit(PHONE, targets);
} finally {
  await Promise.race([browser.close().catch(() => {}), new Promise((done) => setTimeout(done, 3000))]);
}
await writeFile(path.join(outDir, "report.json"), JSON.stringify(report));
console.log(JSON.stringify({ pages: report.pages.length, errors: report.errors.length, shots: report.shots.length }));
