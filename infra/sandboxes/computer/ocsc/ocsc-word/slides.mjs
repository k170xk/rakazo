/**
 * OCSC slide renderer: turns a slide written as text (title, bullets, columns, stats) into a
 * 1920x1080 PNG in the OCSC style, so ocsc-pptx can build a deck with no image service.
 */
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PLAYWRIGHT =
  process.env.OCSC_PLAYWRIGHT_MODULE ||
  "/app/node_modules/playwright/index.mjs";
process.env.PLAYWRIGHT_BROWSERS_PATH ||= "/ms-playwright";

const GREEN = "#76BF43";
const INK = "#1D2B36";
const MUTED = "#5B6770";
const LOGO = "/opt/ocsc-video/src/assets/ocsc-logo.png";
const LOGO_DARK = "/opt/ocsc-video/src/assets/ocsc-logo-on-dark.png";

export const LAYOUTS = ["title", "section", "bullets", "columns", "stats", "quote"];

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function dataUrl(path) {
  return existsSync(path)
    ? `data:image/png;base64,${readFileSync(path).toString("base64")}`
    : "";
}

function list(value, max) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

/** The layout a slide asks for, or the one its content implies. */
export function layoutOf(slide) {
  if (LAYOUTS.includes(slide.layout)) return slide.layout;
  if (slide.layout) return null;
  if (Array.isArray(slide.stats)) return "stats";
  if (Array.isArray(slide.columns)) return "columns";
  if (slide.quote) return "quote";
  if (Array.isArray(slide.bullets)) return "bullets";
  return "title";
}

/** True when a slide is written as text for this renderer, rather than given as an image. */
export function isTextSlide(slide) {
  return (
    slide !== null &&
    typeof slide === "object" &&
    !slide.image &&
    Boolean(
      slide.layout ||
        slide.title ||
        slide.bullets ||
        slide.columns ||
        slide.stats ||
        slide.quote,
    )
  );
}

function body(slide, layout, footer) {
  const title = esc(slide.title);
  const subtitle = slide.subtitle ? `<p class="sub">${esc(slide.subtitle)}</p>` : "";
  const kicker = slide.kicker ? `<div class="kicker">${esc(slide.kicker)}</div>` : "";
  switch (layout) {
    case "title":
      return `<section class="dark hero">${kicker}<h1>${title}</h1>${subtitle}<div class="bar"></div>${footer}</section>`;
    case "section":
      return `<section class="green hero">${kicker}<h1>${title}</h1>${subtitle}${footer}</section>`;
    case "quote":
      return `<section class="light quote"><div class="mark">&ldquo;</div><blockquote>${esc(slide.quote)}</blockquote>${slide.by ? `<p class="by">${esc(slide.by)}</p>` : ""}${footer}</section>`;
    case "columns": {
      const cols = list(slide.columns, 4)
        .map((c) => {
          const points = list(c?.bullets, 6).map((b) => `<li>${esc(b)}</li>`).join("");
          return `<div class="card"><h3>${esc(c?.heading ?? c?.title ?? "")}</h3><p>${esc(c?.text ?? "")}</p>${points ? `<ul>${points}</ul>` : ""}</div>`;
        })
        .join("");
      return `<section class="light">${kicker}<h2>${title}</h2>${subtitle}<div class="cols">${cols}</div>${footer}</section>`;
    }
    case "stats": {
      const stats = list(slide.stats, 4)
        .map(
          (s) =>
            `<div class="stat"><div class="num">${esc(s?.value ?? "")}</div><div class="lbl">${esc(s?.label ?? "")}</div></div>`,
        )
        .join("");
      return `<section class="light">${kicker}<h2>${title}</h2>${subtitle}<div class="stats">${stats}</div>${footer}</section>`;
    }
    default: {
      const bullets = list(slide.bullets, 8)
        .map((b) => `<li>${esc(b)}</li>`)
        .join("");
      return `<section class="light">${kicker}<h2>${title}</h2>${subtitle}<ul class="points">${bullets}</ul>${footer}</section>`;
    }
  }
}

