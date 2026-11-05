#!/usr/bin/env node
// Evolve staff plugins on a bot's computer:
//   ocsc-plugin new <slug> [--name "Name"]   start a plugin in plugins/<slug> from the template
//   ocsc-plugin dev [dir]                     run it with sample data and open it on the screen
//   ocsc-plugin stop [dir]                    stop that preview
//   ocsc-plugin build [dir]                   type-check, build and package it for evolve_plugin_submit
// Every command prints one JSON object with "ok". Nothing here reaches Evolve or real data.
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOME = path.dirname(fileURLToPath(import.meta.url));
const MODULES = path.join(HOME, "node_modules");
const VITE = path.join(MODULES, "vite/bin/vite.js");
const TSC = path.join(MODULES, "typescript/bin/tsc");
const WORKSPACE = realpathSync(process.env.WORKSPACE_DIR || process.cwd());

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const BUNDLE_PATH = /^(index\.html|assets\/[A-Za-z0-9._-]+\.(js|css))$/;
const SOURCE_EXT = /\.(tsx?|jsx?|mjs|cjs|css|html|json|md|svg|txt)$/i;
const SKIP_DIRS = new Set(["node_modules", "dist", ".evolve", ".vite-cache", ".git"]);
const SKIP_FILES = new Set(["package-lock.json"]);
const MAX_BUNDLE = 2 * 1024 * 1024;
const MAX_SOURCE = 3 * 1024 * 1024;
const MAX_SOURCE_FILES = 400;

function done(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
}
const fail = (error, extra = {}) => done({ ok: false, error, ...extra });

function projectDir(arg) {
  const dir = path.resolve(process.cwd(), arg || ".");
  if (!existsSync(path.join(dir, "evolve-plugin.json"))) {
    fail(`No evolve-plugin.json in ${dir}. Run this inside a plugin folder or pass its path.`);
  }
  return dir;
}

function readManifest(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, "evolve-plugin.json"), "utf8"));
  } catch (error) {
    return fail(`evolve-plugin.json is not valid JSON: ${error.message}`);
  }
}

/** The preinstalled packages; the computer installs nothing. */
function linkModules(dir) {
  const link = path.join(dir, "node_modules");
  if (existsSync(link) || lstatSync(link, { throwIfNoEntry: false })) return;
  symlinkSync(MODULES, link, "dir");
}

function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, base, out);
    } else if (entry.isFile()) {
      out.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
  return out;
}

const bytes = (files) =>
  Object.values(files).reduce((sum, text) => sum + Buffer.byteLength(text), 0);

