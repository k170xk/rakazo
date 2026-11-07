#!/usr/bin/env node
/**
 * OCSC PowerPoint: build, read, preview and edit 16:9 PowerPoint decks on a Bot's computer.
 *
 *   ocsc-pptx new     --spec deck.json --out outputs/Deck.pptx
 *   ocsc-pptx layouts [--template their-template.pptx]
 *   ocsc-pptx read    --in outputs/Deck.pptx
 *   ocsc-pptx preview --in outputs/Deck.pptx [--slide 3] [--out work/preview]
 *   ocsc-pptx edit    --in Deck.pptx --spec edits.json --out outputs/Deck-v2.pptx [--clean]
 *
 * `new` builds on the OCSC company template by default, filling its layouts' placeholders
 * (pptx-template.mjs); slides it has no layout for, and every slide with "template": "none", are
 * drawn as native, editable PowerPoint objects (pptx-native.mjs). `edit`
 * changes any deck, including ones the person uploaded, and leaves a review comment on every
 * slide it changed (pptx-package.mjs). Every command prints one JSON object.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import PptxGenJS from "pptxgenjs";
import { imageSources, isPictureSlide, SlideBuilder, videoSources } from "./pptx-native.mjs";
import { applyEdits, readDeck } from "./pptx-package.mjs";
import {
  buildFromTemplate,
  describeTemplate,
  insertTemplateSlide,
  OCSC_TEMPLATE,
  templateImageSources,
} from "./pptx-template.mjs";

const WORKSPACE = process.env.WORKSPACE_DIR || process.env.HOME || process.cwd();
const MAX_SLIDES = 60;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 150 * 1024 * 1024;

class UsageError extends Error {}

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else {
        out[key] = next;
        i += 1;
      }
    } else out._.push(a);
  }
  return out;
}

/** A path inside the workspace. Absolute paths and escapes are refused. */
function inWorkspace(p, label) {
  if (typeof p !== "string" || !p.trim()) throw new UsageError(`${label} is required.`);
  const full = isAbsolute(p) ? resolve(p) : resolve(WORKSPACE, p);
  const rel = relative(WORKSPACE, full);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new UsageError(`${label} must be inside the workspace (${WORKSPACE}).`);
  }
  return { full, rel: rel.split("\\").join("/") };
}

function readSpec(path) {
  const { full } = inWorkspace(path, "--spec");
  try {
    return JSON.parse(readFileSync(full, "utf8"));
  } catch (error) {
    throw new UsageError(`Could not read ${path} as JSON: ${error.message}`);
  }
}

function downloadLink(rel) {
  const name = basename(rel);
  const bot = process.env.COMPUTER_BOT_ID;
  if (!bot) return { name, path: rel };
  const url = `/api/computers/${encodeURIComponent(bot)}/files/download?path=${encodeURIComponent(rel)}`;
  return { name, path: rel, url, link: `[${name}](${url})` };
}

function outPath(p) {
  const out = inWorkspace(p, "--out");
  if (!/\.pptx$/i.test(out.full)) throw new UsageError("--out must end in .pptx.");
  return out;
}

function deckPath(p) {
  const deck = inWorkspace(p, "--in");
  if (!existsSync(deck.full)) throw new UsageError(`${deck.rel} does not exist.`);
  return deck;
}

// ---------- media ----------

/** Width, height and type of a PNG or JPEG, read from its header. Anything else is refused. */
function imageInfo(bytes, label) {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { type: "png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = bytes[i + 1];
      const length = bytes.readUInt16BE(i + 2);
      // Start-of-frame markers carry the size; C4, C8 and CC are tables, not frames.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return {
          type: "jpeg",
          height: bytes.readUInt16BE(i + 5),
          width: bytes.readUInt16BE(i + 7),
        };
      }
      i += 2 + length;
    }
  }
  throw new UsageError(
    `${label} is not a PNG or JPEG image. Save it as PNG first (for example: ocsc-video fetch, or convert it with python3 -c "from PIL import Image; Image.open('in.webp').save('out.png')").`,
  );
}

