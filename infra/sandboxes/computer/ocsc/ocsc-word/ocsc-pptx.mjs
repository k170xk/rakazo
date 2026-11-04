#!/usr/bin/env node
/**
 * OCSC PowerPoint: build a 16:9 OCSC PowerPoint deck on a Bot's computer, from slides written
 * as text (drawn by slides.mjs) or from slide images.
 *
 *   ocsc-pptx new  --spec deck.json --out outputs/Deck.pptx
 *   ocsc-pptx read --in outputs/Deck.pptx
 *   ocsc-pptx edit --in outputs/Deck.pptx --spec edits.json [--out outputs/Deck-v2.pptx]
 *
 * deck.json:  { "title": "...", "slides": [ { "layout": "bullets", "title": "...", "bullets": ["..."], "notes": "..." },
 *               { "image": "https://... or workspace path", "title": "...", "notes": "..." } ] }
 * edits.json: { "edits": [ { "op": "replace", "slide": 2, "image": "..." }, { "op": "insert", "at": 3, "image": "..." },
 *               { "op": "remove", "slide": 4 }, { "op": "move", "from": 5, "to": 1 }, { "op": "notes", "slide": 1, "notes": "..." } ] }
 *
 * Every command prints one JSON object. `new` and `edit` include `link`, a markdown link the Bot
 * pastes into its reply so the person gets a download card.
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
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import { isTextSlide, renderSlides } from "./slides.mjs";

const WORKSPACE =
  process.env.WORKSPACE_DIR || process.env.HOME || process.cwd();
// PowerPoint's own widescreen size, 13.333 x 7.5 inches.
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const MAX_SLIDES = 60;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

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
  if (!/\.pptx$/i.test(out.full))
    throw new UsageError("--out must end in .pptx.");
  return out;
}

// ---------- images ----------

/** Width, height and type of a PNG or JPEG, read from its header. Anything else is refused. */
function imageInfo(bytes, label) {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return {
      type: "png",
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
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
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker)
      ) {
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
    `${label} is not a PNG or JPEG image. Save it as PNG first.`,
  );
}

