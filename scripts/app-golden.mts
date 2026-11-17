// pnpm app:golden [--update] [--only <title>]
//
// Builds the reference apps in scripts/app-golden/corpus.json and every App Studio template with
// the current kit, type-checks them and opens each in ocsc-app-shot --check (the sealed browser
// check save_app runs on the computer). Results are compared with scripts/app-golden/baseline.json:
// a build that fails, a page that crashes or goes blank, or more type or console errors than the
// baseline fails the run, so a kit change that breaks real apps is caught before it ships.
// --update rewrites the baseline from this run. Uses no model and reaches no network.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { buildApp } from "../packages/app-kit/src/build/index.ts";
import { typecheckApp } from "../packages/app-kit/src/build/typecheck.ts";
import { APP_TEMPLATES } from "../packages/app-kit/src/templates/index.ts";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const here = path.join(root, "scripts/app-golden");
const baselinePath = path.join(here, "baseline.json");
const shotScript = path.join(root, "infra/sandboxes/computer/ocsc/ocsc-app-shot/ocsc-app-shot.mjs");

type Table = { schema: unknown; rows: unknown[] };
type GoldenApp = { title: string; files: Record<string, string>; tables: Record<string, Table> };
type Score = { typeErrors: number; consoleErrors: number; phone: number; overflow: number };
type Result = Score & { title: string; failures: string[] };

function playwrightModule() {
  if (process.env.OCSC_PLAYWRIGHT_MODULE) return process.env.OCSC_PLAYWRIGHT_MODULE;
  const web = createRequire(path.join(root, "apps/web/package.json"));
  const test = createRequire(web.resolve("@playwright/test/package.json"));
  return path.join(path.dirname(test.resolve("playwright-core/package.json")), "index.mjs");
}

async function corpus(): Promise<GoldenApp[]> {
  const apps = JSON.parse(await readFile(path.join(here, "corpus.json"), "utf8")) as GoldenApp[];
  const templates = APP_TEMPLATES.map((template) => ({
    title: `Template: ${template.title}`,
    files: template.files,
    tables: Object.fromEntries(
      template.tables.map((schema) => [schema.name, { schema, rows: [] }]),
    ),
  }));
  return [...apps, ...templates];
}

async function score(app: GoldenApp, index: number, work: string, playwright: string) {
  const failures: string[] = [];
  const fixture = {
    app: { id: `golden${index}`, title: app.title, version: 0 },
    viewer: { name: "Golden check", canEdit: true, role: "owner" },
    theme: "light",
    tables: app.tables,
    state: {},
    revision: 0,
    features: ["assets"],
    assets: {},
  };
  const built = await buildApp(app.files, { title: app.title, fixture: fixture as any });
  const typed = await typecheckApp(app.files, { timeoutMs: 60_000, maxErrors: 200 });
  const empty = { typeErrors: typed.errors.length, consoleErrors: 0, phone: 0, overflow: 0 };
  if (!built.ok) {
    const why = built.errors.map((error) => error.message).join(" | ");
    return { title: app.title, ...empty, failures: [`build failed: ${why.slice(0, 300)}`] };
  }
  const dir = path.join(work, `app${index}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "app.html"), built.html);
  try {
    await run(process.execPath, [shotScript, "app.html", "out", "--check"], {
      cwd: dir,
      env: { ...process.env, WORKSPACE_DIR: dir, OCSC_PLAYWRIGHT_MODULE: playwright },
      timeout: 180_000,
    });
  } catch (error) {
    const why = (error as { stderr?: string }).stderr || String(error);
    return { title: app.title, ...empty, failures: [`check did not run: ${why.slice(0, 300)}`] };
  }
  const report = JSON.parse(await readFile(path.join(dir, "out/report.json"), "utf8"));
  if (report.crashed) failures.push(`crashed on ${report.crashed.page}: ${report.crashed.message}`);
  if (report.blank.length) failures.push(`blank: ${report.blank.join(", ")}`);
  if (!report.pages.length) failures.push("no pages found");
  return {
    title: app.title,
    typeErrors: typed.errors.length,
    consoleErrors: report.errors.length,
    phone: report.phone.length,
    overflow: report.overflow.length,
    failures,
  };
}

const args = process.argv.slice(2);
const update = args.includes("--update");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const baseline: Record<string, Score> = existsSync(baselinePath)
  ? JSON.parse(await readFile(baselinePath, "utf8"))
  : {};
const playwright = playwrightModule();
const work = await mkdtemp(path.join(tmpdir(), "app-golden-"));
const results: Result[] = [];
try {
  const apps = (await corpus()).filter((app) => !only || app.title.includes(only));
  for (const [index, app] of apps.entries()) {
    const result = await score(app, index, work, playwright);
    const before = baseline[app.title];
    if (before && !update) {
      for (const key of ["typeErrors", "consoleErrors", "phone", "overflow"] as const) {
        if (result[key] > before[key])
          result.failures.push(`${key} rose from ${before[key]} to ${result[key]}`);
      }
    }
    results.push(result);
    const counts = `types ${result.typeErrors}, console ${result.consoleErrors}, phone ${result.phone}, overflow ${result.overflow}`;
    console.log(`${result.failures.length ? "FAIL" : "ok  "} ${app.title} (${counts})`);
    for (const failure of result.failures) console.log(`       ${failure}`);
  }
} finally {
  await rm(work, { recursive: true, force: true });
}

if (update) {
  const next = { ...baseline };
  for (const { title, failures: _failures, ...counts } of results) next[title] = counts;
  await writeFile(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Baseline written for ${results.length} apps.`);
}
const failed = results.filter((result) => result.failures.length);
if (failed.length && !update) {
  console.log(`${failed.length} of ${results.length} apps regressed.`);
  process.exit(1);
}
console.log(`${results.length} apps checked.`);
