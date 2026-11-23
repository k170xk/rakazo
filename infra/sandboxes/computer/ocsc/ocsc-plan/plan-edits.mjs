/**
 * The edits ocsc-plan applies to a Jantt programme. They cover everything the studio's task
 * drawer, category picker and owner picker can do, and store each change in the same shape the
 * studio writes, so an AI edit looks and restores exactly like a manual one.
 */
import {
  auditScheduleIntegrity,
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
  "durationWeeks",
  "durationWorkDays",
  "durationDays",
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

function addIsoDays(dateStr, delta) {
  const ms = Date.parse(dateStr);
  if (Number.isNaN(ms)) return dateStr;
  const d = new Date(ms);
  d.setUTCDate(d.getUTCDate() + (Number.isFinite(delta) ? Math.round(delta) : 0));
  return d.toISOString().slice(0, 10);
}

/**
 * Normalize holiday / blackout periods (`"YYYY-MM-DD"` or `{ start, end, label? }`).
 */
export function normalizeHolidays(raw, context = "holidays") {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new UsageError(`${context}: must be an array of { start, end, label? } or YYYY-MM-DD dates.`);
  }
  const out = [];
  for (const [idx, entry] of raw.entries()) {
    if (typeof entry === "string") {
      if (!isDate(entry)) {
        throw new UsageError(`${context}[${idx}]: date must be YYYY-MM-DD.`);
      }
      out.push({ start: entry, end: entry });
    } else if (entry && typeof entry === "object") {
      const start = String(entry.start ?? "").trim();
      const end = String(entry.end ?? start).trim();
      if (!isDate(start) || !isDate(end) || end < start) {
        throw new UsageError(`${context}[${idx}]: requires valid start/end YYYY-MM-DD with end >= start.`);
      }
      out.push({
        start,
        end,
        ...(entry.label ? { label: String(entry.label).trim() } : {}),
      });
    } else {
      throw new UsageError(`${context}[${idx}]: must be a date string or { start, end, label? }.`);
    }
  }
  return out;
}

function isNonWorkingDay(dateStr, holidays) {
  const dow = utcWeekday(dateStr);
  if (dow === 0 || dow === 6) return true;
  for (const h of holidays) {
    if (dateStr >= h.start && dateStr <= h.end) return true;
  }
  return false;
}

function nextWorkingDay(dateStr, holidays) {
  let cur = dateStr;
  for (let guard = 0; guard < 400; guard += 1) {
    if (!isNonWorkingDay(cur, holidays)) return cur;
    cur = addIsoDays(cur, 1);
  }
  return cur;
}

function prevWorkingDay(dateStr, holidays) {
  let cur = dateStr;
  for (let guard = 0; guard < 400; guard += 1) {
    if (!isNonWorkingDay(cur, holidays)) return cur;
    cur = addIsoDays(cur, -1);
  }
  return cur;
}

function nextWorkingDayAfter(dateStr, holidays) {
  return nextWorkingDay(addIsoDays(dateStr, 1), holidays);
}

function addWorkingDaysInclusive(startStr, workDays, holidays) {
  const start = nextWorkingDay(startStr, holidays);
  if (workDays <= 1) return { start, end: start };
  let cur = start;
  let remaining = Math.round(workDays) - 1;
  for (let guard = 0; guard < 5000 && remaining > 0; guard += 1) {
    cur = addIsoDays(cur, 1);
    if (!isNonWorkingDay(cur, holidays)) remaining -= 1;
  }
  return { start, end: cur };
}

function subWorkingDaysInclusive(endStr, workDays, holidays) {
  const end = prevWorkingDay(endStr, holidays);
  if (workDays <= 1) return { start: end, end };
  let cur = end;
  let remaining = Math.round(workDays) - 1;
  for (let guard = 0; guard < 5000 && remaining > 0; guard += 1) {
    cur = addIsoDays(cur, -1);
    if (!isNonWorkingDay(cur, holidays)) remaining -= 1;
  }
  return { start: cur, end };
}

