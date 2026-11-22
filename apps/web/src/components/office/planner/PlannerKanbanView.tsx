import { Trans, useLingui } from "@lingui/react/macro";
import type { Task } from "@jantt/core";
import type { EvolvePersonOption } from "@rakazo/contracts";
import {
  ArrowRight,
  Calendar,
  Diamond,
  Flame,
  GanttChart,
  UserPlus,
} from "lucide-react";
import { useMemo, useState } from "react";
import { PersonAvatar } from "../../GroupPeople";
import { findEvolvePerson } from "./evolve-people";
import {
  boardTasks,
  categoryMeta,
  KANBAN_STATUSES,
  normaliseTaskPriority,
  normaliseTaskStatus,
  setTaskStatus,
  taskDays,
  type KanbanStatus,
  type TaskPriority,
} from "./filters";
import type { PlanDocument } from "./plan";

type SortBy = "order" | "start" | "priority" | "progress";

const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const COLUMN_ACCENT: Record<KanbanStatus, string> = {
  "not-started": "bg-muted-foreground/50",
  "in-progress": "bg-primary",
  blocked: "bg-destructive",
  "in-review": "bg-amber-500",
  completed: "bg-emerald-600 dark:bg-emerald-500",
};

const PRIORITY_PILL: Record<TaskPriority, string> = {
  urgent: "bg-destructive/15 text-destructive",
  high: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  medium: "bg-foreground/[0.07] text-muted-foreground",
  low: "bg-foreground/[0.05] text-muted-foreground",
};

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

