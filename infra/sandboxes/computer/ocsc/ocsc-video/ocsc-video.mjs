#!/usr/bin/env node
/**
 * OCSC motion graphics videos, rendered with Remotion on the Bot's computer.
 *
 *   ocsc-video scenes
 *   ocsc-video templates [--kind shot] [--category charts] [--name stat-counter]
 *   ocsc-video new --out outputs/Induction.video.json [--title "Site induction"] [--vertical]
 *   ocsc-video read --spec outputs/Induction.video.json
 *   ocsc-video still --spec outputs/Induction.video.json [--scene 3] [--at 1.5]
 *   ocsc-video render --spec outputs/Induction.video.json [--out outputs/Induction.mp4] [--quality draft|standard|master]
 *   ocsc-video fetch --url https://... --out outputs/media/music.mp3
 *   ocsc-video wait [--job <id>] [--seconds 100]
 *   ocsc-video cancel [--job <id>]
 *
 * A video is a JSON spec of timed scenes, the same scene library as Evolve's video creator, plus
 * `custom` scenes: a .tsx file the Bot writes whose default export is a Remotion component. Edits
 * are made to the spec and the video rendered again.
 *
 * A render outlasts one command, so `render` starts it in the background and `wait` reports on it.
 * Every command prints one JSON object; a finished file carries a `link` for the chat.
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { cpus } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = process.env.WORKSPACE_DIR || process.env.HOME || process.cwd();
const STATE = join(WORKSPACE, ".openbot", "video");
const JOBS = join(STATE, "jobs");
const WORK = join(HERE, ".work");
const PREBUILT = join(HERE, "build");
const COMPOSITION = "OcscVideo";
const MAX_SECONDS = 600;
const MAX_WAIT_SECONDS = 110;
const KEEP_BUNDLES = 4;
const FETCH_MAX_BYTES = 400 * 1024 * 1024;
const TRANSITIONS = [
  "none",
  "fade",
  "slide",
  "wipe",
  "flip",
  "iris",
  "clock-wipe",
  "blinds",
  "pixel",
  "brand-wipe",
  "dip",
  "zoom",
  "whip",
  "morph",
];
const TRANSITION_NOTES =
  "fade (cross-dissolve), slide (push), wipe, flip, iris (circle opens), clock-wipe, blinds, pixel (brand-green squares), brand-wipe (green panels sweep across), dip (through OCSC dark), zoom (zoom through), whip (fast blurred pan), morph (blur and scale), none";

let catalogueCache;
/** The motion templates built into this engine, from templates.json. */
function catalogue() {
  if (!catalogueCache) {
    const file = join(HERE, "templates.json");
    catalogueCache = existsSync(file) ? readJson(file) : {};
  }
  return catalogueCache;
}
/** Draft to check timing quickly; standard for sharing; master for big screens. */
const QUALITY = {
  draft: { scale: 0.5, crf: 26, x264Preset: "veryfast", jpegQuality: 80 },
  standard: { scale: 1, crf: 16, x264Preset: "slow", jpegQuality: 95 },
  master: { scale: 2, crf: 16, x264Preset: "slow", jpegQuality: 95 },
};

class UsageError extends Error {}

// ---------- helpers ----------

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
  if (typeof p !== "string" || !p.trim()) throw new UsageError(`${label} is required.`);
  const full = isAbsolute(p) ? resolve(p) : resolve(WORKSPACE, p);
  const rel = relative(WORKSPACE, full);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new UsageError(`${label} must be inside the workspace (${WORKSPACE}).`);
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

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function showOnScreen(full, rel) {
  for (const dir of [join(HERE, "..", "ocsc-word"), "/opt/ocsc-word"]) {
    const file = join(dir, "screen.mjs");
    if (!existsSync(file)) continue;
    try {
      const screen = await import(pathToFileURL(file).href);
      return await screen.showOnScreen(full, rel);
    } catch {
      return {};
    }
  }
  return {};
}

function renderer() {
  return import("@remotion/renderer");
}

// ---------- the spec ----------

const SCENES = {
  title: { needs: ["heading"], fields: "heading, subheading" },
  section_header: {
    needs: ["heading"],
    fields: "heading, sectionNumber, subheading, imageUrl",
  },
  content: {
    needs: ["title", "bullets"],
    fields:
      "title, bullets[], imageUrl, imageUrls[], layout (default|image-left|image-top|full-width-image)",
  },
  fullscreen_text: { needs: ["text"], fields: "text, subtext" },
  big_number: { needs: ["value", "label"], fields: "value, label, context" },
  stats: {
    needs: ["stats"],
    fields:
      "heading, stats[{value,label}], statsLayout (grid|horizontal|vertical|highlight|progress)",
  },
  bar_chart: {
    needs: ["items"],
    fields:
      "heading, items[{label,value,color}], unit, chartType (bar|column|line|area|donut|pie|radial), showValues",
  },
  comparison: {
    needs: ["leftLabel", "leftPoints", "rightLabel", "rightPoints"],
    fields:
      "heading, leftLabel, leftPoints[], rightLabel, rightPoints[], leftAccent/rightAccent (positive|negative|neutral)",
  },
  timeline: {
    needs: ["items"],
    fields: "heading, items[{date,label,description}], orientation (horizontal|vertical)",
  },
  process_steps: {
    needs: ["steps"],
    fields: "heading, steps[{title,description,icon}]",
  },
  icon_list: {
    needs: ["items"],
    fields: "heading, items[{icon,title,description}]",
  },
  quote: { needs: ["quote"], fields: "quote, attribution, imageUrl" },
  pull_quote: {
    needs: ["quote"],
    fields: "quote, attribution, role, portraitUrl",
  },
  image: {
    needs: ["imageUrl"],
    fields: "imageUrl, caption, kenBurns (full bleed)",
  },
  infographic: { needs: ["imageUrl"], fields: "imageUrl (full bleed)" },
  image_grid: {
    needs: ["images"],
    fields:
      "heading, images[{url,caption}], columns (2|3|4), gridLayout (uniform|featured|masonry|filmstrip)",
  },
  video: {
    needs: ["videoUrl"],
    fields: "videoUrl, caption, posterUrl (full bleed)",
  },
  logo_wall: {
    needs: ["logos"],
    fields: "heading, logos[{url,name}], columns (3|4|5|6)",
  },
  team_cards: {
    needs: ["members"],
    fields: "heading, members[{name,role,photoUrl}]",
  },
  map_callout: {
    needs: ["locationName"],
    fields: "heading, locationName, coordinates, imageUrl",
  },
  code_block: {
    needs: ["code"],
    fields: "heading, code, language, caption",
  },
  closing: { needs: ["heading"], fields: "heading, subheading" },
  template: {
    needs: ["template"],
    fields:
      "template (a name from ocsc-video templates), props {} (that template's props), branded (the skyline footer, green bars and corner logo, as on every built-in scene: default true, except full-frame photo templates; false runs it edge to edge)",
  },
  custom: {
    needs: ["file"],
    fields:
      "file (a .tsx beside the spec, default export a Remotion component), props {}, branded (draw the skyline footer and logo)",
  },
};

