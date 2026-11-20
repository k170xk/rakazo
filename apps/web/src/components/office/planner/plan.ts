import {
  getTaskDependencies,
  hasDependencyCycle,
  resolveSchedule,
  type JanttData,
  type Task,
} from "@jantt/core";

/** Evolve project link stored on a plan's meta.evolve field. */
export type PlanEvolveLink = {
  jobNumber: string;
  projectId?: string;
  name?: string;
};

export type PlanDocument = JanttData & {
  meta?: JanttData["meta"] & {
    evolve?: PlanEvolveLink;
    title?: string;
    createdAt?: string;
  };
};

/** A blank programme with OCSC green as the default category. */
export function blankPlan(title: string): PlanDocument {
  return {
    $schema: "https://ahmadhassan-bted.github.io/Jantt/schema/v1.json",
    meta: {
      title: title.trim() || "Untitled plan",
      createdAt: new Date().toISOString().slice(0, 10),
    },
    categories: {
      default: { label: "General", color: "#76BF43" },
    },
    tasks: [],
  };
}

/**
 * Make `toId` depend on `fromId` and reschedule, the same way Jantt's own link drag does.
 * Returns null when nothing changes (same task, unknown task, already linked) and an error when
 * the link would close a loop.
 */
export function linkTasks(
  plan: PlanDocument,
  fromId: string,
  toId: string,
): { plan: PlanDocument } | { error: "cycle" } | null {
  if (fromId === toId) return null;
  const target = plan.tasks.find((task) => task.id === toId);
  if (!target || !plan.tasks.some((task) => task.id === fromId)) return null;
  const existing = getTaskDependencies(target);
  if (existing.includes(fromId)) return null;
  const dependsOn = existing.length === 0 ? fromId : [...existing, fromId];
  const tasks = plan.tasks.map((task) => (task.id === toId ? { ...task, dependsOn } : task));
  if (hasDependencyCycle(tasks)) {
    return { error: "cycle" };
  }
  return { plan: { ...plan, tasks: resolveSchedule(tasks, plan.meta?.defaultGapDays ?? 2) } };
}

export const MIN_VISIBLE_MONTHS = 12;

/**
 * The chart window: from the first of the month the programme starts (or this month when it has
 * no tasks) to at least twelve months later, so a new programme in November still shows next
 * year. Jantt widens it on its own when tasks run past either end.
 */
export function programmeWindow(
  tasks: readonly Pick<Task, "start">[],
  today: Date = new Date(),
): { startDate: string; endDate: string } {
  const starts = tasks
    .map((task) => task.start)
    .filter((start): start is string => typeof start === "string" && /^\d{4}-\d{2}-\d{2}/.test(start))
    .sort();
  const [year, month] = starts[0]
    ? [Number(starts[0].slice(0, 4)), Number(starts[0].slice(5, 7)) - 1]
    : [today.getFullYear(), today.getMonth()];
  const iso = (y: number, m: number) =>
    new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return { startDate: iso(year, month), endDate: iso(year, month + MIN_VISIBLE_MONTHS) };
}

/** Parse plan bytes; throws when the JSON is not a Jantt plan. */
export function parsePlan(bytes: ArrayBuffer | Uint8Array): PlanDocument {
  const text = new TextDecoder().decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const parsed: unknown = JSON.parse(text);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !Array.isArray((parsed as PlanDocument).tasks)
  ) {
    throw new Error("Not a project plan");
  }
  return parsed as PlanDocument;
}

export function planBytes(plan: PlanDocument): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(plan, null, 2)}\n`);
}

export function planTitle(plan: PlanDocument, fallback: string): string {
  const title = plan.meta?.title?.trim();
  return title || fallback;
}

export function evolveLinkOf(plan: PlanDocument): PlanEvolveLink | null {
  const link = plan.meta?.evolve;
  if (!link || typeof link.jobNumber !== "string" || !link.jobNumber.trim()) return null;
  return {
    jobNumber: link.jobNumber.trim(),
    ...(link.projectId ? { projectId: link.projectId } : {}),
    ...(link.name ? { name: link.name } : {}),
  };
}

export function withEvolveLink(plan: PlanDocument, link: PlanEvolveLink | null): PlanDocument {
  const meta = { ...(plan.meta ?? {}) };
  if (!link) {
    delete meta.evolve;
  } else {
    meta.evolve = {
      jobNumber: link.jobNumber.trim(),
      ...(link.projectId ? { projectId: link.projectId } : {}),
      ...(link.name ? { name: link.name } : {}),
    };
  }
  return { ...plan, meta };
}

/** Tasks added or changed in `after` compared with `before`, to point out the assistant's edits. */
export function changedTaskIds(
  before: PlanDocument | null | undefined,
  after: PlanDocument | null | undefined,
): Set<string> {
  const changed = new Set<string>();
  if (!before || !after) return changed;
  const old = new Map((before.tasks ?? []).map((task) => [task.id, JSON.stringify(task)]));
  for (const task of after.tasks ?? []) {
    if (old.get(task.id) !== JSON.stringify(task)) changed.add(task.id);
  }
  return changed;
}

export function taskLabel(task: Task): string {
  return (task.label ?? task.name ?? task.id).trim() || task.id;
}
