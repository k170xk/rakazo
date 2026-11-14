// Checks the Presentation studio's slide and shape operations against a real OCSC deck: each edit
// is applied with office-kit, validated, saved, reloaded and compared with `ocsc pptx read`, and
// the assistant's `ocsc pptx edit` must still work on the result.
// Run from the repo root after run.mjs --keep (or pass a deck):
//   node apps/web/scripts/office-fidelity/slides-ops.mjs [path/to/Deck.pptx]
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as p from "@office-kit/pptx";
import { renderSlideToSvg } from "@office-kit/pptx-preview";

const here = path.dirname(fileURLToPath(import.meta.url));
const ocsc = path.resolve(here, "../../../../infra/sandboxes/computer/ocsc/ocsc-word");
const JSZip = createRequire(path.join(ocsc, "package.json"))("jszip");
const sourceDeck =
  process.argv.slice(2).find((arg) => !arg.startsWith("--")) ??
  "/tmp/office-fidelity-outputs/Deck.pptx";
const workspace = mkdtempSync(path.join(tmpdir(), "slides-ops-"));
mkdirSync(path.join(workspace, "outputs"));
mkdirSync(path.join(workspace, "work"));
copyFileSync(sourceDeck, path.join(workspace, "outputs/Deck.pptx"));
const env = {
  ...process.env,
  WORKSPACE_DIR: workspace,
  OCSC_PPTX_TEMPLATE: path.join(ocsc, "templates/ocsc-company.pptx"),
};

