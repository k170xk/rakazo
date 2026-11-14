#!/usr/bin/env node
// ocsc-app-shot <app.html> <out-dir> [--pages id,id] [--phone] [--check]
//
// Opens an App Studio app (a built document with its data inlined) in headless Chromium with every
// network request refused, clicks through its pages and writes report.json: crashes, console
// errors, blank screens, pages wider than a phone and controls or text that are hard to use on
// one. Without --check it also saves JPEG
// screenshots of the pages asked for (the first page by default), on a desktop and with --phone
// on a phone, so the bot that built the app can see it.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PLAYWRIGHT =
  process.env.OCSC_PLAYWRIGHT_MODULE || "/opt/ocsc-word/node_modules/playwright-core/index.mjs";
const WORKSPACE = path.resolve(process.env.WORKSPACE_DIR || process.cwd());
const DESKTOP = { width: 1440, height: 900, scale: 1, maxHeight: 2400 };
const PHONE = { width: 390, height: 844, scale: 2, maxHeight: 1600 };
const MAX_PAGES = 8;
const SETTLE_MS = 900;
const CRASH_TEXT = "This app hit a problem";
/** The policy the app runs under in Rakazo's viewer, so it is checked as it will run and reaches nothing. */
const APP_POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'";
const RTC = [
  "RTCPeerConnection",
  "webkitRTCPeerConnection",
  "RTCDataChannel",
  "RTCIceCandidate",
  "RTCSessionDescription",
];

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
const positional = args.filter(
  (arg, index) => !arg.startsWith("--") && !(index > 0 && args[index - 1] === "--pages"),
);
if (positional.length < 2)
  fail("usage: ocsc-app-shot <app.html> <out-dir> [--pages id,id] [--phone] [--check]");
const htmlPath = inside(positional[0]);
const outDir = inside(positional[1]);
const check = flag("--check");
const wanted = (option("--pages") ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter((id) => /^[A-Za-z0-9_-]{1,60}$/.test(id))
  .slice(0, MAX_PAGES);

const source = await readFile(htmlPath, "utf8");
const policy = `<meta http-equiv="Content-Security-Policy" content="${APP_POLICY}">`;
const doctype = /^\s*<!doctype html>/i.exec(source);
const html = doctype ? doctype[0] + policy + source.slice(doctype[0].length) : policy + source;
await mkdir(outDir, { recursive: true });

let chromium;
try {
  ({ chromium } = await import(pathToFileURL(PLAYWRIGHT).href));
} catch (error) {
  fail(`The browser is not available here (${error.message}).`);
}

const report = {
  pages: [],
  errors: [],
  crashed: null,
  blank: [],
  overflow: [],
  phone: [],
  blocked: [],
  shots: [],
};
const note = (list, entry) => {
  if (list.length < 30 && !list.some((seen) => JSON.stringify(seen) === JSON.stringify(entry)))
    list.push(entry);
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
    if (url.startsWith("data:") || url.startsWith("blob:") || url === "about:blank")
      return route.continue();
    note(report.blocked, url.slice(0, 160));
    return route.abort("blockedbyclient");
  });
  // Requests above are routed, but WebSockets and WebRTC are not; neither exists for the app.
  await context.addInitScript((names) => {
    for (const name of names)
      Object.defineProperty(window, name, {
        value: undefined,
        writable: false,
        configurable: false,
      });
  }, RTC);
  const page = await context.newPage();
  let where = "first page";
  page.on("console", (message) => {
    if (message.type() === "error")
      note(report.errors, { page: where, message: firstLine(message.text()) });
  });
  page.on("pageerror", (error) =>
    note(report.errors, { page: where, message: firstLine(String(error.message ?? error)) }),
  );
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
  if (state.crash !== null && !report.crashed)
    report.crashed = { page: label, message: state.crash || "unknown error" };
  if (state.empty) note(report.blank, label);
  if (viewport !== PHONE) return;
  const phone = await page.evaluate(phoneProblems, PHONE.width).catch(() => null);
  if (state.scrollWidth > viewport.width + 4)
    note(report.overflow, {
      page: label,
      width: state.scrollWidth,
      ...(phone?.wide.length ? { culprits: phone.wide } : {}),
    });
  if (!phone) return;
  if (phone.zoom.length) note(report.phone, { page: label, kind: "zoom", items: phone.zoom });
  if (phone.tap.length) note(report.phone, { page: label, kind: "tap", items: phone.tap });
  if (phone.tiny.length) note(report.phone, { page: label, kind: "tiny", items: phone.tiny });
}

/**
 * Runs in the page at phone size. What makes an app awkward on an iPhone without breaking it: inputs
 * under 16px (iOS zooms in on focus), controls smaller than a fingertip, text too small to read, and
 * the elements that push the page wider than the screen.
 */
