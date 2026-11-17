import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { build, type Message, type Plugin, transform } from "esbuild";
import { compile } from "tailwindcss";
import type { AppInit } from "../protocol.js";
import { pythonProblem } from "../python/envelope.js";
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
  "@ocsc/calc",
  "@ocsc/python",
  "@ocsc/eng",
  "@ocsc/math",
  "@ocsc/plot",
  "@ocsc/dxf",
  "@ocsc/sheets",
  "@ocsc/ifc",
] as const;

const KIT_ALIASES: Record<string, string> = {
  "@ocsc/ui": path.join(SRC, "ui/index.ts"),
  "@ocsc/app": path.join(SRC, "sdk/index.tsx"),
  "@ocsc/calc": path.join(SRC, "calc/kit.tsx"),
  "@ocsc/python": path.join(SRC, "python/index.ts"),
  "@ocsc/eng": path.join(SRC, "eng/index.ts"),
  "@ocsc/math": path.join(SRC, "math/index.tsx"),
  "@ocsc/plot": path.join(SRC, "plot/index.ts"),
  "@ocsc/dxf": path.join(SRC, "dxf/index.ts"),
  "@ocsc/sheets": path.join(SRC, "sheets/index.ts"),
  "@ocsc/ifc": path.join(SRC, "ifc/index.tsx"),
  "@ocsc/jsx/jsx-dev-runtime": path.join(SRC, "build/jsx-dev-runtime.ts"),
};

export const MAX_FILES = 80;
export const MAX_FILE_BYTES = 300_000;
export const MAX_SOURCE_BYTES = 1_500_000;
/** Evolve takes plugin bundles up to 2 MB; the app document allows a little more for the fixture. */
export const MAX_BUNDLE_BYTES = 2_000_000;

const FILE_PATH = /^(?:[A-Za-z0-9_-]+\/){0,4}[A-Za-z0-9_.-]+\.(?:tsx|ts|jsx|js|json|css|md|py)$/;

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
      return `${name}: file names are letters, digits, - _ . and up to four folders, ending .tsx .ts .jsx .js .json .css .md or .py.`;
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
  for (const name of names) {
    const problem = name.endsWith(".py") ? pythonProblem(files[name]!, name) : null;
    if (problem) return problem;
  }
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
        if (ext === "py") return { contents, loader: "text" };
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
  [/^katex$/, "@ocsc/math"],
];