function page(slide, layout, meta) {
  const dark = layout === "title" || layout === "section";
  const logo = dataUrl(dark ? LOGO_DARK : LOGO);
  const brand = logo
    ? `<img class="logo" src="${logo}" alt="OCSC">`
    : `<span class="word">OCSC</span>`;
  const footer = `<footer>${brand}<span>${layout === "title" ? "" : esc(meta.footer || meta.title || "")}</span></footer>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1920px;height:1080px;overflow:hidden}
body{font-family:Inter,"Liberation Sans",Arial,sans-serif;color:${INK}}
section{position:relative;width:1920px;height:1080px;padding:120px 140px 160px}
.light{background:#fff}
.light::before{content:"";position:absolute;left:0;top:0;width:24px;height:100%;background:${GREEN}}
.dark{background:${INK};color:#fff}
.green{background:${GREEN};color:#fff}
.hero{display:flex;flex-direction:column;justify-content:center}
.kicker{font-size:30px;font-weight:700;letter-spacing:4px;text-transform:uppercase;color:${GREEN};margin-bottom:28px}
.green .kicker{color:${INK}}
h1{font-size:104px;line-height:1.05;font-weight:800;max-width:1500px}
h2{font-size:68px;line-height:1.1;font-weight:800;max-width:1600px}
.sub{font-size:38px;line-height:1.35;margin-top:28px;color:${MUTED};max-width:1500px}
.dark .sub,.green .sub{color:rgba(255,255,255,.88)}
.bar{width:220px;height:12px;background:${GREEN};margin-top:56px}
ul.points{margin-top:64px;list-style:none;display:flex;flex-direction:column;gap:30px;max-width:1600px}
ul.points li{font-size:40px;line-height:1.3;padding-left:56px;position:relative}
ul.points li::before{content:"";position:absolute;left:0;top:14px;width:22px;height:22px;background:${GREEN};border-radius:4px}
.cols{margin-top:64px;display:flex;gap:40px}
.card{flex:1;background:#F3F7F0;border-top:10px solid ${GREEN};padding:44px 40px;border-radius:8px}
.card h3{font-size:40px;font-weight:800;margin-bottom:20px}
.card p,.card li{font-size:29px;line-height:1.4;color:${MUTED}}
.card ul{margin-top:16px;padding-left:30px}
.stats{margin-top:90px;display:flex;gap:48px}
.stat{flex:1;border-left:10px solid ${GREEN};padding:10px 0 10px 40px}
.num{font-size:120px;font-weight:800;color:${GREEN};line-height:1}
.lbl{font-size:32px;line-height:1.35;margin-top:22px;color:${MUTED}}
.quote{display:flex;flex-direction:column;justify-content:center}
.mark{font-size:260px;line-height:.6;color:${GREEN};font-weight:800;height:120px}
blockquote{font-size:64px;line-height:1.3;font-weight:600;max-width:1550px}
.by{font-size:34px;margin-top:40px;color:${MUTED}}
footer{position:absolute;left:140px;right:140px;bottom:56px;display:flex;align-items:center;gap:32px;font-size:24px;color:${MUTED}}
.dark footer,.green footer{color:rgba(255,255,255,.8)}
footer .logo{height:56px}
footer .word{font-size:36px;font-weight:800;color:${GREEN};letter-spacing:2px}
.green footer .word{color:#fff}
</style></head><body>${body(slide, layout, footer)}</body></html>`;
}

/**
 * Renders text slides to 1920x1080 PNGs, in one browser session.
 * `slides` is an array of `{ index, slide }`; the result maps each index to PNG bytes.
 */
export async function renderSlides(slides, meta = {}) {
  const pngs = new Map();
  if (slides.length === 0) return pngs;
  let chromium;
  try {
    ({ chromium } = await import(pathToFileURL(PLAYWRIGHT).href));
  } catch (error) {
    throw new Error(
      `The slide renderer is not available on this computer (${error.message}).`,
    );
  }
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.OCSC_CHROMIUM
      ? { executablePath: process.env.OCSC_CHROMIUM }
      : {}),
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    const tab = await context.newPage();
    for (const { index, slide, label } of slides) {
      const layout = layoutOf(slide);
      if (!layout)
        throw new Error(
          `${label}: layout must be one of ${LAYOUTS.join(", ")}.`,
        );
      await tab.setContent(page(slide, layout, meta), {
        waitUntil: "load",
        timeout: 60_000,
      });
      await tab.evaluate(() => document.fonts.ready);
      pngs.set(index, await tab.screenshot({ type: "png" }));
    }
  } finally {
    await browser.close();
  }
  return pngs;
}