/** What each built-in scene is for, so the right one is picked. Shown by `ocsc-video scenes`. */
const EXPLAIN = {
  title: {
    shows: "The OCSC logo, a large heading, a green rule and a green subheading, centred on white.",
    use_for: "The first scene of almost every video: the project, topic or course name.",
    instead: "cinematic-title-intro or letterbox-reveal for a film-style opening.",
    fits: "Heading up to 8 words; subheading one line.",
    media: "none",
    seconds: "4-6",
  },
  section_header: {
    shows:
      "A large green section number, a heading and a subheading, with an optional photo beside them.",
    use_for: "Opening each part of a training video, walkthrough or report.",
    instead: "chapter-title for a lighter number-only break.",
    fits: "Heading up to 6 words; sectionNumber like 01.",
    media: "optional photo",
    seconds: "4-5",
  },
  content: {
    shows:
      "A title and bullet points that animate in, optionally beside one photo or a set of up to 4.",
    use_for: "The main teaching scene: explaining points, requirements, scope or findings.",
    instead:
      "icon_list when each point has a title and description; process_steps when the points are in order.",
    fits: "3-5 bullets of up to 10 words each.",
    media: "optional photo or photos",
    seconds: "6-10 (grows to fit the voice)",
  },
  fullscreen_text: {
    shows: "One large statement centred on the frame with a small line under it.",
    use_for: "A key message, a mission line, a question to the viewer or a pause between sections.",
    instead:
      "text-highlight, slide-text or typewriter-subtitle for the same idea with more motion.",
    fits: "Up to 12 words.",
    media: "none",
    seconds: "4-6",
  },
  big_number: {
    shows: "One very large green figure with a label and a line of context.",
    use_for: "The single headline statistic of a section.",
    instead: "stat-counter to count up with a change figure; stats for several figures.",
    fits: "A short value (1,250, €40m, 98%); label up to 4 words.",
    media: "none",
    seconds: "4-5",
  },
  stats: {
    shows:
      "Two to six figures in cards, as a grid, a row, a column, one highlighted figure or progress bars.",
    use_for: "Several key figures shown together: company facts, project KPIs, results.",
    instead: "big_number for one figure; progress-bars for percentages by stage.",
    fits: "2-6 stats with labels of up to 3 words.",
    media: "none",
    seconds: "5-7",
  },
  bar_chart: {
    shows: "A labelled chart: bar, column, line, area, donut, pie or radial, with values.",
    use_for: "Any comparison of figures: by sector, month, region or discipline.",
    instead:
      "chart-animation, line-chart, area-chart, pie-chart or donut-chart for a chart that builds more dramatically.",
    fits: "3-8 items with short labels.",
    media: "none",
    seconds: "6-8",
  },
  comparison: {
    shows:
      "Two columns of points side by side with labels, coloured positive, negative or neutral.",
    use_for: "Before and after, option A against option B, or problem against solution, in words.",
    instead:
      "image-comparison-slider for two photos; comparison-chart for two numbers; card-flip for one line each.",
    fits: "2-5 short points per side.",
    media: "none",
    seconds: "6-8",
  },
  timeline: {
    shows: "Dated milestones along a line, across or down the frame.",
    use_for: "A project programme, a history or a sequence of dates.",
    instead: "progress-steps or process_steps when the stages have no dates.",
    fits: "3-6 items; label up to 3 words, description one short line.",
    media: "none",
    seconds: "6-8",
  },
  process_steps: {
    shows: "Numbered steps with icons, titles and short descriptions, linked in order.",
    use_for: "How something is done: a method, a workflow, a procedure.",
    instead: "timeline when each step has a date; progress-steps for a quick animated version.",
    fits: "3-5 steps; description up to 8 words.",
    media: "none (lucide icons)",
    seconds: "6-8",
  },
  icon_list: {
    shows: "Rows with an icon, a title and a description.",
    use_for: "Sectors, services, benefits, safety rules or features.",
    instead: "content for plain bullets; animated-list for a short animated list.",
    fits: "3-5 items; description up to 8 words.",
    media: "none (lucide icons)",
    seconds: "6-8",
  },
  quote: {
    shows: "A large quotation with its attribution, optionally over a faded photo.",
    use_for: "A statement or testimonial without a named portrait.",
    instead: "pull_quote for a named person with a portrait; quote-card for an animated card.",
    fits: "Up to 30 words.",
    media: "optional photo",
    seconds: "5-7",
  },
  pull_quote: {
    shows: "A quotation beside a portrait, with the person's name and role.",
    use_for: "A named client, partner or OCSC staff testimonial.",
    instead: "quote when there is no portrait.",
    fits: "Up to 30 words.",
    media: "portrait photo",
    seconds: "5-7",
  },
  image: {
    shows:
      "One photo filling the frame edge to edge with a caption, optionally slowly zooming (kenBurns).",
    use_for: "Showing a project, a site or a finished building.",
    instead:
      "ken-burns, zoom-pulse or parallax-pan for richer camera motion; image-zoom-reveal for a hero reveal.",
    fits: "Caption up to 8 words.",
    media: "photo (required)",
    seconds: "4-6",
  },
  infographic: {
    shows: "One graphic filling the frame: an infographic, a drawing, a plan or a chart image.",
    use_for: "Showing a ready-made graphic or drawing in full.",
    instead: "image for a photo.",
    fits: "A landscape image; no text is added.",
    media: "image (required)",
    seconds: "5-8",
  },
  image_grid: {
    shows:
      "A heading over 2-6 photos with captions, as a grid, a featured layout, masonry or a filmstrip.",
    use_for: "A portfolio of projects or a set of site photos.",
    instead: "gallery-grid, masonry-gallery or photo-stack for photos that animate in.",
    fits: "Up to 6 photos with captions of up to 3 words.",
    media: "photos (required)",
    seconds: "5-7",
  },
  video: {
    shows: "A video clip filling the frame with a caption.",
    use_for: "Real footage: a site, a drone flight, an interview.",
    instead: "image or ken-burns when there is only a photo.",
    fits: "One clip; set duration to the part you want.",
    media: "video (required)",
    seconds: "the clip's length",
  },
  logo_wall: {
    shows: "A heading over a grid of logos.",
    use_for: "Clients, partners, frameworks or accreditations.",
    instead: "icon_list when there are no logo files.",
    fits: "4-12 logos. Only real logo files: never invent client names.",
    media: "logo images",
    seconds: "5-6",
  },
  team_cards: {
    shows: "Photo cards with each person's name and role.",
    use_for: "Introducing a project team, a department or the speakers.",
    instead: "lower-third to name one person over their photo.",
    fits: "2-5 people.",
    media: "headshots",
    seconds: "5-7",
  },
  map_callout: {
    shows: "A pin with the location name and coordinates over a map or aerial photo.",
    use_for: "Where a project or office is.",
    instead: "image with a caption for a plain location photo.",
    fits: "Location name up to 4 words.",
    media: "map or aerial photo",
    seconds: "5-6",
  },
  code_block: {
    shows: "Code or a formula typed out in a dark panel with a caption.",
    use_for: "A script, a Dynamo or Python step, a spreadsheet formula or a calculation.",
    instead: "content for anything that is not code.",
    fits: "Up to 12 short lines.",
    media: "none",
    seconds: "6-10",
  },
  closing: {
    shows: "The OCSC logo, a heading and a subheading such as the website.",
    use_for: "The last scene of every video (required unless settings.openEnding).",
    instead: "end-card for a closing panel with a call to action and contact lines.",
    fits: "Heading up to 5 words; subheading one line.",
    media: "none",
    seconds: "4-6",
  },
  template: {
    shows: "One of the motion templates (ocsc-video templates lists them, with what each is for).",
    use_for:
      "A moment that needs more motion than a built-in scene: a reveal, an animated chart, a cinematic photo move.",
    instead: "A built-in scene when the point is teaching or reading.",
    fits: "See each template's props.",
    media: "see the template",
    seconds: "see the template",
  },
  custom: {
    shows: "A scene you write yourself as a Remotion component.",
    use_for: "Only when no built-in scene or template can show the idea.",
    instead: "A template with props, which keeps the OCSC look for free.",
    fits: "Your own layout; keep clear of the bottom 140 px when branded.",
    media: "your choice",
    seconds: "your choice",
  },
};