function download(url, label, maxBytes) {
  const dir = mkdtempSync(join(tmpdir(), "ocsc-pptx-"));
  const file = join(dir, "media");
  try {
    // curl rather than fetch: it honours the computer's egress proxy.
    execFileSync(
      "curl",
      [
        "-fsSL",
        "--proto",
        "=https",
        "--max-time",
        "120",
        "--retry",
        "2",
        "--max-filesize",
        String(maxBytes),
        "-o",
        file,
        url,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    return readFileSync(file);
  } catch (error) {
    const reason = String(error?.stderr || error?.message || error)
      .trim()
      .split("\n")
      .pop();
    throw new UsageError(`${label}: could not download ${url} (${reason}).`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function localFile(value, label, maxBytes) {
  const { full } = inWorkspace(value, label);
  if (!existsSync(full)) throw new UsageError(`${label}: ${value} does not exist.`);
  if (statSync(full).size > maxBytes)
    throw new UsageError(`${label}: ${value} is larger than ${Math.round(maxBytes / 1048576)} MB.`);
  return readFileSync(full);
}

/** An image from an https URL or a workspace path, as `{ bytes, type, width, height }`. */
function loadImage(source, label) {
  if (typeof source !== "string" || !source.trim())
    throw new UsageError(`${label}: image is required.`);
  const value = source.trim();
  if (/^[a-z]+:/i.test(value) && !/^https:\/\//i.test(value))
    throw new UsageError(`${label}: only https URLs or workspace paths are accepted.`);
  const bytes = /^https:\/\//i.test(value)
    ? download(value, label, MAX_IMAGE_BYTES)
    : localFile(value, label, MAX_IMAGE_BYTES);
  return { bytes, ...imageInfo(bytes, label) };
}

function loadVideo(source, label) {
  const value = String(source ?? "").trim();
  if (!/\.mp4$/i.test(value.split("?")[0]))
    throw new UsageError(`${label}: a video must be an .mp4.`);
  const bytes = /^https:\/\//i.test(value)
    ? download(value, label, MAX_VIDEO_BYTES)
    : localFile(value, label, MAX_VIDEO_BYTES);
  return bytes;
}

/** Loads every picture and video the slides refer to, once each. */
function loadMedia(items, labelOf) {
  const images = new Map();
  const videos = new Map();
  for (const [index, item] of items.entries()) {
    const label = labelOf(index);
    for (const { source, label: where } of [
      ...imageSources(item, label),
      ...templateImageSources(item, label),
    ])
      if (!images.has(source)) images.set(source, loadImage(source, where));
    for (const { source, label: where } of videoSources(item, label))
      if (!videos.has(source.trim())) videos.set(source.trim(), loadVideo(source, where));
  }
  return { images, videos };
}

// ---------- visuals ----------

/** Where a slide's visual sits on the 1920x1080 grid: the whole content area, or beside its text. */
const VISUAL_FULL = { x: 72, y: 168, w: 1776, h: 720 };
const VISUAL_SIDE = { x: 800, y: 168, w: 1048, h: 720 };
const TEXT_SIDE = { x: 72, y: 168, w: 680, h: 720 };

const str = (value) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

/** Whether a deck has the template's plain heading-only layout, which large visuals sit on. */
async function hasPlainLayout(bytes) {
  try {
    return (await describeTemplate(bytes)).layouts.some((l) => l.layout === "plain");
  } catch {
    return false;
  }
}

const hasText = (item) =>
  ["bullets", "body", "text"].some((key) =>
    Array.isArray(item[key]) ? item[key].length > 0 : Boolean(str(item[key])),
  );

/**
 * Renders a slide's Remotion scene with ocsc-video, unbranded and shaped to the space it fills,
 * and returns the PNG's workspace path.
 */
function renderVisual(visual, box, name, label, caption) {
  const duration = Math.min(Math.max(Number(visual.duration) || 4, 1), 20);
  const { at, ...rest } = visual;
  const props = rest.props && typeof rest.props === "object" ? { ...rest.props } : {};
  // A missing or empty title would show the template's sample title instead.
  if ((rest.type ?? "template") === "template" && !str(props.title).trim() && caption)
    props.title = caption;
  const scene = { type: "template", ...rest, props, branded: false, duration };
  // Scenes are laid out for a 1080-high frame; the width follows the space the visual fills.
  const width = Math.round((1080 * box.w) / box.h / 2) * 2;
  const spec = {
    title: "Slide visual",
    settings: { width, height: 1080, fps: 30, show_skyline_footer: false },
    scenes: [scene, { type: "closing", heading: "End", duration: 4 }],
  };
  const dir = inWorkspace("work/visuals", "visuals folder");
  mkdirSync(dir.full, { recursive: true });
  const specRel = `${dir.rel}/${name}.video.json`;
  const pngRel = `${dir.rel}/${name}.png`;
  writeFileSync(join(dir.full, `${name}.video.json`), JSON.stringify(spec, null, 1));
  let output = "";
  try {
    output = execFileSync(
      "ocsc-video",
      [
        "still",
        "--spec",
        specRel,
        "--scene",
        "1",
        "--at",
        String(Number(at) || duration * 0.9),
        "--out",
        pngRel,
      ],
      { cwd: WORKSPACE, encoding: "utf8", timeout: 240000, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    output = String(error?.stdout || "");
    if (!output)
      throw new UsageError(
        `${label} visual: ocsc-video failed (${String(error?.message || error).split("\n")[0]}).`,
      );
  }
  let result = null;
  try {
    result = JSON.parse(output);
  } catch {}
  if (!result?.ok)
    throw new UsageError(
      `${label} visual: ${result?.error ?? "ocsc-video could not render the scene"}. Check the template name and props with ocsc-video templates --name <template>.`,
    );
  return pngRel;
}

/**
 * Turns each slide's "visual" (a picture, or a Remotion scene that is rendered here) into
 * pictures on the slide. A slide whose layout is "visual", or that has no layout, shows the
 * visual large under its heading, beside its text when it has any.
 */
function placeVisuals(items, { plain, name, labelOf }) {
  return items.map((item, index) => {
    if (!item || typeof item !== "object" || item.visual === undefined) return item;
    const label = labelOf(index);
    const { visual, ...rest } = item;
    const layout = rest.layout ?? "visual";
    const side = layout === "visual" && hasText(rest);
    let source;
    if (typeof visual === "string" && visual.trim()) source = visual.trim();
    else if (visual && typeof visual === "object" && (visual.template || visual.type))
      source = renderVisual(
        visual,
        side ? VISUAL_SIDE : VISUAL_FULL,
        `${name}-slide-${index + 1}`,
        label,
        str(rest.subheading ?? rest.subtitle ?? rest.heading ?? rest.title),
      );
    else
      throw new UsageError(
        `${label}: "visual" must be a picture (an https URL or workspace PNG/JPEG) or a Remotion scene such as {"template": "progress-steps", "props": {...}}.`,
      );
    if (layout !== "visual") {
      if (rest.image || rest.images)
        throw new UsageError(
          `${label}: give the picture as "visual" or "image", not both, or use "layout": "visual".`,
        );
      return { ...rest, image: source, fit: "contain" };
    }
    if (!plain)
      return {
        ...rest,
        layout: "split",
        image: source,
        fit: "contain",
        bullets: rest.bullets ?? [],
      };
    const overlay = [
      ...(Array.isArray(rest.overlay) ? rest.overlay : []),
      { image: source, ...(side ? VISUAL_SIDE : VISUAL_FULL), fit: "contain" },
    ];
    return { ...rest, layout: "plain", overlay, ...(side ? { __textBox: TEXT_SIDE } : {}) };
  });
}

/** A PptxGenJS deck holding `items` as OCSC slides; returns the deck and which slides were letterboxed. */
function buildDeck(items, meta, media, labelOf) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.company = "OCSC";
  pptx.author = String(meta.author || "OCSC").slice(0, 200);
  pptx.title = String(meta.title || "OCSC presentation").slice(0, 200);
  pptx.theme = { headFontFace: "Arial", bodyFontFace: "Arial" };
  const builder = new SlideBuilder(pptx, meta, media.images, media.videos);
  const letterboxed = [];
  for (const [index, item] of items.entries()) {
    const label = labelOf(index);
    try {
      if (isPictureSlide(item)) {
        if (builder.addPicture(item, label).letterboxed) letterboxed.push(index + 1);
      } else if (item && typeof item === "object") builder.add(item, label);
      else throw new Error(`${label} must be an object.`);
    } catch (error) {
      throw new UsageError(error.message);
    }
  }
  return { pptx, letterboxed };
}

// ---------- commands ----------

async function cmdNew(opts) {
  const spec = readSpec(opts.spec);
  const specItems = Array.isArray(spec?.slides) ? spec.slides : null;
  if (!specItems || specItems.length === 0)
    throw new UsageError(
      'The spec needs "slides": [{ "layout": "bullets", "title": "...", "bullets": [...] }, ...].',
    );
  if (specItems.length > MAX_SLIDES)
    throw new UsageError(`A deck can hold at most ${MAX_SLIDES} slides.`);
  const out = outPath(opts.out);
  const labelOf = (i) => `Slide ${i + 1}`;
  const template = templateFile(spec.template);
  const items = placeVisuals(specItems, {
    plain: template ? await hasPlainLayout(readFileSync(template.full)) : false,
    name: basename(out.rel, ".pptx"),
    labelOf,
  });
  const media = loadMedia(items, labelOf);
  let buffer;
  let letterboxed = [];
  if (template) {
    try {
      buffer = await buildFromTemplate(readFileSync(template.full), items, {
        images: media.images,
        labelOf,
        meta: spec,
        buildSlides: (list) =>
          buildDeck(list, spec, media, (i) => list[i].__label ?? labelOf(i)).pptx.write({
            outputType: "nodebuffer",
          }),
      });
    } catch (error) {
      throw error instanceof UsageError ? error : new UsageError(error.message);
    }
  } else {
    const built = buildDeck(items, spec, media, labelOf);
    letterboxed = built.letterboxed;
    buffer = await built.pptx.write({ outputType: "nodebuffer" });
  }
  mkdirSync(dirname(out.full), { recursive: true });
  writeFileSync(out.full, buffer);
  return {
    ok: true,
    slides: items.length,
    aspect: "16:9",
    editable: true,
    template: template ? template.rel : "none",
    letterboxed,
    bytes: buffer.length,
    ...downloadLink(out.rel),
  };
}

/** The template a spec asks for: the OCSC one by default, "none" for none, or a workspace .pptx. */
function templateFile(value) {
  if (value === "none" || value === false) return null;
  if (value === undefined || value === null || value === "ocsc") {
    if (!existsSync(OCSC_TEMPLATE)) {
      if (value === "ocsc")
        throw new UsageError("The OCSC company template is not on this computer.");
      return null;
    }
    return { full: OCSC_TEMPLATE, rel: "ocsc" };
  }
  const file = inWorkspace(String(value), "template");
  if (!/\.pptx$/i.test(file.full) || !existsSync(file.full))
    throw new UsageError(`template: ${value} is not a .pptx in the workspace.`);
  return file;
}

async function cmdLayouts(opts) {
  const template = templateFile(opts.template === undefined ? "ocsc" : opts.template);
  if (!template) throw new UsageError("--template must be a .pptx in the workspace.");
  try {
    return {
      ok: true,
      template: template.rel,
      ...(await describeTemplate(readFileSync(template.full))),
    };
  } catch (error) {
    throw new UsageError(error.message);
  }
}

async function cmdRead(opts) {
  const deck = deckPath(opts.in);
  try {
    return { ok: true, path: deck.rel, ...(await readDeck(readFileSync(deck.full))) };
  } catch (error) {
    throw new UsageError(`${deck.rel}: ${error.message}`);
  }
}

async function cmdPreview(opts) {
  const deck = deckPath(opts.in);
  const dir = inWorkspace(opts.out || `work/preview/${basename(deck.rel, ".pptx")}`, "--out");
  const only = opts.slide === undefined ? null : Number(opts.slide);
  const { renderDeckPngs } = await import("./pptx-render.mjs");
  let pngs;
  try {
    pngs = await renderDeckPngs(readFileSync(deck.full), only);
  } catch (error) {
    throw new UsageError(error.message);
  }
  mkdirSync(dir.full, { recursive: true });
  const files = [];
  for (const [number, png] of pngs) {
    const name = `slide-${String(number).padStart(2, "0")}.png`;
    writeFileSync(join(dir.full, name), png);
    files.push(`${dir.rel}/${name}`);
  }
  return { ok: true, path: deck.rel, previews: files };
}

async function cmdEdit(opts) {
  const deck = deckPath(opts.in);
  const spec = readSpec(opts.spec);
  const edits = Array.isArray(spec?.edits) ? spec.edits : null;
  if (!edits || edits.length === 0) throw new UsageError('The spec needs "edits": [...].');
  const out = outPath(opts.out || opts.in);
  const labelOf = (i) => `Edit ${i + 1}`;
  const placed = placeVisuals(
    edits.map((edit) => (edit?.op === "insert" || edit?.op === "replace" ? edit : null)),
    {
      plain: await hasPlainLayout(readFileSync(deck.full)),
      name: basename(out.rel, ".pptx"),
      labelOf,
    },
  );
  for (const [i, edit] of placed.entries()) if (edit) edits[i] = edit;
  const slideEdits = edits.map((edit) =>
    edit?.op === "insert" || edit?.op === "replace" ? edit : {},
  );
  const media = loadMedia(slideEdits, labelOf);
  const replacementImages = new Map();
  for (const [i, edit] of edits.entries())
    if (edit?.op === "replace_image")
      replacementImages.set(i, loadImage(edit.image, `${labelOf(i)} image`));
  let result;
  try {
    result = await applyEdits(readFileSync(deck.full), edits, {
      clean: opts.clean === true,
      meta: { title: spec.title, footer: spec.footer },
      buildSlides: async (items) => {
        const { pptx } = buildDeck(items, spec, media, (i) => items[i].__label);
        return pptx.write({ outputType: "nodebuffer" });
      },
      replacementImages,
      insertSlide: (target, item, at) =>
        insertTemplateSlide(target, item, at, {
          images: media.images,
          buildSlides: (list) =>
            buildDeck(list, spec, media, (i) => list[i].__label).pptx.write({
              outputType: "nodebuffer",
            }),
        }),
    });
  } catch (error) {
    throw new UsageError(error.message);
  }
  mkdirSync(dirname(out.full), { recursive: true });
  writeFileSync(out.full, result.bytes);
  return {
    ok: true,
    slides: result.slides,
    summary: result.summary,
    comments: result.comments,
    bytes: result.bytes.length,
    ...downloadLink(out.rel),
  };
}

const USAGE = `ocsc-pptx new --spec deck.json --out outputs/Deck.pptx
ocsc-pptx layouts [--template their-template.pptx]
ocsc-pptx read --in outputs/Deck.pptx
ocsc-pptx preview --in outputs/Deck.pptx [--slide 3] [--out work/preview]
ocsc-pptx edit --in Deck.pptx --spec edits.json --out outputs/Deck-v2.pptx [--clean]`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const opts = args(rest);
  try {
    let result;
    if (command === "new") result = await cmdNew(opts);
    else if (command === "read") result = await cmdRead(opts);
    else if (command === "layouts") result = await cmdLayouts(opts);
    else if (command === "preview") result = await cmdPreview(opts);
    else if (command === "edit") result = await cmdEdit(opts);
    else throw new UsageError(`Usage:\n${USAGE}`);
    if ((command === "new" || command === "edit") && result.ok && result.path) {
      try {
        const { showOnScreen } = await import("./screen.mjs");
        Object.assign(result, await showOnScreen(resolve(WORKSPACE, result.path), result.path));
      } catch {}
    }
    // Exit once printed: a preview's browser can linger after closing.
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, () => process.exit(0));
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: error instanceof UsageError ? error.message : String(error?.stack || error) }, null, 2)}\n`,
    );
    process.exit(1);
  }
}

main();
