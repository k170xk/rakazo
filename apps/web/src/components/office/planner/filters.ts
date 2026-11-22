import {
  addDays,
  freezeProjectBaseline,
  syncTaskProgressAndStatus,
  taskDurationDays,
  type NoteItem,
  type Task,
} from "@jantt/core";
import { isSummaryTask } from "./ms-project-plan";
import { taskLabel, type PlanDocument } from "./plan";

export type PlanViewMode = "gantt" | "kanban" | "tasks" | "health" | "notes";

export type KanbanStatus =
  | "not-started"
  | "in-progress"
  | "blocked"
  | "in-review"
  | "completed";

export const KANBAN_STATUSES: readonly KanbanStatus[] = [
  "not-started",
  "in-progress",
  "blocked",
  "in-review",
  "completed",
];

export const TASK_PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type PlanFilters = {
  query: string;
  categories: string[];
  statuses: KanbanStatus[];
  priorities: TaskPriority[];
  assignee: string;
  criticalOnly: boolean;
  milestonesOnly: boolean;
  unassignedOnly: boolean;
};

export const EMPTY_FILTERS: PlanFilters = {
  query: "",
  categories: [],
  statuses: [],
  priorities: [],
  assignee: "",
  criticalOnly: false,
  milestonesOnly: false,
  unassignedOnly: false,
};

/** Count of structured filter pills active (excluding the search box). */
export function activeFilterCount(filters: PlanFilters): number {
  return (
    filters.categories.length +
    filters.statuses.length +
    filters.priorities.length +
    (filters.assignee ? 1 : 0) +
    (filters.criticalOnly ? 1 : 0) +
    (filters.milestonesOnly ? 1 : 0) +
    (filters.unassignedOnly ? 1 : 0)
  );
}

export function hasActiveFilters(filters: PlanFilters): boolean {
  return filters.query.trim().length > 0 || activeFilterCount(filters) > 0;
}

/** Map Jantt's status / progress combinations onto the five board columns. */
export function normaliseTaskStatus(task: Pick<Task, "status" | "progress">): KanbanStatus {
  const raw = (task.status ?? "").toLowerCase().trim();
  if (raw === "completed" || raw === "done") return "completed";
  if (raw === "blocked") return "blocked";
  if (raw === "in-review" || raw === "submitted" || raw === "review") return "in-review";
  if (raw === "in-progress" || raw === "active") return "in-progress";
  if (raw === "not-started" || raw === "todo") return "not-started";
  const progress = typeof task.progress === "number" ? task.progress : 0;
  if (progress >= 1) return "completed";
  if (progress > 0) return "in-progress";
  return "not-started";
}

export function normaliseTaskPriority(task: Pick<Task, "priority" | "urgent">): TaskPriority | null {
  if (task.urgent) return "urgent";
  const raw = (task.priority ?? "").toLowerCase().trim();
  if (raw === "urgent" || raw === "high" || raw === "medium" || raw === "low") return raw;
  return null;
}

