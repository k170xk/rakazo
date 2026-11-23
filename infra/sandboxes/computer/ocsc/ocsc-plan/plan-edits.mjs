/**
 * The edits ocsc-plan applies to a Jantt programme. They cover everything the studio's task
 * drawer, category picker and owner picker can do, and store each change in the same shape the
 * studio writes, so an AI edit looks and restores exactly like a manual one.
 */
import {
  auditScheduleIntegrity,
  calculateCriticalPath,
  getTaskDependencies,
  resolveSchedule,
} from "@jantt/core";

export class UsageError extends Error {}

/** Colours offered for a new category, starting with OCSC green (as in the studio). */
export const CATEGORY_COLOURS = [
  "#76BF43",
  "#3B82F6",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#14B8A6",
  "#EC4899",
  "#64748B",
];

export const STATUSES = ["not-started", "in-progress", "submitted", "completed", "blocked"];
export const PRIORITIES = ["low", "medium", "high", "urgent"];
const DEPENDENCY_TYPES = ["FS", "SS", "FF", "SF"];
const EVOLVE_ID_PREFIX = "evolve:";
const DEFAULT_CATEGORY = { label: "General", color: "#76BF43" };

/** Task fields an edit may set; `null` clears one. */
const TASK_KEYS = [
  "label",
  "category",
  "start",
  "end",
  "dependsOn",
  "milestone",
  "progress",
  "status",
  "priority",
  "urgent",
  "assignee",
  "teamId",
  "phase",
  "wbs",
  "notes",
  "description",
  "estimatedCost",
  "actualCost",
  "locked",
  "gapDays",
  "minGapDays",
  "baseline",
  "calendar",
  "fields",
];
const EDIT_ONLY_KEYS = new Set([
  "op",
  "id",
  "ids",
  "name",
  "dependencies",
  "predecessors",
  "outlineLevel",
  "summary",
  "evolveProfileId",
  "jobTitle",
  "role",
]);

const nameKey = (name) => String(name ?? "").trim().toLowerCase();
const today = () => new Date().toISOString().slice(0, 10);

export function taskLabel(task) {
  return (task.label ?? task.name ?? task.id ?? "").toString().trim() || task.id;
}

export function isSummaryTask(task) {
  return Boolean(task?.fields?.summary === true || task?.summary === true);
}

function outlineLevelOf(task) {
  const raw = task?.fields?.outlineLevel ?? task?.outlineLevel;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}

function diffDays(start, end) {
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function signedDiffDays(start, end) {
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / 86_400_000);
}

function utcWeekday(dateStr) {
  const ms = Date.parse(dateStr);
  return Number.isNaN(ms) ? -1 : new Date(ms).getUTCDay();
}

function parseDepEntries(task) {
  const raw = task?.dependsOn;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const dep of list) {
    if (typeof dep === "string") {
      const m = dep.trim().match(/^([a-zA-Z0-9_\-.]+)(?::(FS|SS|FF|SF)(?:([+-]\d+)(?:d|days?)?)?)?$/i);
      if (m) out.push({ id: m[1], type: (m[2] || "FS").toUpperCase(), lag: m[3] ? Number.parseInt(m[3], 10) : 0 });
      else if (dep.trim()) out.push({ id: dep.trim(), type: "FS", lag: 0 });
    } else if (dep && typeof dep === "object" && dep.id) {
      out.push({
        id: String(dep.id).trim(),
        type: String(dep.type || "FS").toUpperCase(),
        lag: Number(dep.lag ?? dep.lagDays ?? 0) || 0,
      });
    }
  }
  return out;
}

/**
 * Jantt's CPM engine checks `pred.earlyFinish + (task.gapDays ?? 0) === task.earlyStart` to mark a
 * link critical. In normal engineering programmes, a Finish-to-Start successor starts the next day
 * (+1 calendar day, or +3 from Friday to Monday) or after an explicit FS lag. Setting `gapDays` on
 * those tight FS transitions keeps Jantt's Critical Path continuous with red arrows across the
 * entire driving chain instead of breaking at every next-day or weekend boundary.
 */
export function syncContiguousGapDays(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return tasks.map((task) => {
    if (isSummaryTask(task) || task.gapDays != null || task.minGapDays != null) return task;
    const deps = parseDepEntries(task).filter((d) => byId.has(d.id) && d.id !== task.id);
    if (deps.length === 0) return task;
    const fsDeps = deps.filter((d) => d.type === "FS");
    if (fsDeps.length !== deps.length) return task;

    let tightestDiff = Infinity;
    let tightestPred = null;
    let explicitLag = 0;
    for (const dep of fsDeps) {
      const pred = byId.get(dep.id);
      if (!pred || !isDate(pred.end) || !isDate(task.start)) continue;
      const d = signedDiffDays(pred.end, task.start);
      if (Number.isNaN(d) || d < 0) continue;
      if (d < tightestDiff) {
        tightestDiff = d;
        tightestPred = pred;
        explicitLag = dep.lag > 0 ? dep.lag : 0;
      }
    }
    if (!tightestPred || !Number.isFinite(tightestDiff) || tightestDiff === 0) return task;

    const predDay = utcWeekday(tightestPred.end);
    const taskDay = utcWeekday(task.start);
    const isNextDay = tightestDiff === 1;
    const isWeekendJump =
      taskDay === 1 && ((predDay === 5 && tightestDiff === 3) || (predDay === 6 && tightestDiff === 2));
    const matchesExplicitLag = explicitLag > 0 && tightestDiff === explicitLag;

    if (isNextDay || isWeekendJump || matchesExplicitLag) {
      return { ...task, gapDays: tightestDiff };
    }
    return task;
  });
}