function extractDurationSpec(raw, n) {
  const hasWeeks = raw?.durationWeeks !== undefined && raw?.durationWeeks !== null;
  const hasWork = raw?.durationWorkDays !== undefined && raw?.durationWorkDays !== null;
  const hasCal = raw?.durationDays !== undefined && raw?.durationDays !== null;
  if (!hasWeeks && !hasWork && !hasCal) {
    // A milestone without explicit start/end is also auto-scheduled from its predecessors.
    if (raw?.milestone && !raw?.start && !raw?.end) {
      return { mode: "milestone", value: 0, hasStartPin: false };
    }
    return null;
  }
  if (raw?.milestone) {
    return { mode: "milestone", value: 0, hasStartPin: isDate(raw?.start) };
  }
  if (hasWeeks) {
    const w = Number(raw.durationWeeks);
    if (!Number.isFinite(w) || w < 0) throw new UsageError(`Task ${n}: durationWeeks must be 0 or more.`);
    return { mode: "work", value: Math.max(0, Math.round(w * 5)), hasStartPin: isDate(raw?.start) };
  }
  if (hasWork) {
    const wd = Number(raw.durationWorkDays);
    if (!Number.isFinite(wd) || wd < 0) throw new UsageError(`Task ${n}: durationWorkDays must be 0 or more.`);
    return { mode: "work", value: Math.max(0, Math.round(wd)), hasStartPin: isDate(raw?.start) };
  }
  const cd = Number(raw.durationDays);
  if (!Number.isFinite(cd) || cd < 0) throw new UsageError(`Task ${n}: durationDays must be 0 or more.`);
  return { mode: "calendar", value: Math.max(0, Math.round(cd)), hasStartPin: isDate(raw?.start) };
}

/**
 * Deterministic PDM forward-pass scheduler for tasks specifying `durationWeeks`,
 * `durationWorkDays`, `durationDays`, or dateless milestones.
 *
 * - Respects Mon–Fri working days and any `meta.holidays` blackout periods for working-day tasks.
 * - Evaluates all four PDM dependency types (`FS`, `SS`, `FF`, `SF`) + per-edge `lag`.
 * - Treats an explicit `start` alongside a duration as a Start-No-Earlier-Than (SNET) constraint.
 * - Sets `gapDays` when a binding zero-lag `FS` transition bridges a weekend or holiday blackout so
 *   both `ocsc-plan` and Jantt keep the Critical Path continuous with red dependency arrows.
 * - Preserves tasks that specify explicit `start` and `end` with no duration spec untouched.
 */