function ocscPptx(...args) {
  const out = execFileSync("node", [path.join(ocsc, "ocsc-pptx.mjs"), ...args], {
    cwd: workspace,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const json = JSON.parse(out);
  if (!json.ok) throw new Error(json.error);
  return json;
}

function readOf(rel) {
  const { path: _path, file: _file, ...rest } = ocscPptx("read", "--in", rel);
  return rest;
}

function diff(a, b, at = "") {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((key) => diff(a[key], b[key], `${at}/${key}`));
  }
  const show = (v) => (v === undefined ? "(missing)" : JSON.stringify(v).slice(0, 120));
  return [`${at}: ${show(a)} -> ${show(b)}`];
}

async function parts(beforeRel, afterRel) {
  const load = (rel) => JSZip.loadAsync(readFileSync(path.join(workspace, rel)));
  const [a, b] = await Promise.all([load(beforeRel), load(afterRel)]);
  const names = (zip) => Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const before = new Set(names(a));
  const after = new Set(names(b));
  const changed = [];
  for (const name of before) {
    if (!after.has(name)) continue;
    const [x, y] = await Promise.all([
      a.file(name).async("uint8array"),
      b.file(name).async("uint8array"),
    ]);
    if (Buffer.compare(Buffer.from(x), Buffer.from(y)) !== 0) changed.push(name);
  }
  return {
    lost: [...before].filter((n) => !after.has(n)),
    added: [...after].filter((n) => !before.has(n)),
    changed,
  };
}

const load = async () =>
  p.loadPresentation(new Uint8Array(readFileSync(path.join(workspace, "outputs/Deck.pptx"))));
const slideTexts = (deck) => p.getSlides(deck).map((s) => p.getSlideTitle(s) ?? p.getSlideText(s));

async function check(label, apply, verify) {
  const name = `outputs/${label.replace(/[^a-z0-9]+/gi, "-")}.pptx`;
  try {
    const deck = await load();
    const expected = await apply(deck);
    const validation = p.validatePresentation(deck).map((i) => `${i.severity}: ${i.message}`);
    writeFileSync(path.join(workspace, name), await p.savePresentation(deck));
    const reloaded = await p.loadPresentation(
      new Uint8Array(readFileSync(path.join(workspace, name))),
    );
    const verified = await verify(reloaded, expected);
    let renders = "ok";
    try {
      for (const slide of p.getSlides(reloaded)) renderSlideToSvg(reloaded, slide);
    } catch (error) {
      renders = `failed: ${error.message}`;
    }
    let agent = "ok";
    try {
      ocscPptx(
        "edit",
        "--in",
        name,
        "--out",
        name.replace(/\.pptx$/, "-agent.pptx"),
        "--spec",
        (() => {
          const rel = `work/${path.basename(name)}.json`;
          writeFileSync(
            path.join(workspace, rel),
            JSON.stringify({
              edits: [{ op: "replace_text", find: "Build the model", replace: "Build it" }],
            }),
          );
          return rel;
        })(),
      );
    } catch (error) {
      agent = `failed: ${String(error.message).slice(0, 200)}`;
    }
    return {
      label,
      validation,
      verified,
      renders,
      agent,
      readDiff: diff(readOf("outputs/Deck.pptx"), readOf(name)).slice(0, 12),
      parts: await parts("outputs/Deck.pptx", name),
    };
  } catch (error) {
    return {
      label,
      crashed: String(error?.stack ?? error)
        .split("\n")
        .slice(0, 3)
        .join(" | "),
    };
  }
}

const shapeOn = (deck, slide, text) =>
  p.getSlideShapes(p.getSlides(deck)[slide]).find((s) => p.getShapeText(s) === text);
const ok = (cond, msg) => (cond ? "ok" : `MISMATCH: ${msg}`);

const results = [];

results.push(
  await check(
    "move shape",
    (deck) => {
      const shape = shapeOn(deck, 2, "Walk the site");
      const b = p.getShapeBounds(shape);
      const next = { x: b.x + 254000, y: b.y - 127000, w: b.w, h: b.h };
      p.setShapeBounds(shape, next);
      return next;
    },
    (deck, expected) =>
      ok(
        JSON.stringify(p.getShapeBounds(shapeOn(deck, 2, "Walk the site"))) ===
          JSON.stringify(expected),
        "bounds",
      ),
  ),
);

results.push(
  await check(
    "resize shape",
    (deck) => {
      const shape = shapeOn(deck, 2, "Build the model");
      const b = p.getShapeBounds(shape);
      const next = { x: b.x, y: b.y, w: b.w - 508000, h: b.h + 254000 };
      p.setShapeBounds(shape, next);
      return next;
    },
    (deck, expected) =>
      ok(
        JSON.stringify(p.getShapeBounds(shapeOn(deck, 2, "Build the model"))) ===
          JSON.stringify(expected),
        "bounds",
      ),
  ),
);

results.push(
  await check(
    "move picture",
    (deck) => {
      const shape = p
        .getSlideShapes(p.getSlides(deck)[2])
        .find((s) => p.getShapeKind(s) === "picture" && p.getShapeBounds(s));
      if (!shape) return null;
      const b = p.getShapeBounds(shape);
      const next = { x: b.x - 127000, y: b.y + 63500, w: b.w - 254000, h: b.h - 127000 };
      p.setShapeBounds(shape, next);
      return { id: p.getShapeId(shape), next };
    },
    (deck, expected) => {
      if (!expected) return "skipped: no picture on slide 3";
      const shape = p.findShapeById(p.getSlides(deck)[2], expected.id);
      return ok(
        JSON.stringify(p.getShapeBounds(shape)) === JSON.stringify(expected.next),
        "bounds",
      );
    },
  ),
);

results.push(
  await check(
    "multi-line text and notes",
    (deck) => {
      const slides = p.getSlides(deck);
      const shape = shapeOn(deck, 2, "Walk the site");
      p.setShapeText(shape, "Walk the site\nThen measure it", { preserveFormatting: true });
      p.setSlideNotes(slides[2], "First line\nSecond line", { preserveFormatting: true });
    },
    (deck) => {
      const slide = p.getSlides(deck)[2];
      const shape = p
        .getSlideShapes(slide)
        .find((s) => p.getShapeText(s).startsWith("Walk the site"));
      return ok(
        p.getShapeText(shape) === "Walk the site\nThen measure it" &&
          p.getShapeParagraphCount(shape) === 2 &&
          p.getSlideNotes(slide) === "First line\nSecond line",
        `${JSON.stringify(p.getShapeText(shape))} / ${JSON.stringify(p.getSlideNotes(slide))}`,
      );
    },
  ),
);

results.push(
  await check(
    "move inherited placeholder",
    (deck) => {
      const slide = p.getSlides(deck)[1];
      const shape = p
        .getSlideShapes(slide)
        .find((s) => p.isShapePlaceholder(s) && !p.getShapeBounds(s));
      if (!shape) return null;
      const b = p.getShapeBoundsResolved(deck, shape);
      const next = { x: b.x + 127000, y: b.y + 127000, w: b.w, h: b.h };
      p.setShapeBounds(shape, next);
      return { id: p.getShapeId(shape), next };
    },
    (deck, expected) => {
      if (!expected) return "skipped: no inherited placeholder on slide 2";
      const shape = p.findShapeById(p.getSlides(deck)[1], expected.id);
      return ok(
        JSON.stringify(p.getShapeBounds(shape)) === JSON.stringify(expected.next),
        "bounds",
      );
    },
  ),
);

results.push(
  await check(
    "add slide with current layout",
    (deck) => {
      const layout = p.getSlideLayout(p.getSlides(deck)[2]);
      p.addSlideAt(deck, 3, { layout });
      return p.getSlides(deck).length;
    },
    (deck, count) => ok(p.getSlides(deck).length === count, "count"),
  ),
);

results.push(
  await check(
    "add slide with placeholders, type and move one",
    (deck) => {
      const layout =
        p.getSlideLayouts(deck).find((l) => p.getSlideLayoutType(l) === "obj") ??
        p.getSlideLayout(p.getSlides(deck)[2]);
      const slide = p.addSlideAt(deck, 3, { layout });
      const added = p.addMissingSlidePlaceholders(slide);
      const shape = p
        .getSlideShapes(slide)
        .find((s) => p.isShapePlaceholder(s) && !p.getShapeBounds(s));
      if (!shape) return { added, moved: null };
      p.setShapeText(shape, "Typed in the studio", { preserveFormatting: true });
      const b = p.getShapeBoundsResolved(deck, shape);
      const next = { x: b.x + 127000, y: b.y + 127000, w: b.w, h: b.h };
      p.setShapeBounds(shape, next);
      return { added, id: p.getShapeId(shape), next, layout: p.getSlideLayoutName(layout) };
    },
    (deck, expected) => {
      if (!expected.id) return `no inherited placeholder (added ${expected.added})`;
      const shape = p.findShapeById(p.getSlides(deck)[3], expected.id);
      return `${expected.layout}, ${expected.added} placeholders: ${ok(
        JSON.stringify(p.getShapeBounds(shape)) === JSON.stringify(expected.next) &&
          p.getShapeText(shape) === "Typed in the studio",
        "bounds/text",
      )}`;
    },
  ),
);

results.push(
  await check(
    "duplicate slide",
    (deck) => {
      const slides = p.getSlides(deck);
      p.duplicateSlideAt(deck, 3, slides[2]);
      return slideTexts(deck);
    },
    (deck, expected) =>
      ok(JSON.stringify(slideTexts(deck)) === JSON.stringify(expected), "order/text"),
  ),
);

results.push(
  await check(
    "move slide",
    (deck) => {
      const slides = p.getSlides(deck);
      p.moveSlide(deck, slides[4], 1);
      return slideTexts(deck);
    },
    (deck, expected) => ok(JSON.stringify(slideTexts(deck)) === JSON.stringify(expected), "order"),
  ),
);

results.push(
  await check(
    "hide slide",
    (deck) => {
      p.setSlideHidden(p.getSlides(deck)[3], true);
    },
    (deck) =>
      ok(
        p.isSlideHidden(p.getSlides(deck)[3]) && !p.isSlideHidden(p.getSlides(deck)[2]),
        "hidden flag",
      ),
  ),
);

results.push(
  await check(
    "delete slide",
    (deck) => {
      const slides = p.getSlides(deck);
      p.removeSlide(deck, slides[4]);
      return slideTexts(deck);
    },
    (deck, expected) => ok(JSON.stringify(slideTexts(deck)) === JSON.stringify(expected), "order"),
  ),
);

results.push(
  await check(
    "delete slide with chart",
    (deck) => {
      const slides = p.getSlides(deck);
      p.removeSlide(deck, slides[3]);
      return slideTexts(deck);
    },
    (deck, expected) => ok(JSON.stringify(slideTexts(deck)) === JSON.stringify(expected), "order"),
  ),
);

console.log(JSON.stringify(results, null, 2));
if (process.argv.includes("--keep")) console.error(`Files kept in ${workspace}`);
else rmSync(workspace, { recursive: true, force: true });