/** A key for a new category from its label, unique among `taken` (as in the studio). */
export function categoryKey(label, taken) {
  const used = new Set(taken);
  const base =
    String(label ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "category";
  let key = base;
  for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
  return key;
}

export function nextCategoryColour(categories) {
  const used = new Set(Object.values(categories).map((category) => String(category?.color ?? "").toLowerCase()));
  return CATEGORY_COLOURS.find((colour) => !used.has(colour.toLowerCase())) ?? CATEGORY_COLOURS[0];
}

function readableLabel(key) {
  const words = String(key).replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Category";
}

function colour(value, n) {
  const text = String(value ?? "").trim();
  if (!/^#[0-9a-f]{6}$/i.test(text)) throw new UsageError(`Edit ${n}: color must be a hex colour like #3B82F6.`);
  return text.toUpperCase();
}

/**
 * Every task category must exist on the plan. One a task names but the plan lacks is added with
 * a readable label and the next unused colour, so AI edits don't bounce.
 */
export function withCategories(plan) {
  const categories = {
    default: DEFAULT_CATEGORY,
    ...(plan.categories && typeof plan.categories === "object" ? plan.categories : {}),
  };
  const tasks = (plan.tasks ?? []).map((task) => {
    const category = String(task.category || "default").trim() || "default";
    if (!categories[category]) {
      categories[category] = { label: readableLabel(category), color: nextCategoryColour(categories) };
    }
    return { ...task, category };
  });
  return { ...plan, categories, tasks };
}

/** The category key for a key or label the AI gave, or undefined. */
function findCategory(categories, wanted) {
  const text = String(wanted ?? "").trim();
  if (!text) return undefined;
  if (categories[text]) return text;
  const label = nameKey(text);
  return Object.keys(categories).find((key) => nameKey(categories[key]?.label) === label);
}

function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function cleanDependsOn(value, n) {
  const list = Array.isArray(value) ? value : [value];
  const cleaned = [];
  for (const dep of list) {
    if (dep == null || dep === "") continue;
    if (typeof dep === "string") {
      const trimmed = dep.trim();
      if (trimmed) cleaned.push(trimmed);
      continue;
    }
    if (typeof dep !== "object" || !dep.id) {
      throw new UsageError(`Edit ${n}: each dependency is a task id or { id, type, lag }.`);
    }
    const type = dep.type ? String(dep.type).toUpperCase() : undefined;
    if (type && !DEPENDENCY_TYPES.includes(type)) {
      throw new UsageError(`Edit ${n}: dependency type must be FS, SS, FF or SF.`);
    }
    const rawLag = dep.lag ?? dep.lagDays;
    if (rawLag != null && !Number.isFinite(Number(rawLag))) {
      throw new UsageError(`Edit ${n}: dependency lag must be a number of days.`);
    }
    cleaned.push({
      id: String(dep.id).trim(),
      ...(type ? { type } : {}),
      ...(rawLag != null ? { lag: Number(rawLag) } : {}),
    });
  }
  return cleaned;
}

/** A field value in the shape the studio stores, or throws on a value the studio can't show. */
function cleanValue(key, value, n) {
  switch (key) {
    case "start":
    case "end":
      if (!isDate(value)) throw new UsageError(`Edit ${n}: ${key} must be a date like 2026-03-02.`);
      return value;
    case "progress": {
      let progress = Number(value);
      if (!Number.isFinite(progress)) throw new UsageError(`Edit ${n}: progress must be a number.`);
      if (progress > 1) progress /= 100;
      return Math.min(1, Math.max(0, progress));
    }
    case "status": {
      const status = String(value).trim().toLowerCase().replace(/[\s_]+/g, "-");
      if (!STATUSES.includes(status)) throw new UsageError(`Edit ${n}: status must be one of ${STATUSES.join(", ")}.`);
      return status;
    }
    case "priority": {
      const priority = String(value).trim().toLowerCase();
      if (!PRIORITIES.includes(priority)) throw new UsageError(`Edit ${n}: priority must be one of ${PRIORITIES.join(", ")}.`);
      return priority;
    }
    case "estimatedCost":
    case "actualCost":
    case "gapDays":
    case "minGapDays": {
      const number = Number(value);
      if (!Number.isFinite(number)) throw new UsageError(`Edit ${n}: ${key} must be a number.`);
      return number;
    }
    case "milestone":
    case "urgent":
    case "locked":
      return Boolean(value);
    case "dependsOn":
      return cleanDependsOn(value, n);
    case "baseline":
      if (!value || !isDate(value.start) || !isDate(value.end)) {
        throw new UsageError(`Edit ${n}: baseline must be { start, end } dates.`);
      }
      return { start: value.start, end: value.end };
    case "fields":
      if (typeof value !== "object" || Array.isArray(value)) throw new UsageError(`Edit ${n}: fields must be an object.`);
      return value;
    default:
      return String(value).trim();
  }
}

/** The task with the edit's fields applied: `null` removes a field, `name` is an alias for label. */
function withTaskFields(task, edit, n) {
  const next = { ...task };
  const source = { ...edit };
  if (source.label === undefined && source.name !== undefined) source.label = source.name;
  // Accept common dependency aliases so AI specs never silently drop schedule links.
  if (source.dependsOn === undefined) {
    if (source.dependencies !== undefined) source.dependsOn = source.dependencies;
    else if (source.predecessors !== undefined) source.dependsOn = source.predecessors;
  }
  const unknown = Object.keys(source).filter((key) => !TASK_KEYS.includes(key) && !EDIT_ONLY_KEYS.has(key));
  if (unknown.length) {
    throw new UsageError(`Edit ${n}: unknown task field${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")}.`);
  }
  for (const key of TASK_KEYS) {
    if (source[key] === undefined) continue;
    if (source[key] === null || source[key] === "") {
      if (key === "label" || key === "start" || key === "end") throw new UsageError(`Edit ${n}: ${key} cannot be cleared.`);
      delete next[key];
    } else {
      const cleaned = cleanValue(key, source[key], n);
      if (key === "dependsOn" && Array.isArray(cleaned) && cleaned.length === 0) delete next.dependsOn;
      else next[key] = cleaned;
    }
  }
  if (source.outlineLevel !== undefined || source.summary !== undefined) {
    const fields = { ...(next.fields ?? {}) };
    if (source.outlineLevel === null) delete fields.outlineLevel;
    else if (source.outlineLevel !== undefined) {
      const level = Math.floor(Number(source.outlineLevel));
      if (!Number.isFinite(level) || level < 1) throw new UsageError(`Edit ${n}: outlineLevel must be 1 or more.`);
      fields.outlineLevel = level;
    }
    if (source.summary === true) fields.summary = true;
    else if (source.summary !== undefined) delete fields.summary;
    if (Object.keys(fields).length) next.fields = fields;
    else delete next.fields;
  }
  if (next.start && next.end && next.end < next.start) throw new UsageError(`Edit ${n}: end is before start.`);
  return next;
}

function withoutDependency(task, id) {
  const deps = task.dependsOn;
  if (!deps) return task;
  const all = Array.isArray(deps) ? deps : [deps];
  const list = all.filter((dep) => {
    if (typeof dep === "string") return dep.split(":")[0].replace(/[+-]\d+(?:d|days?)?$/i, "") !== id;
    return dep?.id !== id;
  });
  if (list.length === all.length) return task;
  const { dependsOn: _drop, ...rest } = task;
  return list.length ? { ...rest, dependsOn: list } : rest;
}

function isEvolvePerson(person) {
  return typeof person?.id === "string" && person.id.startsWith(EVOLVE_ID_PREFIX);
}

/** Evolve people some task is still assigned to; people typed into the plan are always kept. */
function prunePeople(people, tasks) {
  const assigned = new Set(tasks.map((task) => nameKey(task.assignee)).filter(Boolean));
  return people.filter((person) => !isEvolvePerson(person) || assigned.has(nameKey(person.name)));
}

/** Task ids from `id` or `ids`, all of which must exist. */
function targetIds(edit, tasks, n, op) {
  const ids = Array.isArray(edit.ids) ? edit.ids.map(String) : edit.id != null ? [String(edit.id)] : [];
  if (!ids.length) throw new UsageError(`Edit ${n}: ${op} needs id or ids.`);
  const missing = ids.filter((id) => !tasks.some((task) => task.id === id));
  if (missing.length) throw new UsageError(`Edit ${n}: task ${missing.join(", ")} not found.`);
  return ids;
}

function nextTaskId(tasks) {
  const used = new Set(tasks.map((task) => task.id));
  let n = tasks.length + 1;
  while (used.has(`t${n}`)) n += 1;
  return `t${n}`;
}

function newTask(raw, tasks, meta, n) {
  const id = String(raw.id || nextTaskId(tasks)).trim();
  if (tasks.some((task) => task.id === id)) throw new UsageError(`Edit ${n}: task ${id} already exists.`);
  const start = raw.start || meta.createdAt || today();
  const end = raw.milestone ? raw.end || start : raw.end || start;
  const base = { id, label: String(raw.label || raw.name || id), category: "default", start, end };
  return withTaskFields(base, { ...raw, start, end }, n);
}

/**
 * Validate that every dependency points to an existing task and that there are no circular loops.
 */
export function validateDependencies(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    for (const depId of getTaskDependencies(task)) {
      if (depId === task.id) {
        throw new UsageError(`${taskLabel(task)} (${task.id}) cannot depend on itself.`);
      }
      if (!byId.has(depId)) {
        throw new UsageError(`${taskLabel(task)} depends on task ${depId}, which does not exist.`);
      }
    }
  }
  // Cycle detection via 3-colour DFS.
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    state.set(id, 1);
    stack.push(id);
    const task = byId.get(id);
    for (const depId of getTaskDependencies(task)) {
      const seen = state.get(depId) ?? 0;
      if (seen === 1) {
        const startAt = stack.indexOf(depId);
        const loop = [...stack.slice(startAt), depId].join(" → ");
        throw new UsageError(`Circular dependency detected: ${loop}.`);
      }
      if (seen === 0) visit(depId);
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const task of tasks) {
    if ((state.get(task.id) ?? 0) === 0) visit(task.id);
  }
}

/**
 * Roll up summary row start/end dates from their child tasks (bottom-up), using outlineLevel
 * hierarchy when present, falling back to WBS dot-prefix matching (e.g. "1" -> "1.1", "1.2").
 */
export function rollupSummaryTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return [];
  const next = tasks.map((task) => ({ ...task }));
  const summaryIndices = [];
  for (let i = 0; i < next.length; i += 1) {
    if (isSummaryTask(next[i])) summaryIndices.push(i);
  }
  // Process deeper summary levels first so nested phases roll up accurately.
  summaryIndices.sort((a, b) => (outlineLevelOf(next[b]) ?? 1) - (outlineLevelOf(next[a]) ?? 1));

  for (const idx of summaryIndices) {
    const parent = next[idx];
    const parentLevel = outlineLevelOf(parent);
    const parentWbs = typeof parent.wbs === "string" ? parent.wbs.trim() : "";
    const children = [];

    if (parentLevel != null) {
      for (let j = idx + 1; j < next.length; j += 1) {
        const level = outlineLevelOf(next[j]);
        if (level != null && level <= parentLevel) break;
        if (level != null && level > parentLevel) children.push(next[j]);
        else if (level == null && !isSummaryTask(next[j])) children.push(next[j]);
        else if (isSummaryTask(next[j])) break;
      }
    } else if (parentWbs) {
      const prefix = `${parentWbs}.`;
      for (let j = idx + 1; j < next.length; j += 1) {
        const wbs = typeof next[j].wbs === "string" ? next[j].wbs.trim() : "";
        if (wbs.startsWith(prefix)) children.push(next[j]);
      }
    }

    if (children.length === 0) continue;
    let minStart = null;
    let maxEnd = null;
    for (const child of children) {
      if (isDate(child.start) && (!minStart || child.start < minStart)) minStart = child.start;
      if (isDate(child.end) && (!maxEnd || child.end > maxEnd)) maxEnd = child.end;
    }
    if (minStart && maxEnd && maxEnd >= minStart) {
      next[idx] = { ...parent, start: minStart, end: maxEnd };
    }
  }
  return next;
}