export function autoScheduleDurationTasks(tasks, durationSpecs, meta = {}) {
  if (!durationSpecs || durationSpecs.size === 0) return tasks;
  const holidays = normalizeHolidays(meta.holidays, "meta.holidays");
  const fallbackStart = isDate(meta.projectStart)
    ? meta.projectStart
    : isDate(meta.createdAt)
      ? meta.createdAt
      : today();

  const next = tasks.map((t) => ({ ...t }));
  const byId = new Map(next.map((t) => [t.id, t]));

  // Topological order (Kahn's algorithm; validateDependencies already verified acyclicity).
  const inDeg = new Map();
  const out = new Map();
  for (const t of next) {
    inDeg.set(t.id, 0);
    out.set(t.id, []);
  }
  for (const t of next) {
    const seen = new Set();
    for (const rel of parseDepEntries(t)) {
      if (!byId.has(rel.id) || rel.id === t.id || seen.has(rel.id)) continue;
      seen.add(rel.id);
      inDeg.set(t.id, (inDeg.get(t.id) ?? 0) + 1);
      out.get(rel.id).push(t.id);
    }
  }
  const queue = next.filter((t) => (inDeg.get(t.id) ?? 0) === 0).map((t) => t.id);
  const topo = [];
  for (let i = 0; i < queue.length; i += 1) {
    const id = queue[i];
    topo.push(id);
    for (const succ of out.get(id) ?? []) {
      const d = (inDeg.get(succ) ?? 1) - 1;
      inDeg.set(succ, d);
      if (d === 0) queue.push(succ);
    }
  }
  for (const t of next) {
    if (!topo.includes(t.id)) topo.push(t.id);
  }

  for (const id of topo) {
    const spec = durationSpecs.get(id);
    if (!spec) continue;
    const task = byId.get(id);
    if (!task || isSummaryTask(task)) continue;

    const deps = parseDepEntries(task).filter((d) => byId.has(d.id) && d.id !== id);
    let earliestStart = spec.hasStartPin && isDate(task.start) ? task.start : null;
    let earliestEnd = null;
    // Track the binding zero-lag FS predecessor candidate so weekend/holiday bridges keep CPM tight.
    let bindingZeroLagFsPredEnd = null;
    let bindingZeroLagFsStart = null;

    const considerStart = (candidate, zeroLagFsPredEnd = null) => {
      if (!isDate(candidate)) return;
      if (!earliestStart || candidate > earliestStart) {
        earliestStart = candidate;
        bindingZeroLagFsPredEnd = zeroLagFsPredEnd;
        bindingZeroLagFsStart = zeroLagFsPredEnd ? candidate : null;
      } else if (candidate === earliestStart && zeroLagFsPredEnd) {
        if (!bindingZeroLagFsPredEnd || zeroLagFsPredEnd > bindingZeroLagFsPredEnd) {
          bindingZeroLagFsPredEnd = zeroLagFsPredEnd;
          bindingZeroLagFsStart = candidate;
        }
      }
    };

    const considerEnd = (candidate) => {
      if (!isDate(candidate)) return;
      if (!earliestEnd || candidate > earliestEnd) earliestEnd = candidate;
    };

    for (const dep of deps) {
      const pred = byId.get(dep.id);
      if (!pred || !isDate(pred.start) || !isDate(pred.end)) continue;
      const lag = dep.lag ?? 0;
      if (dep.type === "SS") {
        considerStart(addIsoDays(pred.start, lag));
      } else if (dep.type === "FF") {
        considerEnd(addIsoDays(pred.end, lag));
      } else if (dep.type === "SF") {
        considerEnd(addIsoDays(pred.start, lag));
      } else {
        // FS
        if (lag === 0) {
          if (spec.mode === "milestone") {
            considerStart(pred.end, pred.end);
          } else if (spec.mode === "calendar") {
            considerStart(addIsoDays(pred.end, 1), pred.end);
          } else {
            considerStart(nextWorkingDayAfter(pred.end, holidays), pred.end);
          }
        } else {
          considerStart(addIsoDays(pred.end, lag));
        }
      }
    }

    if (!earliestStart && !earliestEnd) {
      earliestStart = fallbackStart;
    }

    let start;
    let end;
    if (spec.mode === "milestone" || spec.value === 0) {
      const anchor = earliestStart && earliestEnd
        ? (earliestEnd > earliestStart ? earliestEnd : earliestStart)
        : (earliestStart || earliestEnd || fallbackStart);
      start = anchor;
      end = anchor;
    } else if (spec.mode === "calendar") {
      const calSpan = Math.max(0, spec.value - 1);
      if (earliestStart) {
        start = earliestStart;
        end = addIsoDays(start, calSpan);
      } else {
        end = earliestEnd;
        start = addIsoDays(end, -calSpan);
      }
      if (earliestEnd && earliestEnd > end) {
        end = earliestEnd;
        const backStart = addIsoDays(end, -calSpan);
        start = earliestStart && earliestStart > backStart ? earliestStart : backStart;
      }
    } else {
      // Working-day duration (Mon–Fri excluding meta.holidays)
      if (earliestStart) {
        const span = addWorkingDaysInclusive(earliestStart, spec.value, holidays);
        start = span.start;
        end = span.end;
      } else {
        const span = subWorkingDaysInclusive(earliestEnd, spec.value, holidays);
        start = span.start;
        end = span.end;
      }
      if (earliestEnd && earliestEnd > end) {
        const span = subWorkingDaysInclusive(earliestEnd, spec.value, holidays);
        end = earliestEnd;
        start = earliestStart && earliestStart > span.start ? nextWorkingDay(earliestStart, holidays) : span.start;
      }
    }

    task.start = start;
    task.end = end;

    // If a zero-lag FS transition bridged a weekend or holiday blackout, record gapDays so CPM stays 0d tight.
    if (
      bindingZeroLagFsPredEnd &&
      bindingZeroLagFsStart === start &&
      task.gapDays == null &&
      task.minGapDays == null
    ) {
      const bridge = signedDiffDays(bindingZeroLagFsPredEnd, start);
      if (Number.isFinite(bridge) && bridge > 0) {
        task.gapDays = bridge;
      }
    }
  }

  return next;
}