export function matchesPlanFilters(
  task: Task,
  filters: PlanFilters,
  criticalIds: ReadonlySet<string>,
  categories?: PlanDocument["categories"],
): boolean {
  if (task._deleted) return false;

  const query = filters.query.trim().toLowerCase();
  if (query) {
    const catLabel = categories?.[task.category]?.label ?? "";
    const haystack = [
      taskLabel(task),
      task.id,
      task.wbs ?? "",
      task.category ?? "",
      catLabel,
      task.assignee ?? "",
      task.notes ?? "",
      task.description ?? "",
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  if (filters.categories.length > 0) {
    const key = task.category || "default";
    if (!filters.categories.includes(key)) return false;
  }

  if (filters.statuses.length > 0) {
    if (!filters.statuses.includes(normaliseTaskStatus(task))) return false;
  }

  if (filters.priorities.length > 0) {
    const priority = normaliseTaskPriority(task);
    if (!priority || !filters.priorities.includes(priority)) return false;
  }

  if (filters.assignee) {
    if ((task.assignee ?? "").trim().toLowerCase() !== filters.assignee.trim().toLowerCase()) {
      return false;
    }
  }

  if (filters.unassignedOnly && (task.assignee ?? "").trim().length > 0) return false;
  if (filters.milestonesOnly && !task.milestone) return false;
  if (filters.criticalOnly && !criticalIds.has(task.id)) return false;

  return true;
}

export function filterPlanTasks(
  plan: PlanDocument,
  filters: PlanFilters,
  criticalIds: ReadonlySet<string>,
): Task[] {
  return (plan.tasks ?? []).filter((task) =>
    matchesPlanFilters(task, filters, criticalIds, plan.categories),
  );
}

/** Category label and colour for a task, falling back to OCSC green. */
export function categoryMeta(
  plan: PlanDocument,
  key: string | undefined,
): { key: string; label: string; color: string } {
  const id = key || "default";
  const found = plan.categories?.[id];
  if (found) return { key: id, label: found.label || id, color: found.color || "#76BF43" };
  return { key: id, label: id === "default" ? "General" : id, color: "#76BF43" };
}

/** Task duration in whole days (0 for milestones). */
export function taskDays(task: Pick<Task, "start" | "end" | "milestone">): number {
  if (task.milestone) return 0;
  if (!task.start || !task.end) return 1;
  return Math.max(1, taskDurationDays(task.start, task.end, false));
}

/** Append a new task to the end of the programme without touching existing tasks. */
export function createNewTask(
  plan: PlanDocument,
  overrides: Partial<Task> = {},
  today: Date = new Date(),
): { plan: PlanDocument; task: Task } {
  const tasks = (plan.tasks ?? []).filter((task) => !task._deleted);
  const existingIds = new Set((plan.tasks ?? []).map((task) => task.id));
  let index = tasks.length + 1;
  while (existingIds.has(`task-${index}`)) index++;
  const id = `task-${index}`;

  const last = tasks[tasks.length - 1];
  const baseDate = last?.end || today.toISOString().slice(0, 10);
  const start = last?.end ? addDays(baseDate, 1) : baseDate;
  const end = addDays(start, 4);
  const defaultCategory = Object.keys(plan.categories ?? {})[0] ?? "default";

  const task: Task = {
    id,
    label: `New Task ${index}`,
    category: defaultCategory,
    start,
    end,
    progress: 0,
    status: "not-started",
    ...overrides,
  };
  return {
    plan: { ...plan, tasks: [...(plan.tasks ?? []), task] },
    task,
  };
}

/** Update a task's status and keep its progress aligned with Jantt's rules. */
export function setTaskStatus(
  plan: PlanDocument,
  taskId: string,
  status: KanbanStatus,
): PlanDocument {
  const janttStatus = status === "in-review" ? "submitted" : status;
  const tasks = (plan.tasks ?? []).map((task) => {
    if (task.id !== taskId) return task;
    const synced = syncTaskProgressAndStatus({ status: janttStatus }, task);
    const nextProgress =
      status === "completed"
        ? 1
        : status === "not-started"
          ? 0
          : status === "in-progress" && (!task.progress || task.progress >= 1)
            ? 0.25
            : synced.progress ?? task.progress ?? 0;
    return { ...task, ...synced, status: janttStatus, progress: nextProgress };
  });
  return { ...plan, tasks };
}

export function setTaskProgress(
  plan: PlanDocument,
  taskId: string,
  progress: number,
): PlanDocument {
  const clamped = Math.max(0, Math.min(1, Math.round(progress * 100) / 100));
  const tasks = (plan.tasks ?? []).map((task) => {
    if (task.id !== taskId) return task;
    const synced = syncTaskProgressAndStatus({ progress: clamped }, task);
    return { ...task, ...synced, progress: clamped };
  });
  return { ...plan, tasks };
}

export function setTaskPriority(
  plan: PlanDocument,
  taskId: string,
  priority: TaskPriority | null,
): PlanDocument {
  const tasks = (plan.tasks ?? []).map((task) => {
    if (task.id !== taskId) return task;
    const { priority: _p, urgent: _u, ...rest } = task;
    if (!priority) return rest;
    return { ...rest, priority, ...(priority === "urgent" ? { urgent: true } : {}) };
  });
  return { ...plan, tasks };
}

/** Freeze every task's current dates as the active baseline snapshot. */
export function saveBaselineSnapshot(plan: PlanDocument, name?: string): PlanDocument {
  const label = name?.trim() || `Baseline ${new Date().toISOString().slice(0, 10)}`;
  const { updatedData } = freezeProjectBaseline(plan, label);
  return updatedData as PlanDocument;
}

/** Active (non-deleted) project notes, pinned first then newest updated. */
export function activePlanNotes(plan: PlanDocument): NoteItem[] {
  return (plan.notes ?? [])
    .filter((note) => !note._deleted)
    .sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      const timeA = a.updatedAt || a.createdAt || "";
      const timeB = b.updatedAt || b.createdAt || "";
      return timeB.localeCompare(timeA);
    });
}

export function upsertPlanNote(
  plan: PlanDocument,
  note: Pick<NoteItem, "title" | "content"> & { id?: string; pinned?: boolean },
  now: Date = new Date(),
): { plan: PlanDocument; note: NoteItem } {
  const iso = now.toISOString();
  const existing = (plan.notes ?? []).filter((item) => !item._deleted);
  const target = note.id ? existing.find((item) => item.id === note.id) : undefined;
  const saved: NoteItem = target
    ? {
        ...target,
        title: note.title,
        content: note.content,
        ...(note.pinned !== undefined ? { pinned: note.pinned } : {}),
        updatedAt: iso,
      }
    : {
        id: note.id || `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        title: note.title || "Untitled note",
        content: note.content,
        pinned: Boolean(note.pinned),
        createdAt: iso,
        updatedAt: iso,
      };
  const nextNotes = target
    ? (plan.notes ?? []).map((item) => (item.id === saved.id ? saved : item))
    : [saved, ...(plan.notes ?? [])];
  return { plan: { ...plan, notes: nextNotes }, note: saved };
}

export function deletePlanNote(plan: PlanDocument, noteId: string): PlanDocument {
  return { ...plan, notes: (plan.notes ?? []).filter((note) => note.id !== noteId) };
}

/** Tasks eligible for Kanban status columns (real tasks, not MS Project WBS summary containers). */
export function boardTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((task) => !task._deleted && !isSummaryTask(task));
}