/**
 * Normalize a fresh task array (used by `ocsc-plan new`), validating categories, fields,
 * dependencies, cycles, schedule cascade and summary rollups.
 */
export function preparePlan(plan, { reschedule = true } = {}) {
  const meta = { ...(plan.meta ?? {}) };
  const categories = { default: DEFAULT_CATEGORY, ...(plan.categories ?? {}) };
  const resolveCategory = (raw) => {
    if (raw.category == null) return raw;
    const key = findCategory(categories, raw.category);
    if (key) return { ...raw, category: key };
    const label = String(raw.category).trim();
    if (!label) return { ...raw, category: "default" };
    const created = categoryKey(label, Object.keys(categories));
    categories[created] = {
      label: /[A-Z\s]/.test(label) ? label : readableLabel(label),
      color: nextCategoryColour(categories),
    };
    return { ...raw, category: created };
  };

  const normalizedTasks = [];
  for (const [index, raw] of (plan.tasks ?? []).entries()) {
    if (!raw || typeof raw !== "object") {
      throw new UsageError(`Task ${index + 1}: must be a JSON object.`);
    }
    normalizedTasks.push(newTask(resolveCategory(raw), normalizedTasks, meta, index + 1));
  }
  validateDependencies(normalizedTasks);
  const gapDays = typeof meta.defaultGapDays === "number" ? meta.defaultGapDays : 0;
  const scheduled = reschedule ? resolveSchedule(normalizedTasks, gapDays) : normalizedTasks;
  const aligned = syncContiguousGapDays(scheduled);
  const rolled = rollupSummaryTasks(aligned);
  return withCategories({
    ...plan,
    meta,
    categories,
    tasks: rolled,
  });
}

