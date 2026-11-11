import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { build, type Message, type Plugin, transform } from "esbuild";
import { compile } from "tailwindcss";
import type { AppInit } from "../protocol.js";
import { URBANIST_FACE } from "./urbanist-face.js";

/**
 * Turns an app's source files into one self-contained HTML document (and the same code as a
 * plugin bundle for Evolve). Everything runs on the server: esbuild bundles the files with React,
 * motion, recharts, lucide and the OCSC kit, and Tailwind generates only the classes the app
 * uses. App code can import nothing else and read nothing from the server's disk.
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
  return null;
}

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
          return builder.resolve(args.path, { kind: args.kind, resolveDir: SRC, pluginData: { inner: true } });
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

async function readKitSources(): Promise<string> {
  const ui = path.join(SRC, "ui");
  const names = await readdir(ui);
  const texts = await Promise.all(names.filter((name) => /\.tsx?$/.test(name)).map((name) => readFile(path.join(ui, name), "utf8")));
  return texts.join("\n");
}

let kitSources: Promise<string> | undefined;
let kitStyles: Promise<string> | undefined;

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

async function buildCss(source: string, extraCss: string): Promise<string> {
  kitSources ??= readKitSources();
  kitStyles ??= readFile(path.join(SRC, "ui/styles.css"), "utf8");
  const [kit, styles] = await Promise.all([kitSources, kitStyles]);
  const compiler = await compile(`${styles}\n${extraCss}`, {
    base: SRC,
    loadStylesheet,
    loadModule: async (id: string) => {
      throw new Error(`Tailwind plugins are not available in apps (${id}).`);
    },
  });
  const css = compiler.build([...classCandidates(kit), ...classCandidates(source)]);
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
    css = await buildCss(source, extraCss);
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
