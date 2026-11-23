#!/usr/bin/env node
/**
 * OCSC Project Planner: create, inspect, audit and edit Jantt JSON programmes (.jantt).
 *
 *   ocsc-plan new --spec plan.json --out outputs/Programme.jantt
 *   ocsc-plan inspect --in outputs/Programme.jantt
 *   ocsc-plan audit --in outputs/Programme.jantt
 *   ocsc-plan edit --in outputs/Programme.jantt --spec edits.json [--out outputs/Programme-v2.jantt]
 *   ocsc-plan import-csv --in schedule.csv --out outputs/Programme.jantt
 *   ocsc-plan import-xml --in programme.xml --out outputs/Programme.jantt
 *   ocsc-plan import-mpp --in programme.mpp --out outputs/Programme.jantt
 *   ocsc-plan export-csv --in outputs/Programme.jantt [--out outputs/Programme.csv]
 *   ocsc-plan export-xml --in outputs/Programme.jantt [--out outputs/Programme.xml]
 *
 * edits.json: { "edits": [ { "op": "add_task", ... }, ... ] }
 *   ops (see plan-edits.mjs): add_task, update_task, reschedule_task, move_task, delete_task,
 *        link_tasks, unlink_tasks, assign, add_category, update_category, delete_category,
 *        set_baseline, set_tasks, set_meta, set_evolve
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { resolveSchedule, validate } from "@jantt/core";
import {
  exportMsProjectXml,
  exportSpreadsheetCsv,
  importMsProjectXml,
  importSpreadsheetCsv,
} from "@jantt/interop";
import {
  UsageError,
  analyzeSchedule,
  applyEdits,
  compactScheduleSummary,
  describePlan,
  preparePlan,
  rollupSummaryTasks,
  syncContiguousGapDays,
  withCategories,
} from "./plan-edits.mjs";

const WORKSPACE = process.env.WORKSPACE_DIR || process.env.HOME || process.cwd();
const INSPECT_MAX_CHARS = 14_000;

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

function readJson(p, label) {
  const src = inWorkspace(p, label);
  if (!existsSync(src.full)) throw new UsageError(`${src.rel} does not exist.`);
  try {
    return { ...src, value: JSON.parse(readFileSync(src.full, "utf8")) };
  } catch (error) {
    throw new UsageError(`${src.rel} is not valid JSON: ${error.message}`);
  }
}

function readText(p, label) {
  const src = inWorkspace(p, label);
  if (!existsSync(src.full)) throw new UsageError(`${src.rel} does not exist.`);
  return { ...src, value: readFileSync(src.full, "utf8") };
}

function blankPlan(title) {
  return {
    $schema: "https://ahmadhassan-bted.github.io/Jantt/schema/v1.json",
    meta: {
      title: String(title || "Untitled plan").trim() || "Untitled plan",
      createdAt: new Date().toISOString().slice(0, 10),
      defaultGapDays: 0,
    },
    categories: { default: { label: "General", color: "#76BF43" } },
    tasks: [],
  };
}

function ensurePlan(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.tasks)) {
    throw new UsageError("Plan must be a JSON object with a tasks array.");
  }
  return value;
}

function writePlan(outPath, plan, { reschedule = true } = {}) {
  const dest = inWorkspace(outPath, "--out");
  mkdirSync(dirname(dest.full), { recursive: true });
  const normalized = withCategories(plan);
  const checked = validate(normalized);
  if (!checked.valid) {
    throw new UsageError(
      `Plan failed validation: ${(checked.errors ?? []).map((e) => e.message || String(e)).join("; ") || "invalid"}`,
    );
  }
  const gapDays = typeof normalized.meta?.defaultGapDays === "number" ? normalized.meta.defaultGapDays : 0;
  // Imports keep MS Project's stored dates; edits and new plans cascade from dependencies and roll up summaries.
  const tasks = reschedule
    ? rollupSummaryTasks(syncContiguousGapDays(resolveSchedule(normalized.tasks ?? [], gapDays)))
    : normalized.tasks ?? [];
  const written = { ...normalized, tasks };
  writeFileSync(dest.full, `${JSON.stringify(written, null, 2)}\n`);
  return { dest, plan: written };
}

/** Outline / summary / milestone flags from MSPDI XML, keyed by UID. */
function outlineByUidFromXml(xml) {
  const outlineByUid = new Map();
  for (const block of xml.matchAll(/<Task>([\s\S]*?)<\/Task>/gi)) {
    const body = block[1] ?? "";
    const uid = body.match(/<UID>(\d+)<\/UID>/i)?.[1];
    if (!uid) continue;
    const levelRaw = body.match(/<OutlineLevel>(\d+)<\/OutlineLevel>/i)?.[1];
    const level = levelRaw != null ? Number(levelRaw) : undefined;
    outlineByUid.set(uid, {
      wbs: body.match(/<OutlineNumber>([^<]+)<\/OutlineNumber>/i)?.[1]?.trim(),
      outlineLevel: Number.isFinite(level) ? level : undefined,
      milestone: body.match(/<Milestone>([01])<\/Milestone>/i)?.[1] === "1",
      summary: body.match(/<Summary>([01])<\/Summary>/i)?.[1] === "1",
    });
  }
  return outlineByUid;
}