/** Inserts `task` before or after another task, or at an index, else at the end. */
function placeTask(tasks, task, edit, n) {
  const anchor = edit.before ?? edit.after;
  if (anchor != null) {
    const at = tasks.findIndex((item) => item.id === String(anchor));
    if (at < 0) throw new UsageError(`Edit ${n}: task ${anchor} not found.`);
    tasks.splice(edit.before != null ? at : at + 1, 0, task);
  } else if (edit.index != null) {
    tasks.splice(Math.max(0, Math.min(tasks.length, Number(edit.index))), 0, task);
  } else {
    tasks.push(task);
  }
}

export function applyEdits(plan, edits) {
  let tasks = [...(plan.tasks ?? [])];
  const meta = { ...(plan.meta ?? {}) };
  const categories = { default: DEFAULT_CATEGORY, ...(plan.categories ?? {}) };
  let people = [...(plan.people ?? [])];
  const summary = [];
  const resolveCategory = (raw, n) => {
    if (raw.category == null) return raw;
    const key = findCategory(categories, raw.category);
    if (key) return { ...raw, category: key };
    const label = String(raw.category).trim();
    if (!label) throw new UsageError(`Edit ${n}: category cannot be empty.`);
    const created = categoryKey(label, Object.keys(categories));
    categories[created] = { label: /[A-Z\s]/.test(label) ? label : readableLabel(label), color: nextCategoryColour(categories) };
    summary.push(`added category ${categories[created].label}`);
    return { ...raw, category: created };
  };

  for (const [index, edit] of edits.entries()) {
    const n = index + 1;
    if (!edit || typeof edit !== "object") throw new UsageError(`Edit ${n}: not an object.`);
    const op = edit.op;
    if (op === "add_task") {
      const { op: _op, before, after, index: _index, ...raw } = edit;
      const task = newTask(resolveCategory(raw, n), tasks, meta, n);
      placeTask(tasks, task, edit, n);
      summary.push(`added ${taskLabel(task)}`);
    } else if (op === "set_tasks") {
      if (!Array.isArray(edit.tasks)) throw new UsageError(`Edit ${n}: set_tasks needs tasks array.`);
      const next = [];
      for (const raw of edit.tasks) {
        if (!raw || typeof raw !== "object") throw new UsageError(`Edit ${n}: task ${next.length + 1} invalid.`);
        next.push(newTask(resolveCategory(raw, n), next, meta, n));
      }
      tasks = next;
      summary.push(`set ${tasks.length} tasks`);
    } else if (op === "update_task" || op === "reschedule_task") {
      const ids = targetIds(edit, tasks, n, op);
      const { op: _op, id: _id, ids: _ids, ...raw } = edit;
      const fields = resolveCategory(raw, n);
      tasks = tasks.map((task) => (ids.includes(task.id) ? withTaskFields(task, fields, n) : task));
      summary.push(`updated ${ids.length === 1 ? taskLabel(tasks.find((task) => task.id === ids[0])) : `${ids.length} tasks`}`);
    } else if (op === "move_task") {
      const [id] = targetIds(edit, tasks, n, op);
      const task = tasks.find((item) => item.id === id);
      tasks = tasks.filter((item) => item.id !== id);
      if (edit.before == null && edit.after == null && edit.index == null) {
        throw new UsageError(`Edit ${n}: move_task needs before, after or index.`);
      }
      placeTask(tasks, task, edit, n);
      summary.push(`moved ${taskLabel(task)}`);
    } else if (op === "delete_task") {
      const ids = targetIds(edit, tasks, n, op);
      tasks = tasks.filter((task) => !ids.includes(task.id));
      for (const id of ids) tasks = tasks.map((task) => withoutDependency(task, id));
      summary.push(`deleted ${ids.join(", ")}`);
    } else if (op === "link_tasks") {
      const from = String(edit.from || "").trim();
      const to = String(edit.to || edit.id || "").trim();
      const at = tasks.findIndex((task) => task.id === to);
      if (at < 0) throw new UsageError(`Edit ${n}: task ${to} not found.`);
      if (!tasks.some((task) => task.id === from)) throw new UsageError(`Edit ${n}: task ${from} not found.`);
      if (from === to) throw new UsageError(`Edit ${n}: a task cannot depend on itself.`);
      const rawLag = edit.lag ?? edit.lagDays;
      const [dep] = cleanDependsOn(
        edit.type || rawLag != null ? { id: from, type: edit.type || "FS", ...(rawLag != null ? { lag: rawLag } : {}) } : from,
        n,
      );
      const rest = withoutDependency(tasks[at], from);
      const kept = rest.dependsOn == null ? [] : Array.isArray(rest.dependsOn) ? rest.dependsOn : [rest.dependsOn];
      tasks[at] = { ...rest, dependsOn: [...kept, dep] };
      summary.push(`linked ${from} → ${to}`);
    } else if (op === "unlink_tasks") {
      const from = String(edit.from || "").trim();
      const to = String(edit.to || edit.id || "").trim();
      const at = tasks.findIndex((task) => task.id === to);
      if (at < 0) throw new UsageError(`Edit ${n}: task ${to} not found.`);
      tasks[at] = withoutDependency(tasks[at], from);
      summary.push(`unlinked ${from} → ${to}`);
    } else if (op === "assign") {
      const ids = targetIds(edit, tasks, n, op);
      const name = edit.name == null ? "" : String(edit.name).trim().replace(/\s+/g, " ");
      if (name) {
        const profileId = edit.evolveProfileId != null ? String(edit.evolveProfileId).trim() : "";
        const role = String(edit.jobTitle ?? edit.role ?? "").trim();
        if (profileId) {
          people = people.filter(
            (person) => !(isEvolvePerson(person) && (person.evolveProfileId === profileId || nameKey(person.name) === nameKey(name))),
          );
          people.push({ id: `${EVOLVE_ID_PREFIX}${profileId}`, name, ...(role ? { role } : {}), evolveProfileId: profileId });
        }
      }
      tasks = tasks.map((task) => {
        if (!ids.includes(task.id)) return task;
        if (name) return { ...task, assignee: name };
        const { assignee: _drop, ...rest } = task;
        return rest;
      });
      summary.push(name ? `assigned ${name} to ${ids.length} task${ids.length > 1 ? "s" : ""}` : `removed the owner from ${ids.length} task${ids.length > 1 ? "s" : ""}`);
    } else if (op === "add_category") {
      const label = String(edit.label ?? "").trim();
      if (!label) throw new UsageError(`Edit ${n}: add_category needs label.`);
      if (findCategory(categories, label)) {
        throw new UsageError(`Edit ${n}: category ${label} already exists; use update_category.`);
      }
      const key = categoryKey(edit.key || label, Object.keys(categories));
      categories[key] = { label, color: edit.color != null ? colour(edit.color, n) : nextCategoryColour(categories) };
      summary.push(`added category ${label}`);
    } else if (op === "update_category") {
      const key = findCategory(categories, edit.key ?? edit.category);
      if (!key) throw new UsageError(`Edit ${n}: category ${edit.key ?? edit.category} not found.`);
      const label = edit.label != null ? String(edit.label).trim() : categories[key].label;
      if (!label) throw new UsageError(`Edit ${n}: category label cannot be empty.`);
      const clash = findCategory(categories, label);
      if (clash && clash !== key) throw new UsageError(`Edit ${n}: another category is already called ${label}.`);
      categories[key] = {
        ...categories[key],
        label,
        ...(edit.color != null ? { color: colour(edit.color, n) } : {}),
      };
      summary.push(`updated category ${label}`);
    } else if (op === "delete_category") {
      const key = findCategory(categories, edit.key ?? edit.label);
      if (!key) throw new UsageError(`Edit ${n}: category ${edit.key ?? edit.label} not found.`);
      if (key === "default") throw new UsageError(`Edit ${n}: the General category cannot be deleted.`);
      const target = findCategory(categories, edit.reassignTo ?? "default");
      if (!target || target === key) throw new UsageError(`Edit ${n}: reassignTo must be another existing category.`);
      const label = categories[key].label;
      delete categories[key];
      tasks = tasks.map((task) => (task.category === key ? { ...task, category: target } : task));
      summary.push(`deleted category ${label}`);
    } else if (op === "set_baseline") {
      const ids = edit.ids || edit.id != null ? targetIds(edit, tasks, n, op) : tasks.map((task) => task.id);
      tasks = tasks.map((task) => {
        if (!ids.includes(task.id)) return task;
        if (edit.clear) {
          const { baseline: _drop, ...rest } = task;
          return rest;
        }
        return { ...task, baseline: { start: task.start, end: task.end } };
      });
      summary.push(`${edit.clear ? "cleared" : "saved"} the baseline for ${ids.length} task${ids.length > 1 ? "s" : ""}`);
    } else if (op === "set_meta") {
      if (edit.title != null) {
        const title = String(edit.title).trim();
        if (!title) throw new UsageError(`Edit ${n}: title cannot be empty.`);
        meta.title = title;
      }
      for (const key of ["description", "author", "version"]) {
        if (edit[key] === null) delete meta[key];
        else if (edit[key] != null) meta[key] = String(edit[key]);
      }
      if (edit.today === null) delete meta.today;
      else if (edit.today != null) {
        if (!isDate(edit.today)) throw new UsageError(`Edit ${n}: today must be a date like 2026-03-02.`);
        meta.today = edit.today;
      }
      if (edit.defaultGapDays === null) delete meta.defaultGapDays;
      else if (edit.defaultGapDays != null) {
        const gap = Number(edit.defaultGapDays);
        if (!Number.isFinite(gap) || gap < 0) throw new UsageError(`Edit ${n}: defaultGapDays must be 0 or more.`);
        meta.defaultGapDays = gap;
      }
      summary.push("updated programme details");
    } else if (op === "set_evolve") {
      if (edit.clear || edit.jobNumber == null) {
        delete meta.evolve;
        summary.push("cleared Evolve link");
      } else {
        meta.evolve = {
          jobNumber: String(edit.jobNumber).trim(),
          ...(edit.projectId ? { projectId: String(edit.projectId) } : {}),
          ...(edit.name ? { name: String(edit.name) } : {}),
        };
        summary.push(`linked Evolve job ${meta.evolve.jobNumber}`);
      }
    } else {
      throw new UsageError(`Edit ${n}: unknown op ${JSON.stringify(op)}.`);
    }
  }

  validateDependencies(tasks);
  people = prunePeople(people, tasks);
  const gapDays = typeof meta.defaultGapDays === "number" ? meta.defaultGapDays : 0;
  const resolved = rollupSummaryTasks(syncContiguousGapDays(resolveSchedule(tasks, gapDays)));
  const { people: _people, ...rest } = plan;
  return {
    plan: {
      ...rest,
      meta,
      categories,
      ...(people.length ? { people } : {}),
      tasks: resolved,
    },
    summary,
  };
}

