import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { build, type Message, type Plugin, transform } from "esbuild";
import { compile } from "tailwindcss";
import type { AppInit } from "../protocol.js";
import { VISUAL_EDIT_CLASSES } from "../visual-edit.js";
import { URBANIST_FACE } from "./urbanist-face.js";

/**
 * Turns an app's source files into one self-contained HTML document (and the same code as a
 * plugin bundle for Evolve). Everything runs on the server: esbuild bundles the files with React,
 * motion, recharts, lucide and the OCSC kit, and Tailwind generates only the classes used by the
 * app and by the kit components it actually bundles. App code can import nothing else and read nothing from the server's disk.
 */

const require = createRequire(import.meta.url);
const KIT_DIR = path.dirname(require.resolve("@rakazo/app-kit/package.json"));
const kitRequire = createRequire(path.join(KIT_DIR, "package.json"));
const SRC = path.join(KIT_DIR, "src");

export const ALLOWED_IMPORTS = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "motion/react",
  "framer-motion",
  "lucide-react",
  "recharts",
  "@ocsc/ui",
  "@ocsc/app",
] as const;

const KIT_ALIASES: Record<string, string> = {
  "@ocsc/ui": path.join(SRC, "ui/index.ts"),
  "@ocsc/app": path.join(SRC, "sdk/index.tsx"),
  "@ocsc/jsx/jsx-dev-runtime": path.join(SRC, "build/jsx-dev-runtime.ts"),
};

export const MAX_FILES = 80;
export const MAX_FILE_BYTES = 300_000;
export const MAX_SOURCE_BYTES = 1_500_000;
/** Evolve takes plugin bundles up to 2 MB; the app document allows a little more for the fixture. */
export const MAX_BUNDLE_BYTES = 2_000_000;

const FILE_PATH = /^(?:[A-Za-z0-9_-]+\/){0,4}[A-Za-z0-9_.-]+\.(?:tsx|ts|jsx|js|json|css|md)$/;

export type AppFiles = Record<string, string>;

export type BuildProblem = { file?: string; line?: number; column?: number; message: string };

export type BuildResult =
  | {
      ok: true;
      html: string;
      js: string;
      css: string;
      bytes: number;
      hash: string;
      /** Script kilobytes by package, largest first, so a heavy app shows what to drop. */
      weight: Array<{ part: string; kb: number }>;
      warnings: BuildProblem[];
    }
  | { ok: false; errors: BuildProblem[]; warnings: BuildProblem[] };

export type BuildOptions = {
  title?: string;
  /** Preview builds tag elements with their source line for the Studio picker. */
  mode?: "preview" | "publish";
  /** Built-in sample data so the document runs with no host (screenshots, offline previews). */
  fixture?: Partial<AppInit> & { assets?: Record<string, string> };
  theme?: "light" | "dark";
};

/** The first problem with a set of files, or null when they can be built. */
export function checkFiles(files: AppFiles): string | null {
  const names = Object.keys(files);
  if (!names.length) return "An app needs at least App.tsx.";
  if (!Object.hasOwn(files, "App.tsx")) return "An app needs an App.tsx with a default export.";
  if (names.length > MAX_FILES) return `An app can have at most ${MAX_FILES} files.`;
  let total = 0;
  for (const name of names) {
    if (!FILE_PATH.test(name) || name.includes("..")) {
      return `${name}: file names are letters, digits, - _ . and up to four folders, ending .tsx .ts .jsx .js .json .css or .md.`;
    }
    const text = files[name];
    if (typeof text !== "string") return `${name}: file contents must be text.`;
    const bytes = Buffer.byteLength(text);
    if (bytes > MAX_FILE_BYTES) return `${name} is larger than ${Math.round(MAX_FILE_BYTES / 1000)} KB; split it up.`;
    total += bytes;
  }
  if (total > MAX_SOURCE_BYTES) return "The app's files are too large together.";
  const asking = names.find((name) => !name.endsWith(".md") && CREDENTIAL_FIELD.test(files[name]!));
  if (asking) return `${asking}: ${CREDENTIAL_FIELD_MESSAGE}`;
  return null;
}

/**
 * A password box, a browser password hint, a masked text field or a password attribute set from
 * code. Staff are already signed in, so an app asking for a password is impersonating a sign-in.
 */