// Which scene to pick for a purpose: built-in scenes first, then templates with more motion.
const CHOOSE = {
  "open the video":
    "title, then optionally a logo template (logo-fade-reveal, logo-stroke-draw, logo-split-reveal, logo-bounce-drop) or cinematic-title-intro",
  "start a section": "section_header, chapter-title",
  "explain points": "content, icon_list, animated-list",
  "a sequence or method": "process_steps, progress-steps, timeline (with dates)",
  "one key message":
    "fullscreen_text, text-highlight, slide-text, typewriter-subtitle, title-split",
  "one statistic": "big_number, stat-counter, circular-progress",
  "several figures": "stats, progress-bars",
  "a chart": "bar_chart, chart-animation, line-chart, area-chart, pie-chart, donut-chart",
  "compare two things":
    "comparison (words), comparison-chart (two numbers), image-comparison-slider (two photos), split-screen (two photos with text), card-flip (one line each)",
  "show one photo":
    "image, ken-burns, zoom-pulse, parallax-pan, image-zoom-reveal, spotlight-reveal, letterbox-reveal",
  "show several photos": "image_grid, gallery-grid, masonry-gallery, image-carousel, photo-stack",
  "a person": "lower-third (over their photo), pull_quote, team_cards, polaroid-frame",
  "a quote": "quote, pull_quote, quote-card",
  "celebrate a milestone": "particle-explosion, popping-text, camera-shake",
  "behind a heading":
    "bokeh-circles, geometric-patterns, grid-pulse, liquid-wave (water), matrix-rain (digital, BIM), starfield (vision), pixel-transition",
  "updates over footage": "notification-pop, typewriter-subtitle, subscribe-reminder (overlays)",
  "close the video": "closing (required last), end-card, credits-roll before it",
};

const COMMON = {
  duration: "seconds on screen (required)",
  background:
    "{type: solid|gradient|image|video, color, gradientFrom, gradientTo, gradientVia, gradientDirection (0deg…315deg), imageUrl, videoUrl, overlayColor, overlayOpacity 0-1}",
  animation:
    "{entrance: fade-in|slide-up|slide-left|slide-right|scale-up|bounce|typewriter|blur-in|none, entranceDuration (frames), staggerDelay (frames)}",
  "<part>Style":
    "headingStyle, subheadingStyle, titleStyle, bulletStyle, textStyle, valueStyle, labelStyle, quoteStyle, captionStyle: {fontFamily, fontSize, fontWeight, color, textAlign, letterSpacing, lineHeight, textShadow}",
  icons: "lucide icon names in PascalCase, e.g. ShieldCheck, HardHat, Ruler",
};

function loadSpec(o) {
  const spec = inWorkspace(o.spec, "--spec");
  if (!existsSync(spec.full)) throw new UsageError(`${spec.rel} does not exist.`);
  let config;
  try {
    config = readJson(spec.full);
  } catch (error) {
    throw new UsageError(`${spec.rel} is not valid JSON: ${error.message}`);
  }
  return { spec, config, problems: validate(config, spec) };
}

function validate(config, spec) {
  const problems = [];
  if (!config || typeof config !== "object") return ["The spec must be a JSON object."];
  const s = config.settings;
  if (!s || typeof s !== "object") problems.push("settings is required.");
  else {
    for (const key of ["width", "height"]) {
      const v = s[key];
      if (!Number.isInteger(v) || v < 320 || v > 3840 || v % 2)
        problems.push(`settings.${key} must be an even whole number from 320 to 3840.`);
    }
    if (!Number.isInteger(s.fps) || s.fps < 12 || s.fps > 60)
      problems.push("settings.fps must be a whole number from 12 to 60.");
  }
  if (!Array.isArray(config.scenes) || config.scenes.length === 0)
    return [...problems, "scenes must be a list with at least one scene."];
  let total = 0;
  config.scenes.forEach((scene, i) => {
    const at = `scenes[${i}]`;
    const kind = SCENES[scene?.type];
    if (!kind) {
      problems.push(
        `${at}.type "${scene?.type}" is not a scene. Run ocsc-video scenes for the list.`,
      );
      return;
    }
    if (typeof scene.duration !== "number" || scene.duration < 0.5 || scene.duration > 120)
      problems.push(`${at}.duration must be seconds from 0.5 to 120.`);
    else total += scene.duration;
    for (const field of kind.needs) {
      const v = scene[field];
      if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0))
        problems.push(`${at} (${scene.type}) needs ${field}.`);
    }
    if (scene.type === "template" && typeof scene.template === "string") {
      if (!catalogue()[scene.template])
        problems.push(
          `${at}.template "${scene.template}" is not a template. Run ocsc-video templates for the list.`,
        );
      else if (catalogue()[scene.template].kind === "shot" && s?.fps !== 30)
        problems.push(
          `${at}: ${scene.template} is a shot, choreographed at 30 fps. Set settings.fps to 30.`,
        );
    }
    if (scene.overlays !== undefined && !Array.isArray(scene.overlays))
      problems.push(`${at}.overlays must be a list of {template, props, at, duration}.`);
    for (const [j, overlay] of (Array.isArray(scene.overlays) ? scene.overlays : []).entries()) {
      const meta = catalogue()[overlay?.template];
      if (!meta)
        problems.push(`${at}.overlays[${j}].template "${overlay?.template}" is not a template.`);
      else if (!meta.overlay)
        problems.push(
          `${at}.overlays[${j}]: ${overlay.template} is a full-frame template; use it as a scene. Overlays: ${Object.values(
            catalogue(),
          )
            .filter((m) => m.overlay)
            .map((m) => m.name)
            .join(", ")}.`,
        );
      if (overlay?.at !== undefined && !(overlay.at >= 0 && overlay.at < scene.duration))
        problems.push(`${at}.overlays[${j}].at must be seconds within the scene.`);
    }
    if (scene.type === "custom" && typeof scene.file === "string") {
      try {
        const file = customFile(spec, scene.file);
        if (!existsSync(file.full)) problems.push(`${at}.file ${file.rel} does not exist.`);
        else if (!/export\s+default\b/.test(readFileSync(file.full, "utf8")))
          problems.push(`${at}.file ${file.rel} needs a default export (the scene component).`);
      } catch (error) {
        problems.push(`${at}.file: ${error.message}`);
      }
    }
  });
  if (total > MAX_SECONDS) problems.push(`The video is ${total}s; the most is ${MAX_SECONDS}s.`);
  if (s?.transition !== undefined && !TRANSITIONS.includes(s.transition))
    problems.push(`settings.transition must be one of ${TRANSITIONS.join(", ")}.`);
  if (
    s?.transitionSeconds !== undefined &&
    !(s.transitionSeconds >= 0.1 && s.transitionSeconds <= 2)
  )
    problems.push("settings.transitionSeconds must be from 0.1 to 2.");
  const music = config.audio?.music;
  if (music !== undefined && (typeof music?.src !== "string" || !music.src))
    problems.push("audio.music needs src: an https link or a workspace file.");
  for (const key of ["volumeDb", "duckDb"])
    if (music?.[key] !== undefined && !(music[key] <= 0 && music[key] >= -40))
      problems.push(`audio.music.${key} must be decibels from -40 to 0.`);
  config.scenes.forEach((scene, i) => {
    if (scene?.transition !== undefined && !TRANSITIONS.includes(scene.transition))
      problems.push(`scenes[${i}].transition must be one of ${TRANSITIONS.join(", ")}.`);
    if (scene?.sfx !== undefined && !Array.isArray(scene.sfx))
      problems.push(`scenes[${i}].sfx must be a list of {src, at, volumeDb}.`);
    for (const [j, effect] of (Array.isArray(scene?.sfx) ? scene.sfx : []).entries())
      if (typeof effect?.src !== "string" || !effect.src)
        problems.push(`scenes[${i}].sfx[${j}] needs src.`);
  });
  return problems;
}