/** Groups bundled bytes by what the app pulled in: react, motion, recharts, lucide, the kit, the app. */
export function bundleWeight(inputs: BundledInputs): Array<{ part: string; kb: number }> {
  const totals = new Map<string, number>();
  for (const [name, info] of Object.entries(inputs)) {
    let part: string;
    const pkg = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/.exec(name)?.[1];
    if (name.startsWith("app:")) part = "app code";
    else if (pkg) part = PART_NAMES.find(([pattern]) => pattern.test(pkg))?.[1] ?? pkg;
    else if (name.includes("/sdk/") || name.includes(`${path.sep}sdk${path.sep}`)) part = "@ocsc/app";
    else if (name.includes("/calc/") || name.includes(`${path.sep}calc${path.sep}`)) part = "@ocsc/calc";
    else if (name.includes("/python/") || name.includes(`${path.sep}python${path.sep}`)) part = "@ocsc/python";
    else if (/[/\\](?:eng|math|plot)[/\\]/.test(name)) part = `@ocsc/${/[/\\](eng|math|plot)[/\\]/.exec(name)![1]}`;
    else part = "@ocsc/ui";
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
      // Crash reports name the component (Tabs, Gantt) so the builder can fix the right props.
      keepNames: true,
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
/** Theme tokens hold "95 49% 51%", so they only make a colour inside hsl(). */
const BARE_TOKEN =
  /(?<!hsla?\(\s*)var\(--(?:primary|secondary|accent|background|foreground|card|popover|muted|border|input|ring|destructive|success|warning|danger|info|surface)(?:-foreground)?\b/g;
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
/** Whether the source still wears the OCSC shell, kit and theme. */
export function appLookMarks(files: AppFiles): { shell: boolean; kit: boolean; theme: boolean } {
  const code = Object.entries(files)
    .filter(([name]) => /\.(tsx|ts|jsx|js)$/.test(name))
    .map(([, text]) => text)
    .join("\n");
  return {
    shell: /<AppShell\b/.test(code),
    kit: /from\s+["']@ocsc\/ui["']/.test(code),
    theme: /<Theme\b/.test(code),
  };
}

const KEEP_APP_LOOK =
  "Keep AppShell, the @ocsc/ui import and <Theme /> and change the screens inside the shell. Do not replace the app with a hand-written layout. Nothing was saved.";

const BLANK_SHELL =
  "AppShell is on the page but its window is blank. Put each screen in pages={[{ id, label, render: () => (...) }]}, or between <AppShell> and </AppShell>. tabs, activeTab, onTabChange, activePage and onPageChange are not props. A self-closing <AppShell /> with the screens after it leaves them below a full-height empty shell. pages without render: () => ... also hides the window. Nothing was saved.";

/** Told to the builder after a refused or blank/broken save so it iterates like Lovable, not declaring done. */
export const FIX_APP_BEFORE_READY =
  "Fix this with save_app edits and call save_app again before telling the person the app is ready. Do not present a blank or broken version as done. A crash names the component it happened in (\"in Tabs < Overview\"): correct that component's props against the guide and keep every page and feature; never strip the app down to find the fault.";

/**
 * A `/.../` after an operator is a regular expression, so quotes inside it are not strings.
 * `match(/'([^']*)'/)` is the case that otherwise hides a later `<AppShell`.
 */
function skipRegex(code: string, index: number): number {
  if (code[index] !== "/" || code.startsWith("//", index) || code.startsWith("/*", index)) return index;
  let previous = index - 1;
  while (previous >= 0 && /\s/.test(code[previous]!)) previous--;
  const before = code[previous] ?? "";
  const keyword = /(?:^|[^$\w])(?:return|case|throw|typeof|void|delete|in|of)$/.test(code.slice(0, index));
  if (previous >= 0 && !keyword && !/[=(\[{,;:!&|?~^]/.test(before)) return index;
  let cursor = index + 1;
  let klass = false;
  while (cursor < code.length) {
    const ch = code[cursor]!;
    if (ch === "\\") {
      cursor += 2;
      continue;
    }
    if (ch === "[") klass = true;
    else if (ch === "]") klass = false;
    else if (ch === "/" && !klass) {
      cursor += 1;
      while (cursor < code.length && /[a-z]/i.test(code[cursor]!)) cursor += 1;
      return cursor;
    } else if (ch === "\n") return index;
    cursor += 1;
  }
  return index;
}

/** A comment starts here. `://` stays text, so a web address is not a comment. */
function skipComment(code: string, index: number): number {
  if (code.startsWith("/*", index)) {
    const end = code.indexOf("*/", index + 2);
    return end < 0 ? code.length : end + 2;
  }
  if (code.startsWith("//", index) && code[index - 1] !== ":") {
    const end = code.indexOf("\n", index + 2);
    return end < 0 ? code.length : end + 1;
  }
  return index;
}

type Quote = '"' | "'" | "`" | null;

/** Strip `//`, `/* *\/` and `{/* *\/}` so comment-only shell children are treated as empty. */
function stripShellNoise(code: string): string {
  let out = "";
  let i = 0;
  let quote: Quote = null;
  while (i < code.length) {
    if (quote) {
      out += code[i];
      if (code[i] === "\\" && i + 1 < code.length) {
        out += code[i + 1];
        i += 2;
        continue;
      }
      if (code[i] === quote) quote = null;
      i++;
      continue;
    }
    const ch = code[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (code.startsWith("{/*", i)) {
      const end = code.indexOf("*/}", i + 3);
      i = end < 0 ? code.length : end + 3;
      continue;
    }
    const comment = skipComment(code, i);
    if (comment !== i) {
      i = comment;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** The `{…}` value of `pages=` on an opening tag, or null when missing/unbalanced. */
function pagesExpression(open: string): string | null {
  const match = /\bpages\s*=\s*\{/.exec(open);
  if (!match) return null;
  const start = match.index + match[0].length - 1;
  let depth = 0;
  let quote: Quote = null;
  for (let i = start; i < open.length; i++) {
    const ch = open[i]!;
    if (quote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return open.slice(start, i + 1);
    }
  }
  return null;
}

/** True when a binding or function named `name` in this file builds pages with `render:`. */
function namedPagesHaveRender(name: string, fileCode: string): boolean {
  const decl = new RegExp(`(?:const|let|var)\\s+${name}\\b[\\s\\S]{0,6000}?\\brender\\s*:`);
  if (decl.test(fileCode)) return true;
  const fn = new RegExp(
    `(?:function\\s+${name}\\b|(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>)[\\s\\S]{0,6000}?\\brender\\s*:`,
  );
  return fn.test(fileCode);
}

/** True when a pages expression (or the variable/function it names) supplies `render:` for screens. */
function pagesSupplyRender(expr: string, fileCode: string): boolean {
  if (/\brender\s*:/.test(expr)) return true;
  const ident = /^\{\s*([A-Za-z_$][\w$]*)\s*\}$/.exec(expr);
  if (ident) return namedPagesHaveRender(ident[1]!, fileCode);
  // pages={makePages()} / pages={makePages(rows)} — follow the callee when it builds render:.
  const call = /^\{\s*([A-Za-z_$][\w$]*)\s*\(/.exec(expr);
  if (call) return namedPagesHaveRender(call[1]!, fileCode);
  return false;
}

/** Whether this opening tag actually puts screens in the shell window. */
function shellIsFilled(open: string, children: string, fileCode: string): boolean {
  const pages = pagesExpression(open);
  if (pages && pagesSupplyRender(pages, fileCode)) return true;
  return stripShellNoise(children).trim().length > 0;
}

/** Opening `<AppShell` tags, and whether each one actually has screens to show. */
function readAppShells(code: string): Array<{ filled: boolean }> {
  const shells: Array<{ filled: boolean }> = [];
  let i = 0;
  let quote: Quote = null;
  while (i < code.length) {
    if (quote) {
      if (code[i] === "\\") {
        i += 2;
        continue;
      }
      if (code[i] === quote) quote = null;
      i++;
      continue;
    }
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      i++;
      continue;
    }
    const comment = skipComment(code, i);
    if (comment !== i) {
      i = comment;
      continue;
    }
    const pattern = skipRegex(code, i);
    if (pattern !== i) {
      i = pattern;
      continue;
    }
    if (code.startsWith("<AppShell", i) && !/[\w$]/.test(code[i - 1] ?? "")) {
      const openEnd = endOfOpeningTag(code, i);
      if (openEnd < 0) {
        shells.push({ filled: false });
        break;
      }
      const open = code.slice(i, openEnd + 1);
      const selfClosing = /\/\s*>$/.test(open);
      if (selfClosing) {
        shells.push({ filled: shellIsFilled(open, "", code) });
        i = openEnd + 1;
        continue;
      }
      const closeAt = endOfAppShell(code, openEnd + 1);
      const children = closeAt < 0 ? "" : code.slice(openEnd + 1, closeAt);
      shells.push({ filled: shellIsFilled(open, children, code) });
      i = closeAt < 0 ? code.length : closeAt + "</AppShell>".length;
      continue;
    }
    i++;
  }
  return shells;
}

function endOfOpeningTag(code: string, start: number): number {
  let quote: Quote = null;
  let brace = 0;
  for (let i = start; i < code.length; i++) {
    const ch = code[i]!;
    if (quote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    const comment = skipComment(code, i);
    if (comment !== i) {
      i = comment - 1;
      continue;
    }
    const pattern = skipRegex(code, i);
    if (pattern !== i) {
      i = pattern - 1;
      continue;
    }
    if (ch === "{") brace++;
    else if (ch === "}") brace = Math.max(0, brace - 1);
    else if (ch === ">" && brace === 0) return i;
  }
  return -1;
}

/** Index where `</AppShell` of this shell starts, with nested shells counted. */
function endOfAppShell(code: string, from: number): number {
  let quote: Quote = null;
  let depth = 1;
  for (let i = from; i < code.length; i++) {
    const ch = code[i]!;
    if (quote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    const comment = skipComment(code, i);
    if (comment !== i) {
      i = comment - 1;
      continue;
    }
    const pattern = skipRegex(code, i);
    if (pattern !== i) {
      i = pattern - 1;
      continue;
    }
    if (code.startsWith("<AppShell", i) && !/[\w$]/.test(code[i - 1] ?? "")) {
      depth++;
      i += "<AppShell".length - 1;
      continue;
    }
    if (code.startsWith("</AppShell", i)) {
      depth--;
      if (depth === 0) return i;
      const end = code.indexOf(">", i);
      if (end < 0) return -1;
      i = end;
    }
  }
  return -1;
}

/** A shell tag with neither pages nor children draws a blank full-height window. */
export function shellShowsScreens(files: AppFiles): string | null {
  const blanks: string[] = [];
  for (const [name, text] of Object.entries(files)) {
    if (!/\.(tsx|ts|jsx|js)$/.test(name) || !/<AppShell\b/.test(text)) continue;
    const shells = readAppShells(text);
    if (shells.some((shell) => !shell.filled)) blanks.push(name);
  }
  return blanks.length ? `${blanks.join(", ")}: ${BLANK_SHELL}` : null;
}

/**
 * A new app has to open in the OCSC shell. An app that already does cannot be saved without it,
 * including one whose current files lost the shell after an earlier version had it (`hadShell`).
 * An app that has never used the shell can still be edited.
 */
export function keptAppLook(
  previous: AppFiles | null,
  next: AppFiles,
  options: { hadShell?: boolean } = {},
): string | null {
  const after = appLookMarks(next);
  const blank = after.shell ? shellShowsScreens(next) : null;
  if (!previous) {
    if (after.shell && after.kit && after.theme) return blank;
    return `A new app is saved only with AppShell and components from @ocsc/ui, and <Theme preset="evolve" /> (or crisp, soft, forest or contrast) near the top. ${KEEP_APP_LOOK}`;
  }
  const before = appLookMarks(previous);
  if (before.shell || options.hadShell) {
    const lost: string[] = [];
    if (!after.shell) lost.push("AppShell");
    if ((before.kit || options.hadShell) && !after.kit) lost.push("the @ocsc/ui import");
    if ((before.theme || options.hadShell) && !after.theme) lost.push("<Theme />");
    return lost.length ? `This save removes ${lost.join(", ")}. ${KEEP_APP_LOOK}` : blank;
  }
  const lost: string[] = [];
  if (before.kit && !after.kit) lost.push("the @ocsc/ui import");
  if (before.theme && !after.theme) lost.push("<Theme />");
  return lost.length ? `This save removes ${lost.join(", ")}. ${KEEP_APP_LOOK}` : blank;
}

const PAGE_ID_FIRST = /\{\s*id\s*:\s*["'`]([A-Za-z0-9_-]+)["'`]\s*,\s*label\s*:/g;
const PAGE_LABEL_FIRST = /\{\s*label\s*:\s*["'`][^"'`]*["'`]\s*,\s*id\s*:\s*["'`]([A-Za-z0-9_-]+)["'`]/g;

/** The page ids an app's files declare as AppShell pages ({ id: "board", label: "Board", ... }). */
export function appPageIds(files: AppFiles): string[] {
  const code = Object.values(files).join("\n");
  const ids = [...code.matchAll(PAGE_ID_FIRST), ...code.matchAll(PAGE_LABEL_FIRST)].map(
    (match) => match[1]!,
  );
  return [...new Set(ids)];
}

function codeSize(files: AppFiles) {
  return Object.entries(files)
    .filter(([name]) => /\.(tsx|ts|jsx|js|py)$/.test(name))
    .reduce((total, [, text]) => total + text.length, 0);
}

/** Below this much code an app is small enough that a rewrite may rightly halve it. */
const STRIP_FLOOR = 4000;

/**
 * Why a save would strip an app: pages it drops, or most of its code gone. Null when it keeps
 * them, or when the person asked for the removal (`removes`, in their words).
 */
export function strippedApp(previous: AppFiles, next: AppFiles, removes?: string): string | null {
  if (removes?.trim()) return null;
  const before = appPageIds(previous);
  const after = appPageIds(next);
  const lost = after.length ? before.filter((id) => !after.includes(id)) : [];
  const was = codeSize(previous);
  const now = codeSize(next);
  const shrunk = was >= STRIP_FLOOR && now < was * 0.6;
  if (!lost.length && !shrunk) return null;
  const what = [
    lost.length ? `drops the ${lost.join(", ")} ${lost.length === 1 ? "page" : "pages"}` : null,
    shrunk ? `cuts the code from ${was} to ${now} characters` : null,
  ]
    .filter(Boolean)
    .join(" and ");
  return `This save ${what}, so nothing was saved. An app keeps every page and feature while it is changed or fixed: put them back and make the change in place with edits. A renamed page keeps its id. Only if the person asked to remove them, save again with removes: "<what they asked to remove, in their words>".`;
}

export type CodeMatch = { file: string; line: number; text: string };

/**
 * Lines in an app's files holding the most of the query's words (case-insensitive), each with the
 * two lines either side, numbered, so an edit can quote the exact text it changes.
 */
export function searchAppFiles(files: AppFiles, query: string, limit = 12): CodeMatch[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 1);
  if (!words.length) return [];
  const hits: Array<CodeMatch & { score: number }> = [];
  for (const [file, text] of Object.entries(files)) {
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      const lower = line.toLowerCase();
      const score = words.filter((word) => lower.includes(word)).length;
      if (!score) return;
      const from = Math.max(0, index - 2);
      const around = lines
        .slice(from, index + 3)
        .map((value, offset) => `${from + offset + 1}| ${value.slice(0, 240)}`)
        .join("\n");
      hits.push({ file, line: index + 1, text: around, score });
    });
  }
  return hits
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line)
    .slice(0, limit)
    .map(({ score: _score, ...match }) => match);
}

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
  const bareTokens = [...new Set(`${code}\n${styles}`.match(BARE_TOKEN) ?? [])]
    .slice(0, 3)
    .map((token) => `${token})`);
  if (bareTokens.length) {
    notes.push(
      `${bareTokens.join(", ")} holds bare HSL numbers, not a colour, so that background or text paints nothing (white buttons on white). Wrap it: hsl(var(--primary)) is the brand green, hsl(var(--primary) / 0.12) a tint; --accent is a pale hover grey, not the brand colour.`,
    );
  }
  const handStyled = (code.match(/<button\b[^>]*\sstyle=\{/g) ?? []).length;
  if (handStyled) {
    notes.push(
      `${handStyled} hand-styled <button style={...}> skip the theme and dark mode. Use Button from @ocsc/ui (variant primary, secondary, outline or ghost; size sm) and keep style={} for layout only.`,
    );
  }
  // A calculator's pages, visuals and rows come from its workbook; the register-app checks don't fit it.
  const calculator = /from\s+["']@ocsc\/(?:calc|math|eng)["']/.test(code);
  if (!calculator && !KIT_VISUAL.test(code) && !/from\s+["']@ocsc\/plot["']/.test(code)) {
    notes.push(
      "No @ocsc/ui chart or visual indicator is used. Add kit visuals (AreaChart, BarChart, DonutChart, BarList, FunnelChart, Gauge, Ring, Heatmap, CalendarHeatmap or KpiCard trend) instead of plain counts or hand-rolled div bars.",
    );
  }
  if (/<AppShell\b/.test(code)) {
    const pageDefs = code.match(/\{\s*id\s*:\s*["'`][A-Za-z0-9_-]+["'`]\s*,\s*label\s*:/g) ?? [];
    if (!calculator && (pageDefs.length < 3 || !KIT_WORKFLOW.test(code))) {
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
  if (
    !calculator &&
    options.isNew &&
    !options.fromTemplate &&
    options.totalRows === 0 &&
    !/\buseEvolve\b|\bevolve\.read\b/.test(code)
  ) {
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