function enrichTasksWithOutline(tasks, outlineByUid) {
  return tasks.map((task) => {
    const uid = String(task.id ?? "").replace(/^t/i, "");
    const extra = outlineByUid.get(uid);
    if (!extra) return { ...task, category: task.category || "default" };
    const fields = {
      ...(task.fields ?? {}),
      ...(extra.summary ? { summary: true } : {}),
      ...(extra.outlineLevel != null ? { outlineLevel: extra.outlineLevel } : {}),
    };
    return {
      ...task,
      category: task.category || "default",
      ...(extra.milestone || task.milestone ? { milestone: true } : {}),
      ...(extra.wbs ? { wbs: extra.wbs } : {}),
      ...(Object.keys(fields).length ? { fields } : {}),
    };
  });
}

function planFromXml(xml, fileName = "Programme") {
  const imported = ensurePlan(importMsProjectXml(xml));
  const generic = /^(msproj\d*|project\.xml|project)$/i;
  const titleMatch = xml.match(/<Title>([\s\S]*?)<\/Title>/i) || xml.match(/<Name>([\s\S]*?)<\/Name>/i);
  let title = titleMatch ? titleMatch[1].trim() : "";
  title = title
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
  if (!title || generic.test(title)) {
    title = basename(fileName).replace(/\.(mpp|xml)$/i, "").trim() || title || "Imported programme";
  }
  const tasks = enrichTasksWithOutline(imported.tasks ?? [], outlineByUidFromXml(xml));
  return withCategories({
    ...imported,
    meta: { ...(imported.meta ?? {}), title },
    tasks,
  });
}