/**
 * Full Critical Path Method (CPM) and schedule logic audit for a programme.
 * Gives the AI immediate visibility into the driving critical chain, float, unlinked/open-ended
 * tasks, summary-row link mistakes, and Jantt's schedule health grade.
 */
export function analyzeSchedule(plan) {
  const tasks = (plan.tasks ?? []).filter((task) => !task?._deleted);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const leafTasks = tasks.filter((task) => !isSummaryTask(task));
  const summaryTasks = tasks.filter((task) => isSummaryTask(task));
  const milestones = leafTasks.filter((task) => Boolean(task.milestone));

  const gapDays = typeof plan.meta?.defaultGapDays === "number" ? plan.meta.defaultGapDays : 0;
  const critical = calculateCriticalPath(tasks, { defaultGapDays: gapDays });
  const leafCritical = calculateCriticalPath(leafTasks, { defaultGapDays: gapDays });
  const audit = auditScheduleIntegrity(leafTasks, leafCritical);

  const predecessorsMap = new Map(tasks.map((task) => [task.id, []]));
  const successorsMap = new Map(tasks.map((task) => [task.id, []]));
  let dependencyCount = 0;
  const summaryLinkWarnings = [];

  for (const task of tasks) {
    const preds = getTaskDependencies(task).filter((depId) => byId.has(depId) && depId !== task.id);
    predecessorsMap.set(task.id, preds);
    dependencyCount += preds.length;
    for (const predId of preds) {
      successorsMap.get(predId)?.push(task.id);
      if (isSummaryTask(task) || isSummaryTask(byId.get(predId))) {
        summaryLinkWarnings.push(`${predId} → ${task.id}`);
      }
    }
  }

  let projectStart = null;
  let projectFinish = null;
  for (const task of leafTasks.length ? leafTasks : tasks) {
    if (isDate(task.start) && (!projectStart || task.start < projectStart)) projectStart = task.start;
    if (isDate(task.end) && (!projectFinish || task.end > projectFinish)) projectFinish = task.end;
  }

  const unlinkedLeafTasks = [];
  const openStartTasks = [];
  const openFinishTasks = [];
  if (leafTasks.length > 1) {
    for (const task of leafTasks) {
      const preds = predecessorsMap.get(task.id) ?? [];
      const succs = successorsMap.get(task.id) ?? [];
      if (preds.length === 0 && succs.length === 0) {
        unlinkedLeafTasks.push(task.id);
      } else {
        if (preds.length === 0 && task.start !== projectStart) openStartTasks.push(task.id);
        if (succs.length === 0 && task.end !== projectFinish) openFinishTasks.push(task.id);
      }
    }
  }

  const criticalTasks = leafTasks
    .filter((task) => leafCritical.criticalTaskIds.has(task.id))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)) || String(a.end).localeCompare(String(b.end)))
    .map((task) => ({
      id: task.id,
      label: taskLabel(task),
      start: task.start,
      end: task.end,
      durationDays: diffDays(task.start, task.end),
      ...(task.milestone ? { milestone: true } : {}),
    }));

  const warnings = [];
  if (leafTasks.length > 1 && dependencyCount === 0) {
    warnings.push(
      `Zero dependencies defined across ${leafTasks.length} tasks — the critical path will not link. Add dependsOn links between predecessors and successors.`,
    );
  }
  if (unlinkedLeafTasks.length > 0) {
    warnings.push(
      `${unlinkedLeafTasks.length} unlinked leaf task${unlinkedLeafTasks.length === 1 ? "" : "s"} (${unlinkedLeafTasks.slice(0, 8).join(", ")}${unlinkedLeafTasks.length > 8 ? ", …" : ""}) have neither predecessors nor successors.`,
    );
  }
  if (openStartTasks.length > 0) {
    warnings.push(
      `${openStartTasks.length} task${openStartTasks.length === 1 ? "" : "s"} start after project kick-off with no predecessor (${openStartTasks.slice(0, 8).join(", ")}${openStartTasks.length > 8 ? ", …" : ""}).`,
    );
  }
  if (openFinishTasks.length > 0) {
    warnings.push(
      `${openFinishTasks.length} task${openFinishTasks.length === 1 ? "" : "s"} finish before project completion with no successor (${openFinishTasks.slice(0, 8).join(", ")}${openFinishTasks.length > 8 ? ", …" : ""}).`,
    );
  }
  if (summaryLinkWarnings.length > 0) {
    warnings.push(
      `${summaryLinkWarnings.length} link${summaryLinkWarnings.length === 1 ? "" : "s"} attach to a summary row (${summaryLinkWarnings.slice(0, 5).join(", ")}) — move logic links onto leaf tasks or milestones.`,
    );
  }
  if (leafTasks.length > 1 && dependencyCount > 0 && leafCritical.criticalDepKeys.size === 0 && criticalTasks.length > 1) {
    warnings.push(
      "Critical tasks are not connected by critical links — check whether parallel or unlinked tasks are driving the finish date instead of a continuous logic chain.",
    );
  }

  return {
    projectStart,
    projectFinish,
    durationDays: projectStart && projectFinish ? diffDays(projectStart, projectFinish) : 0,
    criticalPath: {
      count: criticalTasks.length,
      criticalLinks: leafCritical.criticalDepKeys.size,
      tasks: criticalTasks,
    },
    logic: {
      leafTaskCount: leafTasks.length,
      summaryTaskCount: summaryTasks.length,
      milestoneCount: milestones.length,
      dependencyCount,
      unlinkedLeafTasks,
      openStartTasks,
      openFinishTasks,
      summaryLinkWarnings,
    },
    health: {
      grade: audit.grade,
      score: audit.healthScore,
      summary: audit.summary,
      issueCount: audit.issues.length,
      issues: audit.issues.slice(0, 12).map((issue) => ({
        type: issue.type,
        severity: issue.severity,
        taskId: issue.taskId,
        message: issue.message,
      })),
    },
    warnings,
    _internal: {
      criticalTaskIds: leafCritical.criticalTaskIds.size ? leafCritical.criticalTaskIds : critical.criticalTaskIds,
      metrics: leafCritical.metrics.size ? leafCritical.metrics : critical.metrics,
      successorsMap,
    },
  };
}