function phoneProblems(screenWidth) {
  const MIN_TAP = 32;
  const MIN_TEXT = 11;
  const describe = (element) => {
    const text = (
      element.getAttribute("aria-label") ||
      element.innerText ||
      element.getAttribute("placeholder") ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
    const tag = element.tagName.toLowerCase();
    return text ? `${tag} "${text}"` : tag;
  };
  const visible = (element) => {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return null;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0)
      return null;
    return box;
  };
  const zoom = new Set();
  for (const field of document.querySelectorAll(
    "input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color]), textarea, select",
  )) {
    if (!visible(field) || field.readOnly || field.disabled) continue;
    if (Number.parseFloat(getComputedStyle(field).fontSize) < 16) zoom.add(describe(field));
  }
  const tap = new Set();
  for (const control of document.querySelectorAll(
    "button, a[href], [role=button], [role=tab], [role=menuitem], [role=checkbox], [role=switch], input[type=checkbox], input[type=radio], select, summary",
  )) {
    const box = visible(control);
    // Under 4px is a visually hidden helper; data-dense marks kit controls with a larger way in
    // (a Gantt bar opens the same record as its full-height row name).
    if (!box || box.width < 4 || box.height < 4) continue;
    if (control.closest("[aria-hidden=true], svg, .recharts-wrapper, [data-dense]")) continue;
    if (control.disabled || control.getAttribute("aria-disabled") === "true") continue;
    // A small control inside a larger tappable row or label is reached through it.
    const host = control.parentElement?.closest(
      "label, button, a[href], [role=button], [role=row]",
    );
    if (host && host !== control) {
      const outer = host.getBoundingClientRect();
      if (outer.width >= MIN_TAP && outer.height >= MIN_TAP) continue;
    }
    if (box.width < MIN_TAP || box.height < MIN_TAP)
      tap.add(`${describe(control)} ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
  const tiny = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && tiny.size < 6; node = walker.nextNode()) {
    const text = node.textContent.replace(/\s+/g, " ").trim();
    const parent = node.parentElement;
    if (!text || !parent || parent.closest("svg, script, style, [aria-hidden=true]")) continue;
    if (!visible(parent)) continue;
    const size = Number.parseFloat(getComputedStyle(parent).fontSize);
    if (size < MIN_TEXT) tiny.add(`"${text.slice(0, 30)}" ${size}px`);
  }
  // The outermost elements wider than the screen, not every descendant of one.
  const wide = [];
  for (const element of document.body.querySelectorAll("*")) {
    if (wide.length >= 4) break;
    const box = element.getBoundingClientRect();
    if (box.right <= screenWidth + 4 && box.left >= -4) continue;
    if (wide.some((seen) => seen.element.contains(element))) continue;
    let clipped = false;
    for (let up = element.parentElement; up && up !== document.body; up = up.parentElement) {
      const overflowX = getComputedStyle(up).overflowX;
      if (overflowX !== "visible" && up.getBoundingClientRect().right <= screenWidth + 4) {
        clipped = true;
        break;
      }
    }
    if (!clipped)
      wide.push({ element, label: `${describe(element)} ${Math.round(box.width)}px wide` });
  }
  return {
    zoom: [...zoom].slice(0, 6),
    tap: [...tap].slice(0, 8),
    tiny: [...tiny],
    wide: wide.map((entry) => entry.label),
  };
}

async function pagesOf(page) {
  return page.evaluate(() => {
    const seen = new Map();
    for (const button of document.querySelectorAll("[data-app-page]")) {
      const id = button.getAttribute("data-app-page");
      if (id && !seen.has(id))
        seen.set(
          id,
          (button.getAttribute("data-app-label") || button.textContent || id).trim().slice(0, 60),
        );
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
  const clip = {
    x: 0,
    y: 0,
    width: viewport.width,
    height: Math.min(Math.max(height, viewport.height), viewport.maxHeight),
  };
  await page.screenshot({
    path: path.join(outDir, file),
    type: "jpeg",
    quality: 72,
    fullPage: true,
    clip,
    timeout: 15_000,
  });
  report.shots.push({
    file,
    page: label,
    viewport: viewport === PHONE ? "phone" : "desktop",
    width: clip.width,
    height: clip.height,
    cut: height > clip.height,
  });
}

const browser = await chromium.launch({
  headless: true,
  args: [
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--no-first-run",
    // Nothing listens here, so a WebSocket or anything else that skips the routing above fails.
    "--proxy-server=socks5://127.0.0.1:9",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  ],
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
  await Promise.race([
    browser.close().catch(() => {}),
    new Promise((done) => setTimeout(done, 3000)),
  ]);
}
await writeFile(path.join(outDir, "report.json"), JSON.stringify(report));
console.log(
  JSON.stringify({
    pages: report.pages.length,
    errors: report.errors.length,
    shots: report.shots.length,
  }),
);