export const CREDENTIAL_FIELD =
  /\btype\s*[=:]\s*\{?\s*["'`]password["'`]|["'`](?:current|new)-password["'`]|text-security\s*:|["'`]type["'`]\s*,\s*["'`]password["'`]/i;
export const CREDENTIAL_FIELD_MESSAGE =
  "apps never ask for passwords or sign-in details; remove the password field. People are already signed in to OCSC.";

const CODE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".json"];

function resolveInApp(files: AppFiles, from: string, request: string): string | null {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), request));
  if (base.startsWith("..") || base.startsWith("/")) return null;
  const stripped = base.replace(/\.(js|jsx)$/, "");
  const candidates = [base, ...CODE_EXTENSIONS.map((ext) => `${stripped}${ext}`), ...CODE_EXTENSIONS.map((ext) => `${base}/index${ext}`)];
  return candidates.find((candidate) => Object.hasOwn(files, candidate)) ?? null;
}

function appPlugin(files: AppFiles): Plugin {
  return {
    name: "ocsc-app",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (args.pluginData?.inner) return undefined;
        if (args.kind === "entry-point") return { path: ENTRY_FILE, namespace: "app" };
        const fromApp = args.namespace === "app";
        if (KIT_ALIASES[args.path]) return { path: KIT_ALIASES[args.path] };
        if (args.path === "@ocsc/jsx/jsx-runtime") {
          return builder.resolve("react/jsx-runtime", { kind: args.kind, resolveDir: SRC, pluginData: { inner: true } });
        }
        if (!fromApp) return undefined;
        if (args.path.startsWith(".")) {
          const resolved = resolveInApp(files, args.importer, args.path);
          if (!resolved) return { errors: [{ text: `Cannot find ${args.path} among the app's files.` }] };
          return { path: resolved, namespace: "app" };
        }
        if ((ALLOWED_IMPORTS as readonly string[]).includes(args.path) || args.path === "react-dom/client") {
          const target = args.path === "framer-motion" ? "motion/react" : args.path;
          return builder.resolve(target, { kind: args.kind, resolveDir: SRC, pluginData: { inner: true } });
        }
        return {
          errors: [
            {
              text: `Apps cannot import "${args.path}". Use relative files or one of: ${ALLOWED_IMPORTS.join(", ")}.`,
            },
          ],
        };
      });
      builder.onLoad({ filter: /.*/, namespace: "app" }, (args) => {
        const contents = args.path === ENTRY_FILE ? ENTRY : files[args.path];
        if (contents === undefined) return { errors: [{ text: `Missing file ${args.path}.` }] };
        const ext = path.posix.extname(args.path).slice(1);
        if (ext === "css" || ext === "md") return { contents: "", loader: "js" };
        return { contents, loader: ext as "tsx" | "ts" | "jsx" | "js" | "json", resolveDir: SRC };
      });
    },
  };
}

const problem = (message: Message): BuildProblem => ({
  file: message.location?.file?.replace(/^app:/, ""),
  line: message.location?.line,
  column: message.location?.column,
  message: message.text,
});

let kitStyles: Promise<string> | undefined;

type BundledInputs = Record<string, { bytesInOutput: number }>;

const PART_NAMES: Array<[RegExp, string]> = [
  [/^(?:react|react-dom|scheduler)$/, "react"],
  [/^(?:motion|motion-dom|motion-utils|framer-motion)$/, "motion"],
  [/^(?:recharts|victory-vendor|d3-.+|es-toolkit|decimal\.js-light|@reduxjs\/toolkit|redux|redux-thunk|reselect|react-redux|immer|use-sync-external-store|eventemitter3|tiny-invariant|clsx|internmap)$/, "recharts"],
];

/** Groups bundled bytes by what the app pulled in: react, motion, recharts, lucide, the kit, the app. */
export function bundleWeight(inputs: BundledInputs): Array<{ part: string; kb: number }> {
  const totals = new Map<string, number>();
  for (const [name, info] of Object.entries(inputs)) {
    let part: string;
    const pkg = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/.exec(name)?.[1];
    if (name.startsWith("app:")) part = "app code";
    else if (pkg) part = PART_NAMES.find(([pattern]) => pattern.test(pkg))?.[1] ?? pkg;
    else part = name.includes(`${path.sep}sdk${path.sep}`) || name.includes("/sdk/") ? "@ocsc/app" : "@ocsc/ui";
    totals.set(part, (totals.get(part) ?? 0) + info.bytesInOutput);
  }
  return [...totals]
    .map(([part, bytes]) => ({ part, kb: Math.round(bytes / 1000) }))
    .filter((item) => item.kb > 0)
    .sort((a, b) => b.kb - a.kb)
    .slice(0, 8);
}