async function mppFileToXml(fullPath) {
  let convert;
  try {
    ({ convert } = await import("@byteink/mppjs"));
  } catch {
    throw new UsageError(
      "Microsoft Project .mpp conversion is unavailable here. Ask for XML (File → Save As → XML Format) or use import-xml.",
    );
  }
  const dir = mkdtempSync(join(tmpdir(), "ocsc-mpp-"));
  const output = join(dir, "programme.xml");
  try {
    await convert(fullPath, output);
    return readFileSync(output, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeText(outPath, text) {
  const dest = inWorkspace(outPath, "--out");
  mkdirSync(dirname(dest.full), { recursive: true });
  writeFileSync(dest.full, text);
  return dest;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main(argv) {
  const command = argv[0];
  const flags = args(argv.slice(1));
  if (command === "new") {
    const spec = flags.spec ? readJson(flags.spec, "--spec").value : {};
    const title = spec.title || spec.meta?.title || "Untitled plan";
    const {
      title: _dropTitle,
      projectStart,
      targetFinish,
      holidays,
      ...specRest
    } = spec;
    const rawPlan = ensurePlan({
      ...blankPlan(title),
      ...specRest,
      meta: {
        ...blankPlan(title).meta,
        ...(spec.meta ?? {}),
        title,
        ...(projectStart !== undefined ? { projectStart } : {}),
        ...(targetFinish !== undefined ? { targetFinish } : {}),
        ...(holidays !== undefined ? { holidays } : {}),
      },
      tasks: Array.isArray(spec.tasks) ? spec.tasks : [],
      categories: spec.categories ?? blankPlan(title).categories,
    });
    if (!flags.out) throw new UsageError("--out is required.");
    const prepared = preparePlan(rawPlan);
    const { dest, plan } = writePlan(flags.out, prepared);
    print({
      ok: true,
      path: dest.rel,
      ...downloadLink(dest.rel),
      tasks: plan.tasks.length,
      schedule: compactScheduleSummary(plan),
    });
    return;
  }
  if (command === "audit") {
    if (!flags.in) throw new UsageError("--in is required.");
    const src = readJson(flags.in, "--in");
    const plan = ensurePlan(src.value);
    const checked = validate(plan);
    const { _internal, ...schedule } = analyzeSchedule(plan);
    print({
      ok: true,
      path: src.rel,
      title: plan.meta?.title ?? null,
      valid: checked.valid,
      errors: checked.errors ?? [],
      taskCount: plan.tasks.length,
      schedule,
    });
    return;
  }
  if (command === "inspect") {
    if (!flags.in) throw new UsageError("--in is required.");
    const src = readJson(flags.in, "--in");
    const plan = ensurePlan(src.value);
    const checked = validate(plan);
    const from = Math.max(0, Math.floor(Number(flags.from) || 0));
    const find = typeof flags.find === "string" ? flags.find : undefined;
    const view = (limit) => ({
      ok: true,
      path: src.rel,
      valid: checked.valid,
      errors: checked.errors ?? [],
      evolve: plan.meta?.evolve ?? null,
      ...describePlan(plan, { from, limit, find }),
    });
    // The agent sees only the last 16,000 characters of output, so show as many tasks as fit.
    let limit = Number(flags.limit) > 0 ? Number(flags.limit) : plan.tasks.length;
    let out = view(limit);
    while (limit > 1 && JSON.stringify(out).length > INSPECT_MAX_CHARS) {
      limit = Math.max(1, Math.floor(limit * 0.8));
      out = view(limit);
    }
    if (out.nextFrom != null) {
      out.more = `Run inspect again with --from ${out.nextFrom} for the next tasks, or --find <words> to look tasks up.`;
    }
    print(out);
    return;
  }
  if (command === "edit") {
    if (!flags.in || !flags.spec) throw new UsageError("--in and --spec are required.");
    const src = readJson(flags.in, "--in");
    const plan = ensurePlan(src.value);
    const spec = readJson(flags.spec, "--spec").value;
    const edits = Array.isArray(spec.edits) ? spec.edits : Array.isArray(spec) ? spec : null;
    if (!edits) throw new UsageError("--spec must be { edits: [...] }.");
    const { plan: next, summary } = applyEdits(plan, edits);
    const out = flags.out || flags.in;
    const { dest, plan: written } = writePlan(out, next);
    print({
      ok: true,
      path: dest.rel,
      ...downloadLink(dest.rel),
      tasks: written.tasks.length,
      summary: summary.join("; "),
      schedule: compactScheduleSummary(written),
    });
    return;
  }
  if (command === "import-csv") {
    if (!flags.in || !flags.out) throw new UsageError("--in and --out are required.");
    const src = readText(flags.in, "--in");
    const plan = withCategories(ensurePlan(importSpreadsheetCsv(src.value)));
    const { dest, plan: written } = writePlan(flags.out, plan, { reschedule: false });
    print({
      ok: true,
      path: dest.rel,
      ...downloadLink(dest.rel),
      tasks: written.tasks.length,
      schedule: compactScheduleSummary(written),
    });
    return;
  }
  if (command === "import-xml") {
    if (!flags.in || !flags.out) throw new UsageError("--in and --out are required.");
    const src = readText(flags.in, "--in");
    const plan = planFromXml(src.value, src.rel);
    const { dest, plan: written } = writePlan(flags.out, plan, { reschedule: false });
    print({
      ok: true,
      path: dest.rel,
      ...downloadLink(dest.rel),
      tasks: written.tasks.length,
      schedule: compactScheduleSummary(written),
    });
    return;
  }
  if (command === "import-mpp") {
    if (!flags.in || !flags.out) throw new UsageError("--in and --out are required.");
    const src = inWorkspace(flags.in, "--in");
    if (!existsSync(src.full)) throw new UsageError(`${src.rel} does not exist.`);
    const xml = await mppFileToXml(src.full);
    const plan = planFromXml(xml, src.rel);
    const { dest, plan: written } = writePlan(flags.out, plan, { reschedule: false });
    print({
      ok: true,
      path: dest.rel,
      ...downloadLink(dest.rel),
      tasks: written.tasks.length,
      schedule: compactScheduleSummary(written),
    });
    return;
  }
  if (command === "export-csv") {
    if (!flags.in) throw new UsageError("--in is required.");
    const src = readJson(flags.in, "--in");
    const plan = ensurePlan(src.value);
    const csv = exportSpreadsheetCsv(plan);
    if (flags.out) {
      const dest = writeText(flags.out, csv);
      print({ ok: true, path: dest.rel, ...downloadLink(dest.rel) });
    } else {
      print({ ok: true, csv });
    }
    return;
  }
  if (command === "export-xml") {
    if (!flags.in) throw new UsageError("--in is required.");
    const src = readJson(flags.in, "--in");
    const plan = ensurePlan(src.value);
    const xml = exportMsProjectXml(plan);
    if (flags.out) {
      const dest = writeText(flags.out, xml);
      print({ ok: true, path: dest.rel, ...downloadLink(dest.rel) });
    } else {
      print({ ok: true, xml });
    }
    return;
  }
  throw new UsageError(
    "Usage: ocsc-plan new|inspect|audit|edit|import-csv|import-xml|import-mpp|export-csv|export-xml …",
  );
}

main(process.argv.slice(2)).catch((error) => {
  print({
    ok: false,
    error: error instanceof UsageError ? error.message : error?.message || String(error),
  });
  process.exitCode = 1;
});