/** Compact schedule summary included in `new` and `edit` responses so the AI verifies CPM immediately. */
export function compactScheduleSummary(plan) {
  const analysis = analyzeSchedule(plan);
  return {
    projectStart: analysis.projectStart,
    projectFinish: analysis.projectFinish,
    durationDays: analysis.durationDays,
    dependencyCount: analysis.logic.dependencyCount,
    criticalCount: analysis.criticalPath.count,
    criticalLinks: analysis.criticalPath.criticalLinks,
    criticalChain: analysis.criticalPath.tasks.slice(0, 20).map((t) => `${t.id}: ${t.label} (${t.start} → ${t.end})`),
    healthGrade: analysis.health.grade,
    healthScore: analysis.health.score,
    ...(analysis.logic.unlinkedLeafTasks.length ? { unlinkedLeafTasks: analysis.logic.unlinkedLeafTasks.slice(0, 15) } : {}),
    ...(analysis.logic.openStartTasks.length ? { openStartTasks: analysis.logic.openStartTasks.slice(0, 15) } : {}),
    ...(analysis.logic.openFinishTasks.length ? { openFinishTasks: analysis.logic.openFinishTasks.slice(0, 15) } : {}),
    ...(analysis.logic.summaryLinkWarnings.length ? { summaryLinkWarnings: analysis.logic.summaryLinkWarnings.slice(0, 10) } : {}),
    ...(analysis.warnings.length ? { warnings: analysis.warnings } : {}),
  };
}

