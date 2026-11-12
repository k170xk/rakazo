import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { type AppFiles, buildApp } from "@rakazo/app-kit/build";
import { listAppAssets, readAppAsset, readAppTables } from "@rakazo/db";
import type { ExecutorDeps } from "./executor-deps.js";
import { TOOL_WORK, type ToolRunnerWorkspace } from "./tool-runner.js";

/**
 * App Studio's eyes: an app opened headless on a tool runner, with its real rows and pictures
 * inlined and no network, to find what only shows when it runs (a crash on one tab, console
 * errors, a blank screen, a page wider than a phone) and, when asked, to take screenshots for
 * the bot that built it. Every look gets a fresh folder that is removed afterwards.
 */

export const APP_LOOK_PROGRAM = "app-shot";
const LOOK_TIMEOUT_MS = 90_000;
const CHECK_TIMEOUT_MS = 60_000;
/** Pictures beyond this many bytes stay out of the copy; the app shows them as missing. */
const MAX_INLINE_ASSET_BYTES = 12 * 1024 * 1024;
const MAX_SHOT_BYTES = 3 * 1024 * 1024;

export type AppLookReport = {
  pages: Array<{ id: string; label: string }>;
  errors: Array<{ page: string; message: string }>;
  crashed: { page: string; message: string } | null;
  blank: string[];
  overflow: Array<{ page: string; width: number }>;
  blocked: string[];
  shots: Array<{
    file: string;
    page: string;
    viewport: "desktop" | "phone";
    width: number;
    height: number;
    cut: boolean;
  }>;
};

export type AppLook = {
  report: AppLookReport;
  images: Array<{ page: string; viewport: string; data: string; mimeType: "image/jpeg" }>;
};

export type AppLookOptions = {
  /** Visit every page for problems only, without screenshots. */
  check?: boolean;
  /** Page ids to photograph, in order (the first page when empty). */
  pages?: string[];
  phone?: boolean;
  theme?: "light" | "dark";
};

/** Whether this install can look at apps: it has tool runners and the folder they share. */
export function canLookAtApps(deps: Pick<ExecutorDeps, "toolRunner" | "dataDir">) {
  return Boolean(deps.toolRunner && deps.dataDir);
}

async function fixtureAssets(deps: Pick<ExecutorDeps, "prisma">, pageId: string) {
  const assets: Record<string, string> = {};
  let budget = MAX_INLINE_ASSET_BYTES;
  for (const asset of await listAppAssets(deps.prisma, pageId)) {
    if (asset.size > budget) continue;
    const stored = await readAppAsset(deps.prisma, pageId, asset.id);
    if (!stored) continue;
    budget -= asset.size;
    assets[asset.id] = `data:${stored.mime};base64,${Buffer.from(stored.bytes).toString("base64")}`;
  }
  return assets;
}

function args(options: AppLookOptions) {
  const out = ["app.html", "out"];
  if (options.check) out.push("--check");
  if (options.phone) out.push("--phone");
  if (options.pages?.length) out.push("--pages", options.pages.join(","));
  return out;
}

/**
 * Builds `files` with the app's current data and opens it on a runner. Null when this install
 * has no runners; throws when the run itself fails.
 */
export async function lookAtApp(
  deps: Pick<ExecutorDeps, "prisma" | "toolRunner" | "dataDir">,
  input: {
    pageId: string;
    title: string;
    files: AppFiles;
    owner: string;
    viewerName: string | null;
    signal: AbortSignal;
  },
  options: AppLookOptions = {},
): Promise<AppLook | null> {
  if (!deps.toolRunner || !deps.dataDir) return null;
  const [tables, assets] = await Promise.all([
    readAppTables(deps.prisma, input.pageId),
    fixtureAssets(deps, input.pageId),
  ]);
  const built = await buildApp(input.files, {
    title: input.title,
    theme: options.theme,
    fixture: {
      app: { id: input.pageId, title: input.title, version: 0 },
      viewer: { name: input.viewerName, canEdit: true, role: "owner" },
      theme: options.theme ?? "light",
      tables: Object.fromEntries(
        Object.entries(tables).map(([name, table]) => [
          name,
          { schema: table.schema, rows: table.rows },
        ]),
      ),
      state: {},
      revision: 0,
      features: ["assets"],
      assets,
    },
  });
  if (!built.ok) throw new Error(built.errors[0]?.message ?? "The app could not be built.");

  const key = `app-shot-${randomUUID()}`;
  const root = path.join(path.resolve(deps.dataDir), TOOL_WORK, "documents", key);
  const workspace: ToolRunnerWorkspace = {
    base: root,
    mount: `${TOOL_WORK}/documents/${key}`,
    cwd: "",
    root,
  };
  await mkdir(root, { recursive: true, mode: 0o755 });
  try {
    await writeFile(path.join(root, "app.html"), built.html);
    const result = await deps.toolRunner.run({
      workspace,
      program: APP_LOOK_PROGRAM,
      args: args(options),
      owner: input.owner,
      timeoutMs: options.check ? CHECK_TIMEOUT_MS : LOOK_TIMEOUT_MS,
      signal: input.signal,
    });
    const reportFile = path.join(root, "out", "report.json");
    const report = (await readFile(reportFile, "utf8").then(
      (text) => JSON.parse(text) as AppLookReport,
      () => null,
    )) as AppLookReport | null;
    if (!report) {
      const reason = (result.stderr || result.stdout).trim().split("\n").at(-1);
      throw new Error(reason || `The app could not be opened (exit ${result.code}).`);
    }
    const images: AppLook["images"] = [];
    for (const shot of report.shots) {
      if (!/^(desktop|phone)-\d{1,2}\.jpg$/.test(shot.file)) continue;
      const file = path.join(root, "out", shot.file);
      const info = await stat(file).catch(() => null);
      if (!info?.isFile() || info.size > MAX_SHOT_BYTES) continue;
      images.push({
        page: shot.page,
        viewport: shot.viewport,
        data: (await readFile(file)).toString("base64"),
        mimeType: "image/jpeg",
      });
    }
    return { report, images };
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The problems in a report as short sentences, empty when the app ran cleanly. */
export function lookProblems(report: AppLookReport): string[] {
  const problems: string[] = [];
  if (report.crashed)
    problems.push(`The ${report.crashed.page} page crashed: ${report.crashed.message}`);
  for (const error of report.errors.slice(0, 8)) {
    if (report.crashed && error.message.includes(report.crashed.message)) continue;
    problems.push(`Error on ${error.page}: ${error.message}`);
  }
  for (const page of report.blank) problems.push(`The ${page} page shows nothing.`);
  for (const wide of report.overflow)
    problems.push(
      `On a phone the ${wide.page} page is ${wide.width}px wide and scrolls sideways; let it wrap or stack.`,
    );
  if (report.blocked.length)
    problems.push(
      `The app tried the network (${report.blocked[0]}); apps have none, so read data through @ocsc/app.`,
    );
  return problems;
}