/** An image from an https URL or a workspace path, as bytes. */
function loadImage(source, label) {
  if (typeof source !== "string" || !source.trim())
    throw new UsageError(`${label}: image is required.`);
  const value = source.trim();
  let bytes;
  if (/^https:\/\//i.test(value)) {
    const dir = mkdtempSync(join(tmpdir(), "ocsc-pptx-"));
    const file = join(dir, "image");
    try {
      // curl rather than fetch: it honours the computer's egress proxy.
      execFileSync(
        "curl",
        [
          "-fsSL",
          "--proto",
          "=https",
          "--max-time",
          "90",
          "--retry",
          "2",
          "--max-filesize",
          String(MAX_IMAGE_BYTES),
          "-o",
          file,
          value,
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      bytes = readFileSync(file);
    } catch (error) {
      const reason = String(error?.stderr || error?.message || error)
        .trim()
        .split("\n")
        .pop();
      throw new UsageError(
        `${label}: could not download ${value} (${reason}).`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } else if (/^[a-z]+:/i.test(value)) {
    throw new UsageError(
      `${label}: only https URLs or workspace paths are accepted.`,
    );
  } else {
    const { full } = inWorkspace(value, `${label} image`);
    if (!existsSync(full))
      throw new UsageError(`${label}: ${value} does not exist.`);
    if (statSync(full).size > MAX_IMAGE_BYTES)
      throw new UsageError(`${label}: ${value} is larger than 25 MB.`);
    bytes = readFileSync(full);
  }
  return { bytes, ...imageInfo(bytes, label) };
}

/**
 * Images for a set of slides: an "image" is loaded, and a slide written as text is drawn as
 * an OCSC slide. `entries` is `[{ key, item, label }]`; the result maps each key to an image.
 */
async function slideImages(entries, meta) {
  const images = new Map();
  const text = [];
  for (const { key, item, label } of entries) {
    if (isTextSlide(item)) text.push({ index: key, slide: item, label });
    else
      images.set(
        key,
        loadImage(typeof item === "string" ? item : item?.image, label),
      );
  }
  try {
    for (const [key, bytes] of await renderSlides(text, meta))
      images.set(key, { bytes, ...imageInfo(bytes, "Slide") });
  } catch (error) {
    throw new UsageError(error.message);
  }
  return images;
}

/** Centred and scaled to fit the slide without cropping. A 16:9 image fills it exactly. */
function fit(width, height) {
  const aspect = width / height;
  if (aspect >= SLIDE_W / SLIDE_H) {
    const h = SLIDE_W / aspect;
    return { x: 0, y: (SLIDE_H - h) / 2, w: SLIDE_W, h };
  }
  const w = SLIDE_H * aspect;
  return { x: (SLIDE_W - w) / 2, y: 0, w, h: SLIDE_H };
}

// ---------- writing ----------

function cleanText(value, max) {
  return typeof value === "string"
    ? value
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
        .slice(0, max)
    : "";
}

/** Writes slides of `{ image: {bytes,type,width,height}, title, notes }` as a 16:9 deck. */
async function writeDeck(slides, meta, out) {
  if (slides.length === 0)
    throw new UsageError("A deck needs at least one slide.");
  if (slides.length > MAX_SLIDES)
    throw new UsageError(`A deck can hold at most ${MAX_SLIDES} slides.`);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.company = "OCSC";
  pptx.author = cleanText(meta.author, 200) || "OCSC";
  pptx.title = cleanText(meta.title, 200) || basename(out.rel, ".pptx");
  for (const [index, slide] of slides.entries()) {
    const page = pptx.addSlide();
    page.background = {
      color: /^[0-9a-f]{6}$/i.test(meta.background || "")
        ? meta.background
        : "FFFFFF",
    };
    const title = cleanText(slide.title, 300);
    page.addImage({
      data: `image/${slide.image.type};base64,${slide.image.bytes.toString("base64")}`,
      ...fit(slide.image.width, slide.image.height),
      altText: title || `Slide ${index + 1}`,
    });
    const notes = cleanText(slide.notes, 20000);
    if (notes) page.addNotes(notes);
  }
  const buffer = await pptx.write({ outputType: "nodebuffer" });
  mkdirSync(dirname(out.full), { recursive: true });
  writeFileSync(out.full, buffer);
  return buffer.length;
}

// ---------- reading ----------

function attr(xml, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(xml);
  return match ? unesc(match[1]) : "";
}

function unesc(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");
}

function rels(xml) {
  const out = new Map();
  for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    out.set(attr(match[0], "Id"), {
      target: attr(match[0], "Target"),
      type: attr(match[0], "Type"),
    });
  }
  return out;
}

function resolvePart(from, target) {
  const parts = dirname(from).split("/");
  for (const piece of target.split("/")) {
    if (piece === "..") parts.pop();
    else if (piece !== ".") parts.push(piece);
  }
  return parts.join("/");
}

function notesText(xml) {
  const paragraphs = [];
  for (const sp of xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
    if (!/<p:ph\b[^>]*type="body"/.test(sp[0])) continue;
    for (const para of sp[0].matchAll(/<a:p>[\s\S]*?<\/a:p>|<a:p\/>/g)) {
      paragraphs.push(
        [...para[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
          .map((t) => unesc(t[1]))
          .join(""),
      );
    }
  }
  return paragraphs.join("\n").replace(/\r\n?/g, "\n").trim();
}

/** The slides of a deck as `{ image, title, notes }`, in order. Only picture slides can be edited. */
async function readDeck(path) {
  const { full, rel } = inWorkspace(path, "--in");
  if (!existsSync(full)) throw new UsageError(`${rel} does not exist.`);
  let zip;
  try {
    zip = await JSZip.loadAsync(readFileSync(full));
  } catch {
    throw new UsageError(`${rel} is not a PowerPoint file.`);
  }
  const presentation = await zip.file("ppt/presentation.xml")?.async("string");
  const presentationRels = await zip
    .file("ppt/_rels/presentation.xml.rels")
    ?.async("string");
  if (!presentation || !presentationRels)
    throw new UsageError(`${rel} is not a PowerPoint file.`);
  const size = /<p:sldSz\b[^>]*>/.exec(presentation)?.[0] ?? "";
  const cx = Number(attr(size, "cx"));
  const cy = Number(attr(size, "cy"));
  const map = rels(presentationRels);
  const slides = [];
  for (const id of presentation.matchAll(/<p:sldId\b[^>]*>/g)) {
    const target = map.get(attr(id[0], "r:id"))?.target;
    if (!target) continue;
    const part = resolvePart("ppt/presentation.xml", target);
    const xml = (await zip.file(part)?.async("string")) ?? "";
    const slideRels = rels(
      (await zip
        .file(resolvePart(part, `_rels/${basename(part)}.rels`))
        ?.async("string")) ?? "",
    );
    const pictures = [...xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)];
    const textShapes = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].filter(
      (sp) => /<a:t>/.test(sp[0]),
    );
    const editable = pictures.length === 1 && textShapes.length === 0;
    let image = null;
    let title = "";
    if (pictures.length > 0) {
      const pic = pictures[0][0];
      title = attr(/<p:cNvPr\b[^>]*>/.exec(pic)?.[0] ?? "", "descr");
      const embed = attr(/<a:blip\b[^>]*>/.exec(pic)?.[0] ?? "", "r:embed");
      const media = slideRels.get(embed)?.target;
      if (media) {
        const bytes = await zip
          .file(resolvePart(part, media))
          ?.async("nodebuffer");
        if (bytes) {
          try {
            image = {
              bytes,
              ...imageInfo(bytes, `Slide ${slides.length + 1}`),
            };
          } catch {
            image = null;
          }
        }
      }
    }
    let notes = "";
    for (const relation of slideRels.values()) {
      if (!relation.type.endsWith("/notesSlide")) continue;
      notes = notesText(
        (await zip.file(resolvePart(part, relation.target))?.async("string")) ??
          "",
      );
    }
    slides.push({ image, title, notes, editable: editable && image !== null });
  }
  return {
    rel,
    slides,
    widescreen: cx > 0 && cy > 0 && Math.abs(cx / cy - 16 / 9) < 0.01,
    size: { cx, cy },
  };
}

// ---------- commands ----------

async function cmdNew(opts) {
  const spec = readSpec(opts.spec);
  const items = Array.isArray(spec?.slides) ? spec.slides : null;
  if (!items || items.length === 0)
    throw new UsageError(
      'The spec needs "slides": [{ "title": "...", "bullets": [...] }] or [{ "image": "..." }].',
    );
  if (items.length > MAX_SLIDES)
    throw new UsageError(`A deck can hold at most ${MAX_SLIDES} slides.`);
  const out = outPath(opts.out);
  const images = await slideImages(
    items.map((item, index) => ({ key: index, item, label: `Slide ${index + 1}` })),
    spec,
  );
  const slides = items.map((item, index) => ({
    image: images.get(index),
    title: typeof item === "object" ? item.title : "",
    notes: typeof item === "object" ? item.notes : "",
  }));
  const bytes = await writeDeck(slides, spec, out);
  return {
    ok: true,
    slides: slides.length,
    aspect: "16:9",
    letterboxed: slides
      .map((s, i) =>
        Math.abs(s.image.width / s.image.height - 16 / 9) > 0.01 ? i + 1 : 0,
      )
      .filter(Boolean),
    bytes,
    ...downloadLink(out.rel),
  };
}

async function cmdRead(opts) {
  const deck = await readDeck(opts.in);
  return {
    ok: true,
    path: deck.rel,
    aspect: deck.widescreen ? "16:9" : "other",
    slides: deck.slides.map((slide, index) => ({
      slide: index + 1,
      title: slide.title,
      notes: slide.notes,
      image: slide.image
        ? `${slide.image.width}x${slide.image.height} ${slide.image.type}`
        : null,
      editable: slide.editable,
    })),
  };
}

function position(value, count, label, allowEnd = false) {
  const n = Number(value);
  const max = allowEnd ? count + 1 : count;
  if (!Number.isInteger(n) || n < 1 || n > max)
    throw new UsageError(`${label} must be a slide number from 1 to ${max}.`);
  return n - 1;
}

async function cmdEdit(opts) {
  const deck = await readDeck(opts.in);
  const locked = deck.slides.findIndex((slide) => !slide.editable);
  if (locked !== -1) {
    throw new UsageError(
      `Slide ${locked + 1} is not a single picture, so this deck was not made by ocsc-pptx and cannot be edited with it.`,
    );
  }
  const spec = readSpec(opts.spec);
  const edits = Array.isArray(spec?.edits) ? spec.edits : null;
  if (!edits || edits.length === 0)
    throw new UsageError('The spec needs "edits": [...].');
  const slides = deck.slides.map(({ image, title, notes }) => ({
    image,
    title,
    notes,
  }));
  const fresh = await slideImages(
    edits
      .map((edit, index) => ({ key: index, item: edit, label: `Edit ${index + 1}` }))
      .filter(({ item }) => item?.op === "replace" || item?.op === "insert"),
    { title: spec.title || deck.title, footer: spec.footer },
  );
  const summary = [];
  for (const [index, edit] of edits.entries()) {
    const label = `Edit ${index + 1}`;
    switch (edit?.op) {
      case "replace": {
        const at = position(edit.slide, slides.length, `${label} slide`);
        slides[at] = {
          image: fresh.get(index),
          title: edit.title ?? slides[at].title,
          notes: edit.notes ?? slides[at].notes,
        };
        summary.push(`Replaced slide ${at + 1}.`);
        break;
      }
      case "insert": {
        const at =
          edit.at === undefined
            ? slides.length
            : position(edit.at, slides.length, `${label} at`, true);
        slides.splice(at, 0, {
          image: fresh.get(index),
          title: edit.title ?? "",
          notes: edit.notes ?? "",
        });
        summary.push(`Inserted a slide at position ${at + 1}.`);
        break;
      }
      case "remove": {
        const at = position(edit.slide, slides.length, `${label} slide`);
        if (slides.length === 1)
          throw new UsageError(
            `${label}: a deck must keep at least one slide.`,
          );
        slides.splice(at, 1);
        summary.push(`Removed slide ${at + 1}.`);
        break;
      }
      case "move": {
        const from = position(edit.from, slides.length, `${label} from`);
        const to = position(edit.to, slides.length, `${label} to`);
        const [moved] = slides.splice(from, 1);
        slides.splice(to, 0, moved);
        summary.push(`Moved slide ${from + 1} to position ${to + 1}.`);
        break;
      }
      case "notes": {
        const at = position(edit.slide, slides.length, `${label} slide`);
        slides[at].notes = typeof edit.notes === "string" ? edit.notes : "";
        summary.push(`Updated the speaker notes on slide ${at + 1}.`);
        break;
      }
      case "title": {
        const at = position(edit.slide, slides.length, `${label} slide`);
        slides[at].title = typeof edit.title === "string" ? edit.title : "";
        summary.push(`Renamed slide ${at + 1}.`);
        break;
      }
      default:
        throw new UsageError(
          `${label}: op must be replace, insert, remove, move, notes or title.`,
        );
    }
  }
  const out = outPath(opts.out || opts.in);
  const bytes = await writeDeck(
    slides,
    { title: spec.title, background: spec.background },
    out,
  );
  return {
    ok: true,
    slides: slides.length,
    aspect: "16:9",
    summary,
    bytes,
    ...downloadLink(out.rel),
  };
}

const USAGE = `ocsc-pptx new --spec deck.json --out outputs/Deck.pptx
ocsc-pptx read --in outputs/Deck.pptx
ocsc-pptx edit --in outputs/Deck.pptx --spec edits.json [--out outputs/Deck-v2.pptx]`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const opts = args(rest);
  try {
    let result;
    if (command === "new") result = await cmdNew(opts);
    else if (command === "read") result = await cmdRead(opts);
    else if (command === "edit") result = await cmdEdit(opts);
    else throw new UsageError(`Usage:\n${USAGE}`);
    if (command !== "read" && result.ok && result.path) {
      try {
        const { showOnScreen } = await import("./screen.mjs");
        Object.assign(
          result,
          await showOnScreen(resolve(WORKSPACE, result.path), result.path),
        );
      } catch {}
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: error instanceof UsageError ? error.message : String(error?.stack || error) }, null, 2)}\n`,
    );
    process.exit(1);
  }
}

main();