function customFile(spec, file) {
  if (![".tsx", ".jsx"].includes(extname(file)))
    throw new UsageError("A custom scene must be a .tsx or .jsx file.");
  return inWorkspace(
    isAbsolute(file) ? file : join(dirname(spec.rel), file),
    "A custom scene file",
  );
}

function timing(config) {
  let at = 0;
  return config.scenes.map((scene, i) => {
    const row = {
      scene: i + 1,
      type: scene.type,
      start: at,
      duration: scene.duration,
    };
    const label =
      scene.heading ??
      scene.title ??
      scene.text ??
      scene.value ??
      scene.quote ??
      scene.file ??
      scene.locationName;
    if (label) row.label = String(label).slice(0, 80);
    at += scene.duration;
    return row;
  });
}

function totalSeconds(config) {
  return config.scenes.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
}

// ---------- media ----------

const MEDIA_FIELD = /(Url|Urls)$|^src$/;
const TOKEN = "ocsc-media://";
const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
};
const VOICE_DELAY = 0.3;
const VOICE_TAIL = 0.7;
/** The last scene's voice ends this long before the video does, so the close can breathe. */
const LAST_VOICE_TAIL = 1.8;
/** Every voice, music track and sound effect is levelled to these loudnesses (LUFS) first. */
const LEVEL = { voice: -16, music: -16, effect: -18 };
const LEVEL_LIMIT = { voice: [-10, 15], music: [-30, 10], effect: [-25, 10] };

/** Integrated loudness of up to 90 seconds of a file, or null when it cannot be measured. */
async function loudness(source, startAt = 0) {
  let temp = null;
  try {
    if (/^https?:/i.test(source)) {
      const res = await fetch(source, { signal: AbortSignal.timeout(30000) });
      const size = Number(res.headers.get("content-length") || 0);
      if (!res.ok || size > 60 * 1024 * 1024) return null;
      const { tmpdir } = await import("node:os");
      temp = join(tmpdir(), `ocsc-level-${randomUUID()}`);
      writeFileSync(temp, Buffer.from(await res.arrayBuffer()));
      source = temp;
    }
    const log = await ffmpeg([
      ...(startAt > 0 ? ["-ss", String(startAt)] : []),
      "-t",
      "90",
      "-i",
      source,
      "-vn",
      "-af",
      "loudnorm=print_format=json",
      "-f",
      "adts",
      "-y",
      "/dev/null",
    ]);
    const lufs = Number(
      JSON.parse(log.slice(log.lastIndexOf("{"), log.lastIndexOf("}") + 1)).input_i,
    );
    return Number.isFinite(lufs) && lufs > -60 ? lufs : null;
  } catch {
    return null;
  } finally {
    if (temp) rmSync(temp, { force: true });
  }
}

/** The gain (dB) that brings a file to its reference loudness. */
async function levelFor(kind, source, startAt) {
  const lufs = await loudness(source, startAt);
  if (lufs === null) return { lufs: null, levelDb: 0 };
  const [lo, hi] = LEVEL_LIMIT[kind];
  const levelDb = Math.max(lo, Math.min(hi, LEVEL[kind] - lufs));
  return { lufs: Math.round(lufs * 10) / 10, levelDb: Math.round(levelDb * 10) / 10 };
}

/** A video must end on its closing scene, held long enough to read. */
function endingProblems(config) {
  if (config.settings?.openEnding === true) return [];
  const scenes = Array.isArray(config.scenes) ? config.scenes : [];
  const last = scenes[scenes.length - 1];
  const n = scenes.length;
  const closes = (scene) =>
    scene?.type === "closing" ||
    (scene?.type === "custom" && scene.closing === true) ||
    (scene?.type === "template" &&
      (catalogue()[scene.template]?.category === "outro" ||
        /^(end-card|logo-)/.test(String(scene.template))));
  if (!closes(last))
    return [
      `The video ends on scene ${n} (${last?.type}), so it stops abruptly. Add a closing scene last, e.g. {"type": "closing", "heading": "Thank you", "subheading": "ocsc.ie", "duration": 5}, with any final voice line on the scene before it or a short sign-off on the closing scene itself. (A custom closing scene needs "closing": true; a looping social clip can set settings.openEnding true.)`,
    ];
  if (typeof last.duration === "number" && last.duration < 3.5)
    return [
      `The closing scene (scene ${n}) is ${last.duration}s; give it at least 4 so the logo and sign-off hold before the fade.`,
    ];
  return [];
}
const isRemote = (v) => /^(https?:|data:)/i.test(v);

async function mediaSeconds(src) {
  const { parseMedia } = await import("@remotion/media-parser");
  const local = !isRemote(src);
  const reader = local ? (await import("@remotion/media-parser/node")).nodeReader : undefined;
  const { durationInSeconds } = await parseMedia({
    src,
    fields: { durationInSeconds: true },
    logLevel: "error",
    ...(reader ? { reader } : {}),
  });
  return durationInSeconds ?? null;
}

/**
 * The spec as the render sees it. Workspace files it names (photos the Bot fetched, voiceovers,
 * music) become tokens that `serveMedia` points at a server on this computer, voiceovers are
 * measured, and a scene grows to fit its voice unless `voiceover.autoFitDuration` is false.
 */
