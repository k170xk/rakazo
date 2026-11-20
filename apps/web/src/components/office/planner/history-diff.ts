import { plural, t } from "@lingui/core/macro";
import { parsePlan, taskLabel } from "./plan";

type SnapshotTask = {
  id: string;
  label: string;
  start: string;
  end: string;
  category: string;
  assignee: string;
  progress: number | null;
  status: string;
  priority: string;
  notes: string;
  links: string;
  baseline: string;
  cost: string;
  /** Everything else the drawer edits (WBS, outline, milestone, custom fields…), compared as one. */
  details: string;
};

type SnapshotCategory = { key: string; label: string; color: string };

export type PlanSnapshot = {
  title: string;
  jobNumber: string | null;
  categories: SnapshotCategory[];
  tasks: SnapshotTask[];
};

type TaskChange =
  | { kind: "dates"; from: string; to: string }
  | { kind: "renamed"; from: string }
  | { kind: "category" | "owner" | "status" | "priority"; from: string; to: string }
  | { kind: "progress"; from: number | null; to: number | null }
  | { kind: "notes" | "links" | "baseline" | "cost" | "details" };

export type PlanDiff = {
  titleChanged: boolean;
  jobChanged: boolean;
  orderChanged: boolean;
  categoriesAdded: SnapshotCategory[];
  categoriesRemoved: SnapshotCategory[];
  categoriesChanged: { key: string; label: string; from: string }[];
  added: SnapshotTask[];
  removed: SnapshotTask[];
  changed: { id: string; label: string; changes: TaskChange[] }[];
};

const text = (value: unknown) => (value == null ? "" : String(value).trim());
const json = (value: unknown) => (value == null ? "" : JSON.stringify(value));

export function readPlanSnapshot(bytes: Uint8Array): Promise<PlanSnapshot> {
  const plan = parsePlan(bytes);
  return Promise.resolve({
    title: plan.meta?.title?.trim() || "",
    jobNumber: plan.meta?.evolve?.jobNumber?.trim() || null,
    categories: Object.entries(plan.categories ?? {}).map(([key, category]) => ({
      key,
      label: text(category?.label) || key,
      color: text(category?.color).toLowerCase(),
    })),
    tasks: plan.tasks
      .filter((task) => !task._deleted)
      .map((task) => ({
        id: task.id,
        label: taskLabel(task),
        start: task.start ?? "",
        end: task.end ?? "",
        category: text(task.category) || "default",
        assignee: text(task.assignee),
        progress: typeof task.progress === "number" ? task.progress : null,
        status: text(task.status),
        priority: text(task.priority),
        notes: text(task.notes) + text(task.description),
        links: json(task.dependsOn),
        baseline: json(task.baseline),
        cost: `${text(task.estimatedCost)}|${text(task.actualCost)}`,
        details: json([task.wbs, task.phase, task.milestone, task.urgent, task.locked, task.fields]),
      })),
  });
}