function progressPercent(progress: number | null | undefined): number {
  const raw = typeof progress === "number" ? progress : 0;
  const pct = raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export function PlannerKanbanView({
  plan,
  tasks,
  criticalTaskIds,
  people,
  readOnly,
  onCommit,
  onOpenAssign,
  onJumpToTask,
}: {
  plan: PlanDocument;
  tasks: readonly Task[];
  criticalTaskIds: ReadonlySet<string>;
  people: readonly EvolvePersonOption[];
  readOnly: boolean;
  onCommit: (next: PlanDocument) => void;
  onOpenAssign: (taskId: string, anchor: DOMRect) => void;
  onJumpToTask: (taskId: string) => void;
}) {
  const { t } = useLingui();
  const [sortBy, setSortBy] = useState<SortBy>("order");
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<KanbanStatus | null>(null);

  const visibleTasks = useMemo(() => {
    const items = boardTasks(tasks);
    if (sortBy === "order") return items;
    return [...items].sort((a, b) => {
      if (sortBy === "start") return (a.start ?? "").localeCompare(b.start ?? "");
      if (sortBy === "priority") {
        const pa = normaliseTaskPriority(a);
        const pb = normaliseTaskPriority(b);
        return (pa ? PRIORITY_RANK[pa] : 9) - (pb ? PRIORITY_RANK[pb] : 9);
      }
      return progressPercent(b.progress) - progressPercent(a.progress);
    });
  }, [tasks, sortBy]);

  const grouped = useMemo(() => {
    const map = new Map<KanbanStatus, Task[]>(KANBAN_STATUSES.map((status) => [status, []]));
    for (const task of visibleTasks) {
      map.get(normaliseTaskStatus(task))?.push(task);
    }
    return map;
  }, [visibleTasks]);

  const statusLabel = (status: KanbanStatus) => {
    switch (status) {
      case "not-started":
        return t`To Do`;
      case "in-progress":
        return t`In Progress`;
      case "blocked":
        return t`Blocked`;
      case "in-review":
        return t`In Review`;
      case "completed":
        return t`Completed`;
    }
  };

  const priorityLabel = (priority: TaskPriority) => {
    switch (priority) {
      case "urgent":
        return t`Urgent`;
      case "high":
        return t`High`;
      case "medium":
        return t`Medium`;
      case "low":
        return t`Low`;
    }
  };

  const moveTask = (taskId: string, status: KanbanStatus) => {
    if (readOnly) return;
    onCommit(setTaskStatus(plan, taskId, status));
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/20"
      data-testid="planner-kanban-view"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-background/70 px-3 py-1.5 text-[12px]">
        <span className="text-muted-foreground">
          <Trans>
            Showing {visibleTasks.length} work items (summary stages stay on the Gantt timeline)
          </Trans>
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">
            <Trans>Sort</Trans>
          </span>
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as SortBy)}
            aria-label={t`Sort board`}
            className="h-7 rounded-full border border-foreground/[0.08] bg-background px-2.5 text-[12px] text-foreground outline-none focus:border-primary"
          >
            <option value="order">{t`Programme order`}</option>
            <option value="start">{t`Start date`}</option>
            <option value="priority">{t`Priority`}</option>
            <option value="progress">{t`Progress`}</option>
          </select>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
        {KANBAN_STATUSES.map((status) => {
          const items = grouped.get(status) ?? [];
          const isDropTarget = dropColumn === status && dragTaskId !== null;
          return (
            <section
              key={status}
              data-testid={`kanban-col-${status}`}
              onDragOver={(event) => {
                if (readOnly || !dragTaskId) return;
                event.preventDefault();
                if (dropColumn !== status) setDropColumn(status);
              }}
              onDragLeave={() => {
                if (dropColumn === status) setDropColumn(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const droppedId = event.dataTransfer.getData("text/plain") || dragTaskId;
                setDragTaskId(null);
                setDropColumn(null);
                if (droppedId) moveTask(droppedId, status);
              }}
              className={`flex min-h-0 w-[268px] shrink-0 flex-col rounded-xl border transition-colors sm:w-[280px] ${
                isDropTarget
                  ? "border-primary bg-primary/5"
                  : "border-border/80 bg-background/80"
              }`}
            >
              <header className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`size-2 rounded-full ${COLUMN_ACCENT[status]}`}
                    aria-hidden="true"
                  />
                  <h3 className="text-[12.5px] font-semibold text-foreground">
                    {statusLabel(status)}
                  </h3>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                  {items.length}
                </span>
              </header>

              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
                {items.length === 0 ? (
                  <div className="grid min-h-[72px] place-items-center rounded-lg border border-dashed border-border/70 px-3 text-center text-[11.5px] text-muted-foreground">
                    {readOnly ? <Trans>No tasks</Trans> : <Trans>Drop a task here</Trans>}
                  </div>
                ) : (
                  items.map((task) => {
                    const cat = categoryMeta(plan, task.category);
                    const priority = normaliseTaskPriority(task);
                    const critical = criticalTaskIds.has(task.id);
                    const progress = progressPercent(task.progress);
                    const days = taskDays(task);
                    const profile = task.assignee
                      ? findEvolvePerson(people, task.assignee)
                      : undefined;

                    return (
                      <article
                        key={task.id}
                        draggable={!readOnly}
                        onDragStart={(event) => {
                          if (readOnly) return;
                          setDragTaskId(task.id);
                          event.dataTransfer.setData("text/plain", task.id);
                          event.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => {
                          setDragTaskId(null);
                          setDropColumn(null);
                        }}
                        className={`group flex flex-col gap-2 rounded-lg border border-border/80 bg-card p-2.5 shadow-2xs transition-colors hover:border-primary/40 ${
                          dragTaskId === task.id ? "opacity-50" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ backgroundColor: cat.color }}
                              title={cat.label}
                            />
                            <span className="truncate text-[11px] font-medium text-muted-foreground">
                              {cat.label}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {task.milestone ? (
                              <span
                                className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary"
                                title={t`Milestone`}
                              >
                                <Diamond className="size-2.5" />
                              </span>
                            ) : null}
                            {critical ? (
                              <span
                                className="inline-flex items-center gap-0.5 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold text-destructive"
                                title={t`On critical path`}
                              >
                                <Flame className="size-2.5" />
                                <Trans>Critical</Trans>
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => onJumpToTask(task.id)}
                          className="text-left text-[13px] font-medium leading-snug text-foreground hover:text-primary"
                          title={t`Show on Gantt timeline`}
                        >
                          {task.label}
                        </button>

                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          {priority ? (
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY_PILL[priority]}`}
                            >
                              {priorityLabel(priority)}
                            </span>
                          ) : null}
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <Calendar className="size-3 opacity-70" />
                            {task.start}
                            {days > 1 ? ` · ${days}d` : ""}
                          </span>
                        </div>

                        {/* Progress bar */}
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${progress}%`,
                                backgroundColor: critical ? "var(--destructive)" : cat.color,
                              }}
                            />
                          </div>
                          <span className="w-8 text-right text-[10.5px] font-medium tabular-nums text-muted-foreground">
                            {progress}%
                          </span>
                        </div>

                        {/* Footer: Owner + quick status move + jump to Gantt */}
                        <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={(event) =>
                              onOpenAssign(task.id, event.currentTarget.getBoundingClientRect())
                            }
                            className="flex min-w-0 items-center gap-1.5 rounded-full py-0.5 pr-1.5 text-left text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none"
                            title={
                              task.assignee ? t`Owner: ${task.assignee}` : t`Assign owner`
                            }
                          >
                            {task.assignee ? (
                              profile ? (
                                <PersonAvatar name={profile.name} image={profile.photo} size={20} />
                              ) : (
                                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[9.5px] font-semibold text-foreground">
                                  {initialsOf(task.assignee)}
                                </span>
                              )
                            ) : (
                              <span className="grid size-5 shrink-0 place-items-center rounded-full border border-dashed border-border text-muted-foreground">
                                <UserPlus className="size-3" />
                              </span>
                            )}
                            <span className="truncate">
                              {task.assignee || (readOnly ? t`Unassigned` : t`Assign`)}
                            </span>
                          </button>

                          <div className="flex shrink-0 items-center gap-1">
                            {!readOnly ? (
                              <label className="relative inline-flex items-center">
                                <ArrowRight
                                  className="pointer-events-none absolute left-1.5 size-3 text-muted-foreground"
                                  aria-hidden="true"
                                />
                                <select
                                  aria-label={t`Move ${task.label} to status`}
                                  value={status}
                                  onChange={(event) =>
                                    moveTask(task.id, event.target.value as KanbanStatus)
                                  }
                                  className="h-6 rounded-full border border-border bg-background pl-5 pr-2 text-[10.5px] text-foreground outline-none focus:border-primary"
                                >
                                  {KANBAN_STATUSES.map((option) => (
                                    <option key={option} value={option}>
                                      {statusLabel(option)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ) : null}

                            <button
                              type="button"
                              onClick={() => onJumpToTask(task.id)}
                              title={t`Jump to task on Gantt`}
                              aria-label={t`Jump to ${task.label} on Gantt`}
                              className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-primary"
                            >
                              <GanttChart className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