function taskGapDays(task, defaultGapDays = 0) {
  if (task?.gapDays !== undefined && task?.gapDays !== null) return task.gapDays;
  if (task?.minGapDays !== undefined && task?.minGapDays !== null) return task.minGapDays;
  return defaultGapDays;
}

/**
 * Full Precedence Diagram Method (PDM) Critical Path Method calculation supporting all four
 * engineering dependency types (FS, SS, FF, SF) plus per-edge lag days, while excluding unlinked
 * WBS summary/phase rows. Matches our patched @jantt/core CPM engine identically.
 */
export function calculatePdmCriticalPath(tasks, options = {}) {
  const criticalTaskIds = new Set();
  const criticalDepKeys = new Set();
  const nearCriticalTaskIds = new Set();
  const metrics = new Map();
  const criticalPaths = [];
  const raw = (tasks ?? []).filter((t) => !t?._deleted);
  if (raw.length === 0) {
    return {
      criticalTaskIds,
      criticalDepKeys,
      nearCriticalTaskIds,
      projectEarlyFinish: "",
      projectLateFinish: "",
      projectTotalFloat: 0,
      criticalPaths,
      metrics,
    };
  }

  const allById = new Map(raw.map((t) => [t.id, t]));
  const linkedIds = new Set();
  for (const t of raw) {
    for (const rel of parseDepEntries(t)) {
      if (allById.has(rel.id) && rel.id !== t.id) {
        linkedIds.add(rel.id);
        linkedIds.add(t.id);
      }
    }
  }
  const filtered = raw.filter((t) => !isSummaryTask(t) || linkedIds.has(t.id));
  const active = filtered.length > 0 ? filtered : raw;

  const byId = new Map();
  const inRels = new Map();
  const outRels = new Map();
  const inDeg = new Map();
  const duration = new Map();

  for (const t of active) {
    byId.set(t.id, t);
    inRels.set(t.id, []);
    outRels.set(t.id, []);
    inDeg.set(t.id, 0);
    duration.set(t.id, Math.max(0, signedDiffDays(t.start, t.end) || 0));
  }

  for (const t of active) {
    const seen = new Set();
    const predIds = new Set();
    const rels = [];
    for (const rel of parseDepEntries(t)) {
      if (!byId.has(rel.id) || rel.id === t.id) continue;
      const type = (rel.type || "FS").toUpperCase();
      const lag = Number.isFinite(rel.lag) ? rel.lag : 0;
      const key = `${rel.id}:${type}:${lag}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rels.push({ id: rel.id, type, lag });
      predIds.add(rel.id);
      outRels.get(rel.id).push({ to: t.id, type, lag });
    }
    inRels.set(t.id, rels);
    inDeg.set(t.id, predIds.size);
  }

  const queue = [];
  for (const [id, deg] of inDeg.entries()) {
    if (deg === 0) queue.push(id);
  }
  const order = [];
  const remDeg = new Map(inDeg);
  while (queue.length > 0) {
    const id = queue.shift();
    order.push(id);
    const seenSucc = new Set();
    for (const edge of outRels.get(id) ?? []) {
      if (seenSucc.has(edge.to)) continue;
      seenSucc.add(edge.to);
      const deg = remDeg.get(edge.to) - 1;
      remDeg.set(edge.to, deg);
      if (deg === 0) queue.push(edge.to);
    }
  }
  if (order.length < active.length) {
    const seen = new Set(order);
    for (const t of active) {
      if (!seen.has(t.id)) order.push(t.id);
    }
  }

  const defaultGap = typeof options.defaultGapDays === "number" ? options.defaultGapDays : 0;
  const edgeLag = (rel, succTask) =>
    rel.type === "FS" && rel.lag === 0 ? taskGapDays(succTask, defaultGap) : rel.lag;

  const earlyStart = new Map();
  const earlyFinish = new Map();
  const drivingPreds = new Map();

  for (const id of order) {
    const task = byId.get(id);
    const rels = inRels.get(id) ?? [];
    const dur = duration.get(id) ?? 0;
    let es = task.start;
    if (rels.length > 0) {
      let maxCand = null;
      for (const rel of rels) {
        const pred = byId.get(rel.id);
        const pES = earlyStart.get(rel.id) ?? pred.start;
        const pEF = earlyFinish.get(rel.id) ?? pred.end;
        const L = edgeLag(rel, task);
        let cand;
        if (rel.type === "SS") cand = addIsoDays(pES, L);
        else if (rel.type === "FF") cand = addIsoDays(pEF, L - dur);
        else if (rel.type === "SF") cand = addIsoDays(pES, L - dur);
        else cand = addIsoDays(pEF, L);
        if (!maxCand || signedDiffDays(maxCand, cand) > 0) maxCand = cand;
      }
      if (maxCand && signedDiffDays(es, maxCand) > 0) es = maxCand;
    }
    const drivers = [];
    const pushed = new Set();
    for (const rel of rels) {
      const pred = byId.get(rel.id);
      const pES = earlyStart.get(rel.id) ?? pred.start;
      const pEF = earlyFinish.get(rel.id) ?? pred.end;
      const L = edgeLag(rel, task);
      let cand;
      if (rel.type === "SS") cand = addIsoDays(pES, L);
      else if (rel.type === "FF") cand = addIsoDays(pEF, L - dur);
      else if (rel.type === "SF") cand = addIsoDays(pES, L - dur);
      else cand = addIsoDays(pEF, L);
      if (signedDiffDays(cand, es) === 0 && !pushed.has(rel.id)) {
        pushed.add(rel.id);
        drivers.push(rel.id);
      }
    }
    earlyStart.set(id, es);
    earlyFinish.set(id, addIsoDays(es, dur));
    drivingPreds.set(id, drivers);
  }

  let projectEarlyFinish = earlyFinish.get(active[0].id) ?? active[0].end;
  for (const t of active) {
    const ef = earlyFinish.get(t.id) ?? t.end;
    if (signedDiffDays(projectEarlyFinish, ef) > 0) projectEarlyFinish = ef;
  }
  const projectLateFinish =
    typeof options.targetDate === "string" && options.targetDate.trim()
      ? options.targetDate.trim()
      : projectEarlyFinish;

  const lateFinish = new Map();
  const lateStart = new Map();
  for (const id of [...order].reverse()) {
    const edges = outRels.get(id) ?? [];
    const dur = duration.get(id) ?? 0;
    if (edges.length === 0) {
      lateFinish.set(id, projectLateFinish);
    } else {
      let minLf = projectLateFinish;
      for (const edge of edges) {
        const succ = byId.get(edge.to);
        const sLS = lateStart.get(edge.to);
        const sLF = lateFinish.get(edge.to);
        const L = edgeLag(edge, succ);
        let bound;
        if (edge.type === "SS") bound = addIsoDays(sLS, -L + dur);
        else if (edge.type === "FF") bound = addIsoDays(sLF, -L);
        else if (edge.type === "SF") bound = addIsoDays(sLF, -L + dur);
        else bound = addIsoDays(sLS, -L);
        if (signedDiffDays(bound, minLf) > 0) minLf = bound;
      }
      lateFinish.set(id, minLf);
    }
    lateStart.set(id, addIsoDays(lateFinish.get(id), -dur));
  }

  const totalFloat = new Map();
  const freeFloat = new Map();
  let minTotalFloat = Infinity;
  for (const t of active) {
    const es = earlyStart.get(t.id);
    const ls = lateStart.get(t.id);
    const ef = earlyFinish.get(t.id);
    const tf = signedDiffDays(es, ls);
    totalFloat.set(t.id, tf);
    if (tf < minTotalFloat) minTotalFloat = tf;

    const edges = outRels.get(t.id) ?? [];
    if (edges.length === 0) {
      freeFloat.set(t.id, tf);
    } else {
      let minFf = Infinity;
      for (const edge of edges) {
        const succ = byId.get(edge.to);
        const sES = earlyStart.get(edge.to);
        const sEF = earlyFinish.get(edge.to);
        const L = edgeLag(edge, succ);
        let ff;
        if (edge.type === "SS") ff = signedDiffDays(es, addIsoDays(sES, -L));
        else if (edge.type === "FF") ff = signedDiffDays(ef, addIsoDays(sEF, -L));
        else if (edge.type === "SF") ff = signedDiffDays(es, addIsoDays(sEF, -L));
        else ff = signedDiffDays(ef, addIsoDays(sES, -L));
        if (ff < minFf) minFf = ff;
      }
      freeFloat.set(t.id, Math.max(0, Math.min(tf, minFf)));
    }
  }

  const projectTotalFloat = minTotalFloat === Infinity ? 0 : minTotalFloat;
  const nearThr = options.nearCriticalThresholdDays ?? 3;
  for (const t of active) {
    const tf = totalFloat.get(t.id);
    const isCrit = tf <= 0 || tf === minTotalFloat;
    const isNear = !isCrit && tf - Math.min(0, minTotalFloat) <= nearThr;
    if (isCrit) criticalTaskIds.add(t.id);
    else if (isNear) nearCriticalTaskIds.add(t.id);
    let slackLabel = `${tf}d buffer`;
    if (tf < 0) slackLabel = `Overdue by ${Math.abs(tf)}d`;
    else if (tf === 0) slackLabel = "0d (Critical)";
    metrics.set(t.id, {
      taskId: t.id,
      earlyStart: earlyStart.get(t.id),
      earlyFinish: earlyFinish.get(t.id),
      lateStart: lateStart.get(t.id),
      lateFinish: lateFinish.get(t.id),
      totalFloat: tf,
      freeFloat: freeFloat.get(t.id),
      isCritical: isCrit,
      isNearCritical: isNear,
      drivingPredecessors: drivingPreds.get(t.id) ?? [],
      slackLabel,
    });
  }

  for (const t of active) {
    if (!criticalTaskIds.has(t.id)) continue;
    const vES = earlyStart.get(t.id);
    const vEF = earlyFinish.get(t.id);
    for (const rel of inRels.get(t.id) ?? []) {
      if (!criticalTaskIds.has(rel.id)) continue;
      const pES = earlyStart.get(rel.id);
      const pEF = earlyFinish.get(rel.id);
      const L = edgeLag(rel, t);
      let tight = false;
      if (rel.type === "SS") tight = signedDiffDays(addIsoDays(pES, L), vES) === 0;
      else if (rel.type === "FF") tight = signedDiffDays(addIsoDays(pEF, L), vEF) === 0;
      else if (rel.type === "SF") tight = signedDiffDays(addIsoDays(pES, L), vEF) === 0;
      else tight = signedDiffDays(addIsoDays(pEF, L), vES) === 0;
      if (tight) criticalDepKeys.add(`${rel.id}->${t.id}`);
    }
  }

  const critIn = new Map();
  const critOut = new Map();
  for (const id of criticalTaskIds) {
    critIn.set(id, 0);
    critOut.set(id, []);
  }
  for (const key of criticalDepKeys) {
    const [from, to] = key.split("->");
    if (critIn.has(to)) critIn.set(to, critIn.get(to) + 1);
    if (critOut.has(from)) critOut.get(from).push(to);
  }
  const walk = (id, chain) => {
    const nexts = critOut.get(id) ?? [];
    if (nexts.length === 0) {
      criticalPaths.push([...chain]);
      return;
    }
    for (const nxt of nexts) {
      if (chain.includes(nxt)) continue;
      chain.push(nxt);
      walk(nxt, chain);
      chain.pop();
    }
  };
  for (const [id, deg] of critIn.entries()) {
    if (deg === 0) walk(id, [id]);
  }

  return {
    criticalTaskIds,
    criticalDepKeys,
    nearCriticalTaskIds,
    projectEarlyFinish,
    projectLateFinish,
    projectTotalFloat,
    criticalPaths,
    metrics,
  };
}

/**
 * In normal engineering programmes, a zero-lag Finish-to-Start successor starts the next working
 * day (+1 calendar day, or +3 from Friday to Monday / +2 from Saturday to Monday). Setting
 * `gapDays` on those tight zero-lag FS transitions keeps Jantt's Critical Path continuous with red
 * arrows across the entire driving chain instead of breaking at every next-day or weekend boundary,
 * while explicit FS/SS/FF/SF lags are evaluated per-edge by the PDM CPM engine.
 */
export function syncContiguousGapDays(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return tasks.map((task) => {
    if (isSummaryTask(task) || task.gapDays != null || task.minGapDays != null) return task;
    const deps = parseDepEntries(task).filter((d) => byId.has(d.id) && d.id !== task.id);
    if (deps.length === 0) return task;
    const fsZeroLagDeps = deps.filter((d) => d.type === "FS" && d.lag === 0);
    if (fsZeroLagDeps.length === 0) return task;

    let tightestDiff = Infinity;
    let tightestPred = null;
    for (const dep of fsZeroLagDeps) {
      const pred = byId.get(dep.id);
      if (!pred || !isDate(pred.end) || !isDate(task.start)) continue;
      const d = signedDiffDays(pred.end, task.start);
      if (Number.isNaN(d) || d < 0) continue;
      if (d < tightestDiff) {
        tightestDiff = d;
        tightestPred = pred;
      }
    }
    if (!tightestPred || !Number.isFinite(tightestDiff) || tightestDiff === 0) return task;

    const predDay = utcWeekday(tightestPred.end);
    const taskDay = utcWeekday(task.start);
    const isNextDay = tightestDiff === 1;
    const isWeekendJump =
      taskDay === 1 && ((predDay === 5 && tightestDiff === 3) || (predDay === 6 && tightestDiff === 2));

    if (isNextDay || isWeekendJump) {
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
  if (meta.projectStart != null) {
    if (!isDate(meta.projectStart)) throw new UsageError("projectStart must be a date like 2026-05-04.");
  }
  if (meta.targetFinish != null) {
    if (!isDate(meta.targetFinish)) throw new UsageError("targetFinish must be a date like 2028-04-28.");
  }
  if (meta.holidays != null) {
    meta.holidays = normalizeHolidays(meta.holidays, "holidays");
  }
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
  const durationSpecs = new Map();
  for (const [index, raw] of (plan.tasks ?? []).entries()) {
    if (!raw || typeof raw !== "object") {
      throw new UsageError(`Task ${index + 1}: must be a JSON object.`);
    }
    const task = newTask(resolveCategory(raw), normalizedTasks, meta, index + 1);
    const durSpec = extractDurationSpec(raw, index + 1);
    if (durSpec) durationSpecs.set(task.id, durSpec);
    normalizedTasks.push(task);
  }
  validateDependencies(normalizedTasks);
  const gapDays = typeof meta.defaultGapDays === "number" ? meta.defaultGapDays : 0;
  const autoScheduled =
    reschedule && durationSpecs.size > 0
      ? autoScheduleDurationTasks(normalizedTasks, durationSpecs, meta)
      : normalizedTasks;
  const scheduled = reschedule ? resolveSchedule(autoScheduled, gapDays) : autoScheduled;
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
  const durationSpecs = new Map();
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
      const durSpec = extractDurationSpec(raw, n);
      if (durSpec) durationSpecs.set(task.id, durSpec);
      placeTask(tasks, task, edit, n);
      summary.push(`added ${taskLabel(task)}`);
    } else if (op === "set_tasks") {
      if (!Array.isArray(edit.tasks)) throw new UsageError(`Edit ${n}: set_tasks needs tasks array.`);
      durationSpecs.clear();
      const next = [];
      for (const raw of edit.tasks) {
        if (!raw || typeof raw !== "object") throw new UsageError(`Edit ${n}: task ${next.length + 1} invalid.`);
        const task = newTask(resolveCategory(raw, n), next, meta, n);
        const durSpec = extractDurationSpec(raw, n);
        if (durSpec) durationSpecs.set(task.id, durSpec);
        next.push(task);
      }
      tasks = next;
      summary.push(`set ${tasks.length} tasks`);
    } else if (op === "update_task" || op === "reschedule_task") {
      const ids = targetIds(edit, tasks, n, op);
      const { op: _op, id: _id, ids: _ids, ...raw } = edit;
      const fields = resolveCategory(raw, n);
      const durSpec = extractDurationSpec(raw, n);
      tasks = tasks.map((task) => {
        if (!ids.includes(task.id)) return task;
        const updated = withTaskFields(task, fields, n);
        if (durSpec) {
          durationSpecs.set(task.id, durSpec);
          if (raw.gapDays === undefined && raw.minGapDays === undefined) delete updated.gapDays;
        }
        return updated;
      });
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
      for (const dateKey of ["projectStart", "targetFinish"]) {
        if (edit[dateKey] === null) delete meta[dateKey];
        else if (edit[dateKey] != null) {
          if (!isDate(edit[dateKey])) throw new UsageError(`Edit ${n}: ${dateKey} must be a date like 2026-05-04.`);
          meta[dateKey] = edit[dateKey];
        }
      }
      if (edit.holidays === null) delete meta.holidays;
      else if (edit.holidays != null) {
        meta.holidays = normalizeHolidays(edit.holidays, `Edit ${n}: holidays`);
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
  if (meta.defaultGapDays === undefined) meta.defaultGapDays = 0;
  const gapDays = typeof meta.defaultGapDays === "number" ? meta.defaultGapDays : 0;
  const autoScheduled =
    durationSpecs.size > 0 ? autoScheduleDurationTasks(tasks, durationSpecs, meta) : tasks;
  const resolved = rollupSummaryTasks(syncContiguousGapDays(resolveSchedule(autoScheduled, gapDays)));
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
  const critical = calculatePdmCriticalPath(tasks, { defaultGapDays: gapDays });
  const leafCritical = calculatePdmCriticalPath(leafTasks, { defaultGapDays: gapDays });
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

  const targetFinish = isDate(plan.meta?.targetFinish) ? plan.meta.targetFinish : null;
  const finishVarianceDays =
    targetFinish && projectFinish ? signedDiffDays(targetFinish, projectFinish) : null;
  if (targetFinish && finishVarianceDays != null && finishVarianceDays > 0) {
    warnings.push(
      `Programme finishes on ${projectFinish}, which is ${finishVarianceDays} calendar day${finishVarianceDays === 1 ? "" : "s"} PAST targetFinish (${targetFinish}). Review critical path overlaps (SS + lag) and long-lead procurement, or flag the overrun clearly to the user.`,
    );
  }

  return {
    projectStart,
    projectFinish,
    durationDays: projectStart && projectFinish ? diffDays(projectStart, projectFinish) : 0,
    ...(targetFinish
      ? {
          targetFinish,
          finishVarianceDays,
          onTarget: finishVarianceDays != null ? finishVarianceDays <= 0 : null,
        }
      : {}),
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
  const criticalChainLimit = 60;
  return {
    projectStart: analysis.projectStart,
    projectFinish: analysis.projectFinish,
    durationDays: analysis.durationDays,
    ...(analysis.targetFinish
      ? {
          targetFinish: analysis.targetFinish,
          finishVarianceDays: analysis.finishVarianceDays,
          onTarget: analysis.onTarget,
        }
      : {}),
    leafTaskCount: analysis.logic.leafTaskCount,
    dependencyCount: analysis.logic.dependencyCount,
    criticalCount: analysis.criticalPath.count,
    criticalLinks: analysis.criticalPath.criticalLinks,
    criticalChain: analysis.criticalPath.tasks
      .slice(0, criticalChainLimit)
      .map((t) => `${t.id}: ${t.label} (${t.start} → ${t.end})`),
    ...(analysis.criticalPath.tasks.length > criticalChainLimit ? { criticalChainTruncated: true } : {}),
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