async function prepare(spec, config) {
  const files = new Map();
  const problems = [];
  const warnings = [];
  const local = (value, at) => {
    let file;
    try {
      const fromSpec = inWorkspace(isAbsolute(value) ? value : join(dirname(spec.rel), value), at);
      file = existsSync(fromSpec.full) ? fromSpec : inWorkspace(value, at);
    } catch (error) {
      problems.push(`${at}: ${error.message}`);
      return value;
    }
    if (!existsSync(file.full) || !statSync(file.full).isFile()) {
      problems.push(`${at}: ${file.rel} does not exist.`);
      return value;
    }
    const ext = extname(file.full).toLowerCase();
    if (!MIME[ext]) {
      problems.push(`${at}: ${file.rel} is not an image, video or audio file.`);
      return value;
    }
    const route = `/m/${files.size}/${encodeURIComponent(basename(file.full))}`;
    files.set(route, { full: file.full, type: MIME[ext] });
    return `${TOKEN}${route}`;
  };
  const walk = (node, at) => {
    if (Array.isArray(node)) return node.map((v, i) => walk(v, `${at}[${i}]`));
    if (!node || typeof node !== "object") return node;
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      const here = at ? `${at}.${key}` : key;
      if (MEDIA_FIELD.test(key) && typeof value === "string" && value.trim())
        out[key] = isRemote(value) ? value : local(value.trim(), here);
      else if (MEDIA_FIELD.test(key) && Array.isArray(value))
        out[key] = value.map((v, i) =>
          typeof v === "string" && v.trim() && !isRemote(v)
            ? local(v.trim(), `${here}[${i}]`)
            : walk(v, `${here}[${i}]`),
        );
      else out[key] = walk(value, here);
    }
    return out;
  };
  const prepared = walk(config, "");

  const fitted = [];
  await Promise.all(
    prepared.scenes.map(async (scene, i) => {
      const voice = scene.voiceover;
      if (!voice?.audioUrl) return;
      const source = voice.audioUrl.startsWith(TOKEN)
        ? files.get(voice.audioUrl.slice(TOKEN.length)).full
        : voice.audioUrl;
      let seconds;
      try {
        seconds = await mediaSeconds(source);
      } catch (error) {
        problems.push(
          `scenes[${i}].voiceover.audioUrl could not be read: ${String(error?.message || error).slice(0, 200)}`,
        );
        return;
      }
      if (!seconds) return;
      voice.durationMs = Math.round(seconds * 1000);
      const tail = i === prepared.scenes.length - 1 ? LAST_VOICE_TAIL : VOICE_TAIL;
      const needs = Math.ceil(((voice.delay ?? VOICE_DELAY) + seconds + tail) * 10) / 10;
      if (needs <= scene.duration) return;
      if (voice.autoFitDuration === false)
        warnings.push(
          `Scene ${i + 1}'s voiceover runs ${seconds.toFixed(1)}s and the scene is ${scene.duration}s, so the voice is cut off. Set its duration to ${needs}.`,
        );
      else {
        fitted.push({ scene: i + 1, from: scene.duration, to: needs });
        scene.duration = needs;
      }
    }),
  );
  if (totalSeconds(prepared) > MAX_SECONDS)
    problems.push(
      `With voiceovers fitted the video is ${totalSeconds(prepared)}s; the most is ${MAX_SECONDS}s.`,
    );
  // Level every audio file to the same loudness, so a loudly mastered music track sits as far
  // under the voice as a quiet one.
  const sourceOf = (v) =>
    typeof v === "string" && v.startsWith(TOKEN) ? files.get(v.slice(TOKEN.length))?.full : v;
  const levels = {};
  const jobs = [];
  const music = prepared.audio?.music;
  if (music?.src)
    jobs.push(
      levelFor("music", sourceOf(music.src), music.startAt ?? 0).then((l) => {
        music.levelDb = l.levelDb;
        levels.music_lufs = l.lufs;
        if (l.lufs === null)
          warnings.push(
            "The music's loudness could not be measured, so it plays at its own level; fetch it into outputs/media first.",
          );
      }),
    );
  prepared.scenes.forEach((scene, i) => {
    if (scene.voiceover?.audioUrl)
      jobs.push(
        levelFor("voice", sourceOf(scene.voiceover.audioUrl)).then((l) => {
          scene.voiceover.levelDb = l.levelDb;
          (levels.voice_lufs ??= [])[i] = l.lufs;
        }),
      );
    for (const effect of Array.isArray(scene.sfx) ? scene.sfx : [])
      if (effect?.src)
        jobs.push(
          levelFor("effect", sourceOf(effect.src)).then((l) => {
            effect.levelDb = l.levelDb;
          }),
        );
  });
  await Promise.all(jobs);
  if (levels.voice_lufs) levels.voice_lufs = levels.voice_lufs.filter((v) => v !== undefined);
  const audio = {
    ...(Object.keys(levels).length
      ? { levelled_to: "voice and music -16 LUFS before volumeDb", ...levels }
      : {}),
    music: Boolean(prepared.audio?.music?.src),
    voices: prepared.scenes.filter((s) => s.voiceover?.audioUrl).length,
    effects: prepared.scenes.reduce((n, s) => n + (s.sfx?.length ?? 0), 0),
  };
  return { config: prepared, files, problems, warnings, fitted, audio };
}