/**
 * Everything the AI needs to edit a programme by id: categories, people, critical path, schedule
 * health and each task's fields (including float, critical flag and successors).
 * `find` keeps tasks whose label, id, owner, category or WBS contains every word; `from` and
 * `limit` page through what is left.
 */
export function describePlan(plan, { from = 0, limit, find } = {}) {
  const tasks = plan.tasks ?? [];
  const analysis = analyzeSchedule(plan);
  const { _internal, ...schedule } = analysis;
  const words = nameKey(find).split(/\s+/).filter(Boolean);
  const categoryLabel = (task) => plan.categories?.[task.category || "default"]?.label ?? "";
  const matching = words.length
    ? tasks.filter((task) => {
        const text = nameKey(`${task.id} ${taskLabel(task)} ${task.assignee ?? ""} ${categoryLabel(task)} ${task.wbs ?? ""}`);
        return words.every((word) => text.includes(word));
      })
    : tasks;
  const shown = matching.slice(from, limit ? from + limit : undefined);
  return {
    title: plan.meta?.title ?? null,
    meta: plan.meta ?? {},
    schedule,
    categories: Object.entries(plan.categories ?? {}).map(([key, category]) => ({
      key,
      label: category?.label ?? key,
      color: category?.color ?? null,
      tasks: tasks.filter((task) => (task.category || "default") === key).length,
    })),
    people: (plan.people ?? []).map((person) => ({
      name: person.name,
      ...(person.role ? { role: person.role } : {}),
      ...(person.evolveProfileId ? { evolveProfileId: person.evolveProfileId } : {}),
      tasks: tasks.filter((task) => nameKey(task.assignee) === nameKey(person.name)).length,
    })),
    owners: [...new Set(tasks.map((task) => task.assignee).filter(Boolean))],
    taskCount: tasks.length,
    ...(words.length ? { matchingTasks: matching.length } : {}),
    ...(shown.length < matching.length ? { shownTasks: `${from + 1}–${from + shown.length}` } : {}),
    ...(from + shown.length < matching.length ? { nextFrom: from + shown.length } : {}),
    tasks: shown.map((task) => {
      const out = { id: task.id, label: taskLabel(task), category: task.category || "default", start: task.start, end: task.end };
      for (const key of TASK_KEYS) {
        if (key in out || task[key] == null || key === "fields") continue;
        out[key] = task[key];
      }
      if (task.fields?.outlineLevel != null) out.outlineLevel = task.fields.outlineLevel;
      if (task.fields?.summary) out.summary = true;
      const custom = Object.fromEntries(
        Object.entries(task.fields ?? {}).filter(([key]) => key !== "outlineLevel" && key !== "summary"),
      );
      if (Object.keys(custom).length) out.fields = custom;
      if (!isSummaryTask(task)) {
        if (_internal.criticalTaskIds.has(task.id)) out.isCritical = true;
        const m = _internal.metrics.get(task.id);
        if (m && typeof m.totalFloat === "number") out.totalFloat = m.totalFloat;
      }
      const succs = _internal.successorsMap.get(task.id);
      if (succs?.length) out.successors = succs;
      return out;
    }),
  };
}