function calledScopes(files) {
  const found = new Set();
  for (const text of Object.values(files)) {
    for (const match of text.matchAll(/evolve\.call\(\s*['"`]([a-z]+\.[a-z]+)['"`]/g))
      found.add(match[1]);
  }
  return [...found].sort();
}

function newPlugin(args) {
  const slug = args[0];
  if (!slug || !SLUG.test(slug))
    fail(
      "Give a slug of 3-40 lowercase letters, numbers or dashes, e.g. ocsc-plugin new skills-helper",
    );
  const nameAt = args.indexOf("--name");
  const name =
    (nameAt >= 0 ? args[nameAt + 1] : "") ||
    slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const dir = path.join(WORKSPACE, "plugins", slug);
  if (existsSync(dir)) fail(`${path.relative(WORKSPACE, dir)} already exists.`);
  mkdirSync(path.dirname(dir), { recursive: true });
  cpSync(path.join(HOME, "template"), dir, { recursive: true });
  const manifestPath = path.join(dir, "evolve-plugin.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.slug = slug;
  manifest.name = name.slice(0, 80);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  linkModules(dir);
  done({ ok: true, path: path.relative(WORKSPACE, dir) || ".", manifest });
}

function dev(args) {
  const dir = projectDir(args[0]);
  linkModules(dir);
  mkdirSync(path.join(dir, ".evolve"), { recursive: true });
  stopPreview(dir);
  const port =
    5173 + (Math.abs([...dir].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % 200);
  const log = openSync(path.join(dir, ".evolve", "dev.log"), "w");
  const child = spawn(
    process.execPath,
    [VITE, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: dir,
      detached: true,
      stdio: ["ignore", log, log],
    },
  );
  child.unref();
  writeFileSync(path.join(dir, ".evolve", "dev.pid"), String(child.pid));
  const url = `http://127.0.0.1:${port}/`;
  const opener = process.env.OCSC_SCREEN_OPEN;
  if (opener && existsSync(opener)) {
    setTimeout(() => {
      spawn(opener, [url], { detached: true, stdio: "ignore" }).unref();
      done({
        ok: true,
        url,
        log: path.relative(WORKSPACE, path.join(dir, ".evolve", "dev.log")),
        note: "Running with sample data. Edits reload by themselves.",
      });
    }, 1500);
  } else {
    done({ ok: true, url, note: "Running with sample data." });
  }
}

function stopPreview(dir) {
  const pidFile = path.join(dir, ".evolve", "dev.pid");
  if (!existsSync(pidFile)) return false;
  const pid = Number(readFileSync(pidFile, "utf8"));
  rmSync(pidFile, { force: true });
  try {
    process.kill(-pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

function build(args) {
  const dir = projectDir(args[0]);
  linkModules(dir);
  const manifest = readManifest(dir);
  if (!SLUG.test(String(manifest.slug ?? ""))) fail("evolve-plugin.json needs a valid slug.");
  if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version ?? "")))
    fail('evolve-plugin.json "version" must look like 1.0.0.');
  if (!Array.isArray(manifest.scopes)) fail('evolve-plugin.json "scopes" must be a list.');

  const typecheck = spawnSync(process.execPath, [TSC, "-p", "tsconfig.json"], {
    cwd: dir,
    encoding: "utf8",
  });
  if (typecheck.status !== 0)
    fail("Type errors", { output: (typecheck.stdout + typecheck.stderr).trim().slice(-6000) });
  const vite = spawnSync(process.execPath, [VITE, "build", "--logLevel", "warn"], {
    cwd: dir,
    encoding: "utf8",
  });
  if (vite.status !== 0)
    fail("Build failed", { output: (vite.stdout + vite.stderr).trim().slice(-6000) });

  const distDir = path.join(dir, "dist");
  const bundle = {};
  for (const file of walk(distDir)) {
    if (!BUNDLE_PATH.test(file))
      fail(
        `The build made ${file}; a plugin may only contain index.html and assets/*.js or *.css. Import images and fonts from code so they are inlined.`,
      );
    bundle[file] = readFileSync(path.join(distDir, file), "utf8");
  }
  if (!bundle["index.html"]) fail("The build has no index.html.");
  if (bytes(bundle) > MAX_BUNDLE)
    fail(
      `The built plugin is ${Math.round(bytes(bundle) / 1024)} KB; the limit is ${MAX_BUNDLE / 1024} KB.`,
    );

  const source = {};
  for (const file of walk(dir)) {
    if (SKIP_FILES.has(path.basename(file)) || !SOURCE_EXT.test(file) || /(^|\/)\.env/.test(file))
      continue;
    if (statSync(path.join(dir, file)).size > 512 * 1024)
      fail(`${file} is over 512 KB; keep large data out of the plugin.`);
    source[file] = readFileSync(path.join(dir, file), "utf8");
  }
  if (Object.keys(source).length > MAX_SOURCE_FILES)
    fail(`The plugin has more than ${MAX_SOURCE_FILES} source files.`);
  if (bytes(source) > MAX_SOURCE) fail(`The source is over ${MAX_SOURCE / 1024 / 1024} MB.`);

  const used = calledScopes(source);
  const undeclared = used.filter((scope) => !manifest.scopes.includes(scope));
  if (undeclared.length)
    fail(
      `The code calls ${undeclared.join(", ")}; add ${undeclared.length > 1 ? "them" : "it"} to "scopes" in evolve-plugin.json.`,
    );

  const enginePath = path.join(dir, ".evolve", "engine");
  const engine =
    existsSync(enginePath) && readFileSync(enginePath, "utf8").trim() === "cursor"
      ? "cursor"
      : "ocsc-intelligence";
  mkdirSync(path.join(dir, ".evolve"), { recursive: true });
  const submission = path.join(dir, ".evolve", "submission.json");
  writeFileSync(
    submission,
    JSON.stringify({ manifest, bundle, source, engine, builtAt: new Date().toISOString() }),
  );
  done({
    ok: true,
    submission: path.relative(WORKSPACE, submission),
    slug: manifest.slug,
    version: manifest.version,
    scopes: manifest.scopes,
    unusedScopes: manifest.scopes.filter((scope) => !used.includes(scope)),
    bundleKB: Math.round(bytes(bundle) / 1024),
    sourceFiles: Object.keys(source).length,
  });
}

const [command, ...rest] = process.argv.slice(2);
if (command === "new") newPlugin(rest);
else if (command === "dev") dev(rest);
else if (command === "stop") done({ ok: true, stopped: stopPreview(projectDir(rest[0])) });
else if (command === "build") build(rest);
else fail("Use: ocsc-plugin new <slug> [--name Name] | dev [dir] | stop [dir] | build [dir]");