const CANDIDATE_SPLIT = /[\s"'`{};,<>()]+/;

/** Every token in the text that could be a class name; Tailwind ignores the rest. */
export function classCandidates(text: string): Set<string> {
  const out = new Set<string>();
  for (const token of text.split(CANDIDATE_SPLIT)) {
    if (token && token.length < 200 && /^[!-]?[a-z@[*]/.test(token)) out.add(token.replace(/^!/, ""));
  }
  // Arbitrary values may contain parentheses (bg-[radial-gradient(...)]); keep them whole.
  for (const match of text.matchAll(/[!a-z0-9:_/.-]*\[[^\s"'`\]]+\][a-z0-9:_/.%-]*(?:\[[^\s"'`\]]+\][a-z0-9:_/.%-]*)?/g)) {
    out.add(match[0].replace(/^!/, ""));
  }
  return out;
}

async function loadStylesheet(id: string, base: string) {
  if (id === "tailwindcss" || id.startsWith("tailwindcss/")) {
    const file = id === "tailwindcss" ? kitRequire.resolve("tailwindcss/index.css") : kitRequire.resolve(id.endsWith(".css") ? id : `${id}.css`);
    return { path: file, base: path.dirname(file), content: await readFile(file, "utf8") };
  }
  throw new Error(`Stylesheets can only import tailwindcss (not ${id}) — put styles in styles.css.`);
}

/**
 * CSS for the classes in the bundled script, which holds the app's code and only the kit code it
 * uses (minifying keeps class strings whole), plus the app's own source for anything else.
 */
async function buildCss(js: string, source: string, extraCss: string): Promise<string> {
  kitStyles ??= readFile(path.join(SRC, "ui/styles.css"), "utf8");
  const styles = await kitStyles;
  const compiler = await compile(`${styles}\n${extraCss}`, {
    base: SRC,
    loadStylesheet,
    loadModule: async (id: string) => {
      throw new Error(`Tailwind plugins are not available in apps (${id}).`);
    },
  });
  const css = compiler.build([...classCandidates(js), ...classCandidates(source)]);
  const minified = await transform(css, { loader: "css", minify: true, target: ["chrome111", "safari16.4"] });
  return minified.code;
}

const ENTRY_FILE = "__entry__.tsx";
const ENTRY = `import App from "./App";\nimport { mount } from "@ocsc/app";\nmount(App);\n`;

/** Makes text safe inside an inline script element. */
export function inlineScript(text: string): string {
  return text.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);

/** The app as a full HTML document: font, styles, optional sample data and the script. */
export function composeDocument({ title, css, js, fixture, theme }: { title: string; css: string; js: string; fixture?: unknown; theme?: "light" | "dark" }) {
  const dark = theme === "dark";
  return [
    `<!doctype html><html lang="en"${dark ? ' class="dark" style="color-scheme:dark"' : ""}><head><meta charset="utf-8">`,
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${URBANIST_FACE}${css}</style></head><body><div id="root"></div>`,
    fixture ? `<script>window.__OCSC_APP_FIXTURE__=${inlineScript(JSON.stringify(fixture))};</script>` : "",
    `<script>${inlineScript(js)}</script></body></html>`,
  ].join("");
}

/** Builds an app; errors point at the app's own file and line so the agent can fix them. */
export async function buildApp(files: AppFiles, options: BuildOptions = {}): Promise<BuildResult> {
  const invalid = checkFiles(files);
  if (invalid) return { ok: false, errors: [{ message: invalid }], warnings: [] };
  const preview = options.mode === "preview";
  let output: Awaited<ReturnType<typeof build>>;
  try {
    output = await build({
      entryPoints: [ENTRY_FILE],
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: ["es2022", "safari16"],
      minify: true,
      jsx: "automatic",
      jsxDev: preview,
      jsxImportSource: preview ? "@ocsc/jsx" : "react",
      tsconfigRaw: { compilerOptions: { jsx: "react-jsx" } },
      define: { "process.env.NODE_ENV": '"production"' },
      legalComments: "none",
      logLevel: "silent",
      charset: "utf8",
      plugins: [appPlugin(files)],
      metafile: true,
    });
  } catch (error) {
    const failure = error as { errors?: Message[]; warnings?: Message[] };
    return {
      ok: false,
      errors: (failure.errors ?? [{ text: String(error) } as Message]).map(problem).slice(0, 20),
      warnings: (failure.warnings ?? []).map(problem).slice(0, 20),
    };
  }
  const js = output.outputFiles?.[0]?.text ?? "";
  const inputs: BundledInputs = Object.values(output.metafile?.outputs ?? {})[0]?.inputs ?? {};
  const source = Object.entries(files)
    .filter(([name]) => /\.(tsx|ts|jsx|js)$/.test(name))
    .map(([, text]) => text)
    .join("\n");
  const extraCss = Object.entries(files)
    .filter(([name]) => name.endsWith(".css"))
    .map(([, text]) => text)
    .join("\n");
  const outside = /@import\s+(?!["']tailwindcss)|@(?:plugin|config)\b/.exec(extraCss);
  if (outside) {
    return { ok: false, errors: [{ file: "styles.css", message: "Stylesheets cannot import other files or plugins; write the styles in styles.css." }], warnings: [] };
  }
  let css: string;
  try {
    // The Studio's preview can show a visual edit before it is saved, so it carries those classes.
    css = await buildCss(js, preview ? `${source}\n${VISUAL_EDIT_CLASSES.join(" ")}` : source, extraCss);
  } catch (error) {
    return { ok: false, errors: [{ file: "styles.css", message: error instanceof Error ? error.message : String(error) }], warnings: [] };
  }
  const bytes = Buffer.byteLength(js) + Buffer.byteLength(css);
  if (bytes > MAX_BUNDLE_BYTES) {
    return {
      ok: false,
      errors: [{ message: `The built app is ${Math.round(bytes / 1000)} KB; the limit is ${MAX_BUNDLE_BYTES / 1000} KB. Move data into tables instead of code.` }],
      warnings: [],
    };
  }
  const html = composeDocument({ title: options.title ?? "App", css, js, fixture: options.fixture, theme: options.theme });
  return {
    ok: true,
    html,
    js,
    css,
    bytes,
    hash: createHash("sha256").update(js).update(css).digest("base64url").slice(0, 22),
    weight: bundleWeight(inputs),
    warnings: output.warnings.map(problem).slice(0, 20),
  };
}

/** The same app as an Evolve plugin bundle: index.html loading assets/app.js and assets/app.css. */
export function pluginBundle(result: Extract<BuildResult, { ok: true }>, title: string): Record<string, string> {
  return {
    "index.html": `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="./assets/app.css"></head><body><div id="root"></div><script src="./assets/app.js"></script></body></html>`,
    "assets/app.js": result.js,
    "assets/app.css": `${URBANIST_FACE}${result.css}`,
  };
}

const LIGHT_ONLY_CLASS =
  /\b(?:bg-white|bg-(?:slate|gray|zinc|stone|neutral)-(?:50|100|200)|text-(?:slate|gray|zinc|stone|neutral)-(?:500|600|700|800|900)|border-(?:slate|gray|zinc|stone|neutral)-(?:100|200|300)|bg-(?:amber|red|green|blue)-50|text-(?:amber|red|green|blue)-900)\b/g;
const OFF_BRAND_CLASS =
  /\b(?:bg|text|border|ring)-(?:blue|indigo|purple|violet|fuchsia)-\d{2,3}\b/g;
const HEX_COLOR = /#[0-9a-fA-F]{6}\b/g;
const KIT_VISUAL =
  /\b(?:AreaChart|BarChart|LineChart|DonutChart|BarList|FunnelChart|ScatterChart|CalendarHeatmap|Heatmap|Gauge|Ring|Sparkline)\b/;
const KIT_WORKFLOW =
  /\b(?:Kanban|Gantt|CalendarMonth|Timeline|Checklist|Steps|MapView|PhotoMap|GalleryView|CompareImages|Whiteboard|OrgChart|TreeView|SortableList|SketchPad|ImageViewer|VideoPlayer|SplitPane)\b/;

export type CraftAuditOptions = {
  isNew?: boolean;
  fromTemplate?: boolean;
  totalRows?: number;
};

/**
 * Non-blocking design and kit-usage notes returned by save_app and app_look so the builder catches
 * bare layouts, missing visualizations, raw hex/slate styles that break dark mode, and empty v1s.
 */
export function auditAppCraft(files: AppFiles, options: CraftAuditOptions = {}): string[] {
  const code = Object.entries(files)
    .filter(([name]) => /\.(tsx|ts|jsx|js)$/.test(name))
    .map(([, text]) => text)
    .join("\n");
  const styles = Object.entries(files)
    .filter(([name]) => name.endsWith(".css"))
    .map(([, text]) => text)
    .join("\n");
  if (!code.trim()) return [];

  const notes: string[] = [];
  const lightHits = [...new Set(code.match(LIGHT_ONLY_CLASS) ?? [])].slice(0, 4);
  if (lightHits.length) {
    notes.push(
      `Uses light-only classes (${lightHits.join(", ")}) that break dark mode and Theme presets. Replace with semantic tokens (bg-card, bg-muted, bg-surface, text-foreground, text-muted-foreground, border-border) or <Callout> / <Badge>.`,
    );
  }
  const offBrand = [...new Set(code.match(OFF_BRAND_CLASS) ?? [])].slice(0, 4);
  if (offBrand.length) {
    notes.push(
      `Uses off-brand blue/purple classes (${offBrand.join(", ")}); keep OCSC brand green (primary) and semantic tones (success, warning, danger, info, accent).`,
    );
  }
  const hexWithoutPicker = `${code}\n${styles}`
    .split("\n")
    .filter((line) => !line.includes("ColorPicker"))
    .join("\n");
  const hexHits = [...new Set(hexWithoutPicker.match(HEX_COLOR) ?? [])].slice(0, 3);
  if (hexHits.length) {
    notes.push(
      `Hardcoded hex colours (${hexHits.join(", ")}) bypass light/dark themes; use <Theme />, hsl(var(--primary)), bg-primary/12, text-primary or CHART_COLORS.`,
    );
  }
  if (!KIT_VISUAL.test(code)) {
    notes.push(
      "No @ocsc/ui chart or visual indicator is used. Add kit visuals (AreaChart, BarChart, DonutChart, BarList, FunnelChart, Gauge, Ring, Heatmap, CalendarHeatmap or KpiCard trend) instead of plain counts or hand-rolled div bars.",
    );
  }
  if (/<AppShell\b/.test(code)) {
    const pageDefs = code.match(/\{\s*id\s*:\s*["'`][A-Za-z0-9_-]+["'`]\s*,\s*label\s*:/g) ?? [];
    if (pageDefs.length < 3 || !KIT_WORKFLOW.test(code)) {
      notes.push(
        "Give the app at least 3 tabs including an interactive workflow view (Kanban, Gantt, CalendarMonth, Timeline, Checklist, MapView, GalleryView, Whiteboard, TreeView or SortableList) alongside Overview and TableView — never just Overview plus table tabs.",
      );
    }
    if (!/\bcommands\b/.test(code)) {
      notes.push(
        "Pass commands on AppShell (commands or custom Command[] actions) so staff get instant ⌘K search and quick actions.",
      );
    }
    if (/\b(?:TableView|DataTable)\b/.test(code) && !/\b(?:PrintButton|printPdf)\b/.test(code)) {
      notes.push(
        "Add <PrintButton size=\"sm\" document={() => ...} /> in AppShell actions (or page actions) so staff can export a branded OCSC PDF report of the register or summary.",
      );
    }
  }
  if (/font-size\s*:\s*16px\s*!important/i.test(code) || /font-size\s*:\s*16px\s*!important/i.test(styles)) {
    notes.push(
      "Remove manual <style> font-size !important hacks; @ocsc/ui fields already render at 16px on phones and touch screens.",
    );
  }
  if (!/<Theme\b/.test(code)) {
    notes.push(
      'Set <Theme preset="evolve"|"crisp"|"soft"|"forest"|"contrast" /> near the top of App so surfaces, corners and density fit the domain.',
    );
  }
  if (options.isNew && !options.fromTemplate && options.totalRows === 0 && !/\buseEvolve\b|\bevolve\.read\b/.test(code)) {
    notes.push(
      "Tables were saved with 0 rows, so charts, boards and app_look screenshots render empty. Unless the user asked for an empty slate, seed 8–12 realistic starter rows with hidden boolean column is_sample: true and show <SampleBanner tables={[...]} /> for one-click clearing.",
    );
  }
  const appLines = (files["App.tsx"] ?? "").split("\n").length;
  if (appLines > 320 && Object.keys(files).length === 1) {
    notes.push(
      `App.tsx is ${appLines} lines in a single file; split screens or PDF/report builders into separate files (e.g. Overview.tsx, BoardView.tsx, report.ts) so edits stay fast and clean.`,
    );
  }
  return notes;
}