export function comparePlans(before: PlanSnapshot | null, after: PlanSnapshot): PlanDiff {
  if (!before) {
    return {
      titleChanged: false,
      jobChanged: false,
      orderChanged: false,
      categoriesAdded: [],
      categoriesRemoved: [],
      categoriesChanged: [],
      added: after.tasks,
      removed: [],
      changed: [],
    };
  }
  const beforeIds = new Map(before.tasks.map((task) => [task.id, task]));
  const afterIds = new Map(after.tasks.map((task) => [task.id, task]));
  const beforeCategories = new Map(before.categories.map((category) => [category.key, category]));
  const afterCategories = new Map(after.categories.map((category) => [category.key, category]));
  const categoryName = (key: string, snapshot: PlanSnapshot) =>
    snapshot.categories.find((category) => category.key === key)?.label ?? key;

  const changed: PlanDiff["changed"] = [];
  for (const task of after.tasks) {
    const prior = beforeIds.get(task.id);
    if (!prior) continue;
    const changes: TaskChange[] = [];
    if (prior.label !== task.label) changes.push({ kind: "renamed", from: prior.label });
    if (prior.start !== task.start || prior.end !== task.end) {
      changes.push({ kind: "dates", from: `${prior.start} → ${prior.end}`, to: `${task.start} → ${task.end}` });
    }
    if (prior.category !== task.category) {
      changes.push({ kind: "category", from: categoryName(prior.category, before), to: categoryName(task.category, after) });
    }
    if (prior.assignee !== task.assignee) changes.push({ kind: "owner", from: prior.assignee, to: task.assignee });
    if (prior.progress !== task.progress) changes.push({ kind: "progress", from: prior.progress, to: task.progress });
    if (prior.status !== task.status) changes.push({ kind: "status", from: prior.status, to: task.status });
    if (prior.priority !== task.priority) changes.push({ kind: "priority", from: prior.priority, to: task.priority });
    for (const kind of ["notes", "links", "baseline", "cost", "details"] as const) {
      if (prior[kind] !== task[kind]) changes.push({ kind });
    }
    if (changes.length) changed.push({ id: task.id, label: task.label, changes });
  }

  const kept = (tasks: SnapshotTask[], other: Map<string, SnapshotTask>) =>
    tasks.filter((task) => other.has(task.id)).map((task) => task.id).join("\n");
  return {
    titleChanged: before.title !== after.title,
    jobChanged: before.jobNumber !== after.jobNumber,
    orderChanged: kept(before.tasks, afterIds) !== kept(after.tasks, beforeIds),
    categoriesAdded: after.categories.filter((category) => !beforeCategories.has(category.key)),
    categoriesRemoved: before.categories.filter((category) => !afterCategories.has(category.key)),
    categoriesChanged: after.categories.flatMap((category) => {
      const prior = beforeCategories.get(category.key);
      return prior && (prior.label !== category.label || prior.color !== category.color)
        ? [{ key: category.key, label: category.label, from: prior.label }]
        : [];
    }),
    added: after.tasks.filter((task) => !beforeIds.has(task.id)),
    removed: before.tasks.filter((task) => !afterIds.has(task.id)),
    changed,
  };
}

export function isEmpty(diff: PlanDiff) {
  return (
    !diff.titleChanged &&
    !diff.jobChanged &&
    !diff.orderChanged &&
    diff.categoriesAdded.length === 0 &&
    diff.categoriesRemoved.length === 0 &&
    diff.categoriesChanged.length === 0 &&
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.changed.length === 0
  );
}

export function summary(diff: PlanDiff): string {
  const parts: string[] = [];
  if (diff.titleChanged) parts.push(t`Title changed`);
  if (diff.jobChanged) parts.push(t`Evolve job changed`);
  const categories = diff.categoriesAdded.length + diff.categoriesRemoved.length + diff.categoriesChanged.length;
  if (categories)
    parts.push(plural(categories, { one: "# category changed", other: "# categories changed" }));
  if (diff.added.length)
    parts.push(plural(diff.added.length, { one: "# task added", other: "# tasks added" }));
  if (diff.removed.length)
    parts.push(plural(diff.removed.length, { one: "# task removed", other: "# tasks removed" }));
  if (diff.changed.length)
    parts.push(plural(diff.changed.length, { one: "# task updated", other: "# tasks updated" }));
  if (diff.orderChanged && !diff.added.length && !diff.removed.length) parts.push(t`Tasks reordered`);
  return parts.length > 0 ? parts.join(", ") : t`No changes`;
}

const percent = (value: number | null) => (value == null ? "–" : `${Math.round(value * 100)}%`);

export function describeChange(change: TaskChange): string {
  switch (change.kind) {
    case "renamed":
      return t`renamed from “${change.from}”`;
    case "dates":
      return `${change.from} → ${change.to}`;
    case "category":
      return t`category ${change.from} → ${change.to}`;
    case "owner":
      return change.to
        ? change.from
          ? t`owner ${change.from} → ${change.to}`
          : t`assigned to ${change.to}`
        : t`owner ${change.from} removed`;
    case "progress":
      return t`progress ${percent(change.from)} → ${percent(change.to)}`;
    case "status":
      return t`status ${change.from || "–"} → ${change.to || "–"}`;
    case "priority":
      return t`priority ${change.from || "–"} → ${change.to || "–"}`;
    case "notes":
      return t`notes`;
    case "links":
      return t`dependencies`;
    case "baseline":
      return t`baseline`;
    case "cost":
      return t`cost`;
    case "details":
      return t`details`;
  }
}