/** Serves the spec's workspace files to the render's browser, on this computer only. */
async function serveMedia(prepared) {
  const { createServer } = await import("node:http");
  const server = createServer((req, res) => {
    const file = prepared.files.get(String(req.url).split("?")[0]);
    if (!file || !["GET", "HEAD"].includes(req.method)) {
      res.writeHead(404).end();
      return;
    }
    const size = statSync(file.full).size;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    let start = 0;
    let end = size - 1;
    if (range) {
      start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : end;
      if (start > end || start >= size) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        return;
      }
    }
    res.writeHead(range ? 206 : 200, {
      "Content-Type": file.type,
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(file.full, { start, end }).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = JSON.parse(JSON.stringify(prepared.config).split(TOKEN).join(base));
  return { config, close: () => server.close() };
}

/** Runs Remotion's ffmpeg and resolves with what it wrote to stderr. */
async function ffmpeg(argv) {
  const { RenderInternals } = await renderer();
  const bin = RenderInternals.getExecutablePath({
    type: "ffmpeg",
    indent: false,
    binariesDirectory: null,
    logLevel: "error",
  });
  return new Promise((resolveRun, reject) => {
    const child = spawn(bin, ["-hide_banner", "-nostats", ...argv], {
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...process.env,
        LD_LIBRARY_PATH: dirname(bin),
        DYLD_LIBRARY_PATH: dirname(bin),
      },
    });
    let err = "";
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolveRun(err) : reject(new Error(`ffmpeg failed: ${err.slice(-800)}`)),
    );
  });
}

/**
 * Loudness to the streaming standard, measured first so the second pass is an exact, even gain,
 * and a file that starts playing before it has downloaded.
 */
async function finish(tmp, out, audio) {
  const hasAudio = audio.music || audio.voices || audio.effects;
  let filter = null;
  if (hasAudio) {
    const target = `I=${audio.voices ? -14 : -16}:TP=-1.5:LRA=11`;
    filter = `loudnorm=${target},aresample=48000`;
    try {
      const log = await ffmpeg([
        "-i",
        tmp,
        "-vn",
        "-af",
        `loudnorm=${target}:print_format=json`,
        "-c:a",
        "aac",
        "-f",
        "adts",
        "-y",
        "/dev/null",
      ]);
      const m = JSON.parse(log.slice(log.lastIndexOf("{"), log.lastIndexOf("}") + 1));
      if (Number.isFinite(Number(m.input_i)) && Number(m.input_i) > -70)
        filter = `loudnorm=${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`;
    } catch {}
  }
  await ffmpeg([
    "-loglevel",
    "error",
    "-i",
    tmp,
    "-map",
    "0",
    "-c:v",
    "copy",
    ...(filter ? ["-af", filter, "-c:a", "aac", "-b:a", "320k"] : ["-an"]),
    "-movflags",
    "+faststart",
    "-y",
    out,
  ]);
}

// ---------- bundles ----------

/** The Remotion bundle for this spec: the prebuilt one, or a private build with its custom scenes. */
async function bundleFor(spec, config, onProgress) {
  const custom = [...new Set(config.scenes.filter((s) => s.type === "custom").map((s) => s.file))];
  if (custom.length === 0 && existsSync(join(PREBUILT, "index.html"))) return PREBUILT;

  const files = custom.map((file) => {
    const { full } = customFile(spec, file);
    return { file, source: readFileSync(full, "utf8") };
  });
  const hash = createHash("sha256")
    .update(readFileSync(join(HERE, "package.json")))
    .update(JSON.stringify(files))
    .digest("hex")
    .slice(0, 16);
  const out = join(WORK, `bundle-${hash}`);
  if (existsSync(join(out, "index.html"))) return out;

  const src = join(WORK, `src-${hash}`);
  rmSync(src, { recursive: true, force: true });
  cpSync(join(HERE, "src"), src, { recursive: true });
  mkdirSync(join(src, "custom", "user"), { recursive: true });
  const imports = files.map(({ file, source }, i) => {
    writeFileSync(join(src, "custom", "user", `scene${i}${extname(file)}`), source);
    return { name: `Scene${i}`, from: `./user/scene${i}`, key: file };
  });
  writeFileSync(
    join(src, "custom", "registry.ts"),
    `import type { ComponentType } from 'react';\n${imports
      .map((m) => `import ${m.name} from '${m.from}';`)
      .join(
        "\n",
      )}\n\nexport const customScenes: Record<string, ComponentType<Record<string, unknown>>> = {\n${imports
      .map(
        (m) => `  ${JSON.stringify(m.key)}: ${m.name} as ComponentType<Record<string, unknown>>,`,
      )
      .join("\n")}\n};\n`,
  );

  const { bundle } = await import("@remotion/bundler");
  try {
    await bundle({
      entryPoint: join(src, "index.ts"),
      outDir: out,
      rootDir: HERE,
      enableCaching: true,
      onProgress: (p) => onProgress?.(p),
    });
  } catch (error) {
    rmSync(out, { recursive: true, force: true });
    let message = String(error?.message || error);
    files.forEach(({ file }, i) => {
      message = message.split(join(src, "custom", "user", `scene${i}${extname(file)}`)).join(file);
    });
    throw new UsageError(
      `A custom scene did not build: ${message.split("\n    at ")[0].slice(0, 2000)}`,
    );
  } finally {
    rmSync(src, { recursive: true, force: true });
  }
  prune();
  return out;
}

/** Cores this process may use: a container's CPU quota when it has one, else the host's cores. */
function cpuCount() {
  try {
    const [quota, period] = readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim().split(/\s+/);
    if (quota !== "max") return Math.max(1, Math.floor(Number(quota) / Number(period)));
  } catch {}
  return cpus().length;
}

function prune() {
  if (!existsSync(WORK)) return;
  const bundles = readdirSync(WORK)
    .filter((f) => f.startsWith("bundle-"))
    .map((f) => ({ f, t: statSync(join(WORK, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of bundles.slice(KEEP_BUNDLES))
    rmSync(join(WORK, f), { recursive: true, force: true });
}

async function composition(serveUrl, config) {
  const { ensureBrowser, selectComposition } = await renderer();
  // A first download would otherwise print progress into the JSON this tool answers with.
  await ensureBrowser({
    onBrowserDownload: () => ({ version: null, onProgress: () => undefined }),
  });
  return selectComposition({
    serveUrl,
    id: COMPOSITION,
    inputProps: { config },
    logLevel: "error",
  });
}

// ---------- commands ----------

function cmdScenes() {
  return {
    ok: true,
    spec: {
      title: "optional",
      brandColor: "hex, default OCSC green #76bf43",
      logoUrl: "optional; the OCSC logo is used by default (logoOnDarkUrl for dark backgrounds)",
      settings:
        "{width: 1920, height: 1080, fps: 30, show_skyline_footer: true, transition (how scenes enter, default fade), transitionSeconds (default 0.5)}",
      transitions: TRANSITION_NOTES,
      audio:
        "{music: {src, volumeDb (relative to the voice, default -8), duckDb (further drop under voice, default -10), startAt (seconds into the track), fadeIn (default 1), fadeOut (default 3)}; every track is levelled first, so leave the defaults unless asked, voiceVolumeDb (default 0)}",
      scenes: "[...] played in order",
      media:
        "every *Url, *Urls and src field takes an https link or a workspace file (ocsc-video fetch downloads one)",
    },
    every_scene: {
      ...COMMON,
      transition: "how this scene enters, overriding settings.transition",
      overlays:
        "[{template (an overlay template: lower-third, noise-grain, film-burn, ...), props, at (seconds into the scene), duration}] drawn over the scene",
      voiceover:
        "{audioUrl, script, delay (seconds before it starts, default 0.3), autoFitDuration (default true: the scene grows to fit the voice)}",
      sfx: "[{src, at (seconds into the scene), volumeDb (default -6)}]",
    },
    choose: CHOOSE,
    scenes: Object.fromEntries(
      Object.entries(SCENES).map(([k, v]) => [k, { fields: v.fields, ...EXPLAIN[k] }]),
    ),
    next: "Every scene carries the OCSC branding. ocsc-video templates lists the motion templates with the same kind of explainer.",
  };
}

/** The motion templates: brand-coloured scenes and overlays, with their props. */
function cmdTemplates(o) {
  const all = Object.values(catalogue());
  const pick = all
    .filter((m) => typeof o.category !== "string" || m.category === o.category)
    .filter((m) => typeof o.kind !== "string" || (m.kind ?? "template") === o.kind);
  if (typeof o.name === "string") {
    const meta = catalogue()[o.name];
    if (!meta) throw new UsageError(`There is no template called ${o.name}.`);
    return {
      ok: true,
      ...meta,
      use: meta.overlay
        ? `{"type": "template", "template": "${meta.name}", "props": {...}, "duration": ${meta.seconds}} or, over any scene, "overlays": [{"template": "${meta.name}", "props": {...}, "at": 0.5}]`
        : `{"type": "template", "template": "${meta.name}", "props": {...}, "duration": ${meta.seconds}}`,
    };
  }
  const categories = {};
  for (const m of pick) {
    categories[m.category] ??= [];
    categories[m.category].push(
      `${m.name}${m.overlay ? " (overlay)" : ""}${m.kind === "shot" ? ` (shot, ${m.seconds}s)` : ""}: ${m.description}${m.media ? ` Needs: ${m.media}.` : ""}${m.instead ? ` Instead: ${m.instead}` : ""}`,
    );
  }
  return {
    ok: true,
    count: pick.length,
    next: "ocsc-video templates --name <name> shows its props, defaults and how much fits. ocsc-video scenes has the built-in scenes and a guide to choosing between similar scenes.",
    categories,
  };
}

function cmdNew(o) {
  const out = inWorkspace(o.out, "--out");
  if (!out.rel.endsWith(".video.json"))
    throw new UsageError("--out must end in .video.json, e.g. outputs/Induction.video.json.");
  if (existsSync(out.full) && !o.force)
    throw new UsageError(`${out.rel} already exists. Edit it, or pass --force to start again.`);
  const title = typeof o.title === "string" ? o.title : basename(out.rel, ".video.json");
  const vertical = o.vertical === true;
  const config = {
    title,
    brandColor: "#76bf43",
    settings: {
      width: vertical ? 1080 : 1920,
      height: vertical ? 1920 : 1080,
      fps: 30,
      show_skyline_footer: !vertical,
    },
    scenes: [
      {
        type: "title",
        heading: title,
        subheading: "Subtitle",
        duration: 4,
        animation: { entrance: "slide-up" },
      },
      {
        type: "content",
        title: "Key points",
        bullets: ["First point", "Second point", "Third point"],
        duration: 6,
      },
      {
        type: "closing",
        heading: "Thank you",
        subheading: "OCSC",
        duration: 5,
      },
    ],
  };
  writeJson(out.full, config);
  return {
    ok: true,
    spec: out.rel,
    seconds: totalSeconds(config),
    scenes: timing(config),
  };
}

async function cmdRead(o) {
  const { spec, config, problems } = loadSpec(o);
  if (problems.length)
    return {
      ok: false,
      spec: spec.rel,
      seconds: Array.isArray(config?.scenes) ? totalSeconds(config) : 0,
      scenes: Array.isArray(config?.scenes) ? timing(config) : [],
      problems,
    };
  const prepared = await prepare(spec, config);
  prepared.problems.push(...endingProblems(prepared.config));
  return {
    ok: prepared.problems.length === 0,
    spec: spec.rel,
    title: config.title,
    size: `${config.settings.width}x${config.settings.height} @ ${config.settings.fps}fps`,
    seconds: totalSeconds(prepared.config),
    audio: prepared.audio,
    scenes: timing(prepared.config),
    ...(prepared.fitted.length ? { fitted_to_voiceover: prepared.fitted } : {}),
    ...(prepared.warnings.length ? { warnings: prepared.warnings } : {}),
    ...(prepared.problems.length ? { problems: prepared.problems } : {}),
  };
}

/** The spec ready to render: checked, voiceovers fitted, workspace files served. */
async function forRender(o) {
  const { spec, config, problems } = loadSpec(o);
  if (problems.length) throw new UsageError(problems.join(" "));
  const prepared = await prepare(spec, config);
  if (prepared.problems.length) throw new UsageError(prepared.problems.join(" "));
  const served = await serveMedia(prepared);
  return { spec, prepared, ...served };
}

async function cmdStill(o) {
  const { spec, prepared, config, close } = await forRender(o);
  try {
    return await still(o, spec, prepared, config);
  } finally {
    close();
  }
}

async function still(o, spec, prepared, config) {
  const rows = timing(config);
  const n = o.scene === undefined ? 1 : Number(o.scene);
  const row = rows[n - 1];
  if (!Number.isInteger(n) || !row) throw new UsageError(`--scene must be 1 to ${rows.length}.`);
  const at =
    o.at === undefined
      ? Math.round(Math.min(row.duration * 0.6, row.duration - 0.05) * 100) / 100
      : Number(o.at);
  if (!Number.isFinite(at) || at < 0 || at >= row.duration)
    throw new UsageError(`--at must be seconds within scene ${n} (0 to ${row.duration}).`);
  const out = inWorkspace(
    typeof o.out === "string"
      ? o.out
      : `${spec.rel.replace(/\.video\.json$|\.json$/, "")}-scene${n}.png`,
    "--out",
  );
  const serveUrl = await bundleFor(spec, config);
  const comp = await composition(serveUrl, config);
  const { renderStill } = await renderer();
  const scale = o.small === true ? 0.5 : 1;
  mkdirSync(dirname(out.full), { recursive: true });
  await renderStill({
    composition: comp,
    serveUrl,
    output: out.full,
    frame: Math.min(comp.durationInFrames - 1, Math.round((row.start + at) * comp.fps)),
    inputProps: { config },
    scale,
    imageFormat: "png",
    logLevel: "error",
  });
  return {
    ok: true,
    spec: spec.rel,
    scene: n,
    at,
    ...(prepared.warnings.length ? { warnings: prepared.warnings } : {}),
    ...downloadLink(out.rel),
    ...(await showOnScreen(out.full, out.rel)),
  };
}

/** Downloads a photo, clip, voiceover or music track into the workspace for a spec to use. */
async function cmdFetch(o) {
  if (typeof o.url !== "string" || !/^https:\/\//i.test(o.url))
    throw new UsageError("--url must be an https link.");
  const out = inWorkspace(o.out, "--out");
  const ext = extname(out.full).toLowerCase();
  if (!MIME[ext]) throw new UsageError(`--out must end in one of ${Object.keys(MIME).join(", ")}.`);
  const res = await fetch(o.url, {
    redirect: "follow",
    signal: AbortSignal.timeout(110_000),
  });
  if (!res.ok || !res.body) throw new UsageError(`The download failed: HTTP ${res.status}.`);
  if (Number(res.headers.get("content-length")) > FETCH_MAX_BYTES)
    throw new UsageError("That file is over 400 MB.");
  const { Readable, Transform } = await import("node:stream");
  const { pipeline } = await import("node:stream/promises");
  mkdirSync(dirname(out.full), { recursive: true });
  const tmp = `${out.full}.part`;
  let bytes = 0;
  try {
    await pipeline(
      Readable.fromWeb(res.body),
      new Transform({
        transform(chunk, _encoding, done) {
          bytes += chunk.length;
          if (bytes > FETCH_MAX_BYTES) done(new UsageError("That file is over 400 MB."));
          else done(null, chunk);
        },
      }),
      createWriteStream(tmp),
    );
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
  renameSync(tmp, out.full);
  let seconds;
  if (/^(audio|video)\//.test(MIME[ext]))
    try {
      seconds = await mediaSeconds(out.full);
    } catch {}
  return {
    ok: true,
    path: out.rel,
    bytes,
    ...(seconds ? { seconds: Math.round(seconds * 100) / 100 } : {}),
  };
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function jobFile(id) {
  if (!/^[0-9a-f-]{36}$/.test(String(id))) throw new UsageError("That is not a render job id.");
  return join(JOBS, `${id}.json`);
}

/** The newest job, or the one named; a job whose worker died is reported as failed. */
function findJob(id) {
  let file;
  if (id && id !== true) file = jobFile(id);
  else {
    if (!existsSync(JOBS)) throw new UsageError("No video has been rendered on this computer yet.");
    const newest = readdirSync(JOBS)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ f, t: statSync(join(JOBS, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0];
    if (!newest) throw new UsageError("No video has been rendered on this computer yet.");
    file = join(JOBS, newest.f);
  }
  if (!existsSync(file)) throw new UsageError("There is no render job with that id.");
  const job = readJson(file);
  if (["starting", "bundling", "rendering", "finishing"].includes(job.status) && !alive(job.pid)) {
    job.status = "failed";
    job.error = job.error || "The render stopped unexpectedly. Run ocsc-video render again.";
    writeJson(file, job);
  }
  return { file, job };
}

function running() {
  if (!existsSync(JOBS)) return null;
  for (const f of readdirSync(JOBS)) {
    if (!f.endsWith(".json")) continue;
    try {
      const job = readJson(join(JOBS, f));
      if (["starting", "bundling", "rendering", "finishing"].includes(job.status) && alive(job.pid))
        return job;
    } catch {}
  }
  return null;
}

function cmdRender(o) {
  const { spec, config, problems } = loadSpec(o);
  if (!problems.length) problems.push(...endingProblems(config));
  if (problems.length) return { ok: false, spec: spec.rel, problems };
  const quality =
    o.draft === true ? "draft" : typeof o.quality === "string" ? o.quality : "standard";
  if (!QUALITY[quality]) throw new UsageError("--quality must be draft, standard or master.");
  if (quality === "master" && config.settings.width * 2 > 3840)
    throw new UsageError("master doubles the size, so the spec must be 1920 wide or less.");
  const busy = running();
  if (busy)
    throw new UsageError(
      `A render is already running (job ${busy.id}, ${busy.out}). Run ocsc-video wait --job ${busy.id}, or ocsc-video cancel.`,
    );
  const out = inWorkspace(
    typeof o.out === "string"
      ? o.out
      : spec.rel.replace(/\.video\.json$|\.json$/, "") +
          (quality === "draft" ? "-draft.mp4" : quality === "master" ? "-4k.mp4" : ".mp4"),
    "--out",
  );
  if (extname(out.rel).toLowerCase() !== ".mp4")
    throw new UsageError("--out must be an .mp4 file.");
  const id = randomUUID();
  const file = jobFile(id);
  const job = {
    id,
    status: "starting",
    spec: spec.rel,
    out: out.rel,
    quality,
    seconds: totalSeconds(config),
    progress: 0,
    startedAt: new Date().toISOString(),
  };
  writeJson(file, job);
  mkdirSync(JOBS, { recursive: true });
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "_work", "--job", id], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  writeJson(file, { ...job, pid: child.pid });
  return {
    ok: true,
    job: id,
    status: "started",
    out: out.rel,
    seconds: job.seconds,
    next: `Run: ocsc-video wait --job ${id}`,
  };
}

/**
 * A long video is rendered as short segments, each in a fresh browser and encoder, then joined:
 * memory stays at one segment's worth however long the video is, and a crashed segment is
 * rendered again instead of failing the whole video.
 */
const SEGMENT_SECONDS = 15;
const SEGMENT_ATTEMPTS = 4;
const MB = 1024 * 1024;

/** x264's default lookahead and one thread per host core need more memory than the computer has. */
function leanEncoder({ args }) {
  if (!args.includes("libx264")) return args;
  return [
    ...args.slice(0, -1),
    "-threads",
    "2",
    "-x264-params",
    "rc-lookahead=10:sync-lookahead=0",
    args[args.length - 1],
  ];
}

async function withRetries(what, attemptOnce) {
  let lastError;
  for (let attempt = 1; attempt <= SEGMENT_ATTEMPTS; attempt += 1) {
    try {
      return await attemptOnce(attempt);
    } catch (error) {
      if (error instanceof UsageError) throw error;
      lastError = error;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  throw new Error(
    `Rendering ${what} failed ${SEGMENT_ATTEMPTS} times: ${String(lastError?.message || lastError).slice(0, 1500)}`,
  );
}

async function renderInSegments({ comp, serveUrl, config, quality, tmp, hasAudio, update }) {
  const { renderMedia } = await renderer();
  const total = comp.durationInFrames;
  const size = Math.max(1, Math.round(comp.fps * SEGMENT_SECONDS));
  const dir = `${tmp}.segments`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const common = {
    composition: comp,
    serveUrl,
    inputProps: { config },
    overwrite: true,
    logLevel: "error",
    offthreadVideoCacheSizeInBytes: 192 * MB,
    offthreadVideoThreads: 1,
    mediaCacheSizeInBytes: 192 * MB,
  };
  try {
    const segments = [];
    for (let start = 0; start < total; start += size) {
      const end = Math.min(total, start + size) - 1;
      const file = join(dir, `${String(segments.length).padStart(4, "0")}.mp4`);
      await withRetries(`frames ${start}-${end}`, (attempt) =>
        renderMedia({
          ...common,
          ...QUALITY[quality],
          codec: "h264",
          frameRange: [start, end],
          muted: true,
          outputLocation: file,
          pixelFormat: "yuv420p",
          colorSpace: "bt709",
          concurrency: attempt === 1 ? Math.max(1, Math.min(2, Math.floor(cpuCount() / 2))) : 1,
          ffmpegOverride: leanEncoder,
          onProgress: ({ renderedFrames, encodedFrames }) =>
            update({
              progress: Math.min(
                99,
                Math.round(((start + encodedFrames) / total) * (hasAudio ? 95 : 100)),
              ),
              renderedFrames: start + renderedFrames,
              encodedFrames: start + encodedFrames,
            }),
        }),
      );
      segments.push(file);
    }
    const list = join(dir, "segments.txt");
    writeFileSync(list, segments.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n"));
    let soundtrack = null;
    if (hasAudio) {
      soundtrack = join(dir, "soundtrack.wav");
      await withRetries("the soundtrack", () =>
        renderMedia({ ...common, codec: "wav", outputLocation: soundtrack, concurrency: 1 }),
      );
    }
    await ffmpeg([
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      ...(soundtrack ? ["-i", soundtrack] : []),
      "-map",
      "0:v:0",
      ...(soundtrack ? ["-map", "1:a:0", "-c:a", "pcm_s16le"] : []),
      "-c:v",
      "copy",
      "-y",
      tmp,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function work(o) {
  const file = jobFile(o.job);
  const job = readJson(file);
  let last = 0;
  const update = (patch, force = false) => {
    Object.assign(job, patch);
    const now = Date.now();
    if (!force && now - last < 1000) return;
    last = now;
    writeJson(file, job);
  };
  let close = () => undefined;
  try {
    update({ status: "bundling", pid: process.pid }, true);
    const ready = await forRender({ spec: job.spec });
    const { spec, prepared, config } = ready;
    close = ready.close;
    update({ seconds: totalSeconds(config) });
    const serveUrl = await bundleFor(spec, config);
    update({ status: "rendering" }, true);
    const comp = await withRetries("the video's layout", () => composition(serveUrl, config));
    const out = inWorkspace(job.out, "--out");
    mkdirSync(dirname(out.full), { recursive: true });
    const tmp = `${out.full}.part.mkv`;
    const segmented = (quality) =>
      renderInSegments({
        comp,
        serveUrl,
        config,
        quality,
        tmp,
        hasAudio: Boolean(prepared.audio.music || prepared.audio.voices || prepared.audio.effects),
        update,
      });
    const requested = job.quality ?? "standard";
    try {
      await segmented(requested);
    } catch (error) {
      if (requested === "draft") throw error;
      // A finished video at half size beats no video; the note tells the Bot to say so.
      update(
        {
          progress: 0,
          note: `The ${requested} render kept failing (${String(error?.message || error).slice(0, 300)}), so this file is draft quality (half size). Tell the person, and offer to render ${requested} again later.`,
        },
        true,
      );
      await segmented("draft");
    }
    update({ status: "finishing" }, true);
    await finish(tmp, out.full, prepared.audio);
    rmSync(tmp, { force: true });
    update(
      {
        status: "done",
        progress: 100,
        bytes: statSync(out.full).size,
        finishedAt: new Date().toISOString(),
      },
      true,
    );
  } catch (error) {
    update(
      {
        status: "failed",
        error: String(error?.message || error).slice(0, 3000),
        finishedAt: new Date().toISOString(),
      },
      true,
    );
    process.exitCode = 1;
  } finally {
    close();
  }
}

function report(job) {
  const base = {
    job: job.id,
    status: job.status,
    spec: job.spec,
    out: job.out,
    progress: job.progress,
  };
  if (job.status === "done")
    return {
      ok: true,
      ...base,
      bytes: job.bytes,
      ...(job.note ? { note: job.note } : {}),
      ...downloadLink(job.out),
    };
  if (job.status === "failed" || job.status === "cancelled")
    return { ok: false, ...base, error: job.error };
  return {
    ok: true,
    ...base,
    renderedFrames: job.renderedFrames,
    next: `Still rendering. Run: ocsc-video wait --job ${job.id}`,
  };
}

async function cmdWait(o) {
  const seconds = Math.min(MAX_WAIT_SECONDS, Math.max(1, Number(o.seconds) || 100));
  const until = Date.now() + seconds * 1000;
  let { file, job } = findJob(o.job);
  while (!["done", "failed", "cancelled"].includes(job.status) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1000));
    ({ job } = findJob(job.id));
  }
  const result = report(job);
  if (job.status === "done" && !job.shown) {
    const out = inWorkspace(job.out, "--out");
    Object.assign(result, await showOnScreen(out.full, out.rel));
    writeJson(file, { ...job, shown: true });
  }
  return result;
}

function cmdCancel(o) {
  const { file, job } = findJob(o.job);
  if (!["starting", "bundling", "rendering", "finishing"].includes(job.status))
    return { ok: true, job: job.id, status: job.status };
  try {
    process.kill(-job.pid, "SIGTERM");
  } catch {
    try {
      process.kill(job.pid, "SIGTERM");
    } catch {}
  }
  writeJson(file, {
    ...job,
    status: "cancelled",
    error: "Cancelled.",
    finishedAt: new Date().toISOString(),
  });
  return { ok: true, job: job.id, status: "cancelled" };
}

const USAGE = `ocsc-video scenes
ocsc-video templates [--kind template|shot] [--category NAME] [--name NAME]
ocsc-video new --out outputs/X.video.json [--title "..."] [--vertical] [--force]
ocsc-video read --spec outputs/X.video.json
ocsc-video still --spec outputs/X.video.json [--scene N] [--at seconds] [--out outputs/X.png] [--small]
ocsc-video render --spec outputs/X.video.json [--out outputs/X.mp4] [--quality draft|standard|master]
ocsc-video fetch --url https://... --out outputs/media/X.mp3
ocsc-video wait [--job ID] [--seconds 100]
ocsc-video cancel [--job ID]`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const o = args(rest);
  // Remotion finds the Chrome it renders with under the working directory, and the image installs
  // it here. Workspace paths are resolved from WORKSPACE, never the working directory.
  process.chdir(HERE);
  if (command === "_work") return work(o);
  try {
    let result;
    if (command === "scenes") result = cmdScenes();
    else if (command === "templates") result = cmdTemplates(o);
    else if (command === "new") result = cmdNew(o);
    else if (command === "read") result = await cmdRead(o);
    else if (command === "fetch") result = await cmdFetch(o);
    else if (command === "still") result = await cmdStill(o);
    else if (command === "render") result = cmdRender(o);
    else if (command === "wait") result = await cmdWait(o);
    else if (command === "cancel") result = cmdCancel(o);
    else throw new UsageError(`Usage:\n${USAGE}`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.ok === false) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: error instanceof UsageError ? error.message : String(error?.message || error) }, null, 2)}\n`,
    );
    process.exitCode = 1;
  }
}

main();
