import { Trans, useLingui } from "@lingui/react/macro";
import type { Task } from "@jantt/core";
import type { EvolvePersonOption } from "@rakazo/contracts";
import { Diamond, Flame, GanttChart, UserPlus } from "lucide-react";
import { PersonAvatar } from "../../GroupPeople";
import { findEvolvePerson } from "./evolve-people";
import {
  categoryMeta,
  KANBAN_STATUSES,
  normaliseTaskPriority,
  normaliseTaskStatus,
  setTaskPriority,
  setTaskProgress,
  setTaskStatus,
  TASK_PRIORITIES,
  taskDays,
  type KanbanStatus,
  type TaskPriority,
} from "./filters";
import { isSummaryTask, outlineDepth } from "./ms-project-plan";
import type { PlanDocument } from "./plan";

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

export function PlannerTasksView({
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

  if (tasks.length === 0) {
    return (
      <div
        className="grid flex-1 place-items-center bg-background p-6 text-center text-[13px] text-muted-foreground"
        data-testid="planner-tasks-view"
      >
        <Trans>No tasks match the current search or filters.</Trans>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      data-testid="planner-tasks-view"
    >
      {/* Desktop / tablet table */}
      <div className="hidden min-h-0 flex-1 overflow-auto md:block">
        <table className="w-full border-collapse text-left text-[12.5px]">
          <thead className="sticky top-0 z-10 border-b border-border bg-muted/80 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-xs">
            <tr>
              <th className="px-3 py-2">
                <Trans>Task</Trans>
              </th>
              <th className="w-36 px-2.5 py-2">
                <Trans>Category</Trans>
              </th>
              <th className="w-40 px-2.5 py-2">
                <Trans>Owner</Trans>
              </th>
              <th className="w-32 px-2.5 py-2">
                <Trans>Status</Trans>
              </th>
              <th className="w-28 px-2.5 py-2">
                <Trans>Priority</Trans>
              </th>
              <th className="w-44 px-2.5 py-2">
                <Trans>Dates</Trans>
              </th>
              <th className="w-32 px-2.5 py-2">
                <Trans>Progress</Trans>
              </th>
              <th className="w-10 px-2 py-2" aria-label={t`Open on Gantt`} />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {tasks.map((task) => {
              const summary = isSummaryTask(task);
              const depth = outlineDepth(task);
              const cat = categoryMeta(plan, task.category);
              const status = normaliseTaskStatus(task);
              const priority = normaliseTaskPriority(task) ?? "";
              const progress = progressPercent(task.progress);
              const critical = criticalTaskIds.has(task.id);
              const days = taskDays(task);
              const profile = task.assignee ? findEvolvePerson(people, task.assignee) : undefined;

              return (
                <tr
                  key={task.id}
                  className={
                    summary
                      ? "bg-muted/45 font-semibold"
                      : "transition-colors hover:bg-muted/25"
                  }
                >
                  <td className="px-3 py-2">
                    <div
                      className="flex items-center gap-1.5"
                      style={{ paddingLeft: `${depth * 14}px` }}
                    >
                      {task.milestone ? (
                        <Diamond className="size-3 shrink-0 text-primary" aria-label={t`Milestone`} />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onJumpToTask(task.id)}
                        className="truncate text-left text-foreground hover:text-primary"
                      >
                        {task.label}
                      </button>
                      {critical ? (
                        <Flame
                          className="size-3.5 shrink-0 text-destructive"
                          aria-label={t`Critical path`}
                        />
                      ) : null}
                    </div>
                  </td>

                  <td className="px-2.5 py-2">
                    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] font-medium text-foreground">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="truncate">{cat.label}</span>
                    </span>
                  </td>

                  <td className="px-2.5 py-2">
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={(event) =>
                        onOpenAssign(task.id, event.currentTarget.getBoundingClientRect())
                      }
                      className="flex max-w-full items-center gap-1.5 rounded-full py-0.5 pr-2 text-left text-[12px] text-foreground transition-colors hover:bg-muted disabled:pointer-events-none"
                    >
                      {task.assignee ? (
                        profile ? (
                          <PersonAvatar name={profile.name} image={profile.photo} size={22} />
                        ) : (
                          <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-muted text-[10px] font-semibold">
                            {initialsOf(task.assignee)}
                          </span>
                        )
                      ) : (
                        <span className="grid size-[22px] shrink-0 place-items-center rounded-full border border-dashed border-border text-muted-foreground">
                          <UserPlus className="size-3" />
                        </span>
                      )}
                      <span className="truncate text-muted-foreground">
                        {task.assignee || (readOnly ? t`Unassigned` : t`Assign`)}
                      </span>
                    </button>
                  </td>

                  <td className="px-2.5 py-2">
                    <select
                      disabled={readOnly}
                      aria-label={t`Status for ${task.label}`}
                      value={status}
                      onChange={(event) =>
                        onCommit(setTaskStatus(plan, task.id, event.target.value as KanbanStatus))
                      }
                      className="h-7 w-full rounded-full border border-border bg-background px-2 text-[11.5px] text-foreground outline-none focus:border-primary disabled:opacity-70"
                    >
                      {KANBAN_STATUSES.map((option) => (
                        <option key={option} value={option}>
                          {statusLabel(option)}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="px-2.5 py-2">
                    <select
                      disabled={readOnly}
                      aria-label={t`Priority for ${task.label}`}
                      value={priority}
                      onChange={(event) =>
                        onCommit(
                          setTaskPriority(
                            plan,
                            task.id,
                            (event.target.value || null) as TaskPriority | null,
                          ),
                        )
                      }
                      className="h-7 w-full rounded-full border border-border bg-background px-2 text-[11.5px] text-foreground outline-none focus:border-primary disabled:opacity-70"
                    >
                      <option value="">{t`None`}</option>
                      {TASK_PRIORITIES.map((option) => (
                        <option key={option} value={option}>
                          {priorityLabel(option)}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="whitespace-nowrap px-2.5 py-2 text-[11.5px] tabular-nums text-muted-foreground">
                    {task.start}
                    {task.end && task.end !== task.start ? ` → ${task.end}` : ""}
                    {days > 0 ? <span className="ml-1 text-[10.5px] opacity-75">({days}d)</span> : null}
                  </td>

                  <td className="px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        disabled={readOnly}
                        aria-label={t`Progress for ${task.label}`}
                        value={progress}
                        onChange={(event) =>
                          onCommit(setTaskProgress(plan, task.id, Number(event.target.value) / 100))
                        }
                        className="h-1.5 w-16 cursor-pointer accent-primary disabled:cursor-default"
                      />
                      <span className="w-8 text-right text-[11px] font-medium tabular-nums text-muted-foreground">
                        {progress}%
                      </span>
                    </div>
                  </td>

                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onJumpToTask(task.id)}
                      title={t`Jump to task on Gantt`}
                      aria-label={t`Jump to ${task.label} on Gantt`}
                      className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-primary"
                    >
                      <GanttChart className="size-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 md:hidden">
        {tasks.map((task) => {
          const summary = isSummaryTask(task);
          const cat = categoryMeta(plan, task.category);
          const status = normaliseTaskStatus(task);
          const priority = normaliseTaskPriority(task) ?? "";
          const progress = progressPercent(task.progress);
          const critical = criticalTaskIds.has(task.id);
          const profile = task.assignee ? findEvolvePerson(people, task.assignee) : undefined;

          return (
            <div
              key={task.id}
              className={`flex flex-col gap-2 rounded-xl border border-border p-3 ${
                summary ? "bg-muted/50" : "bg-card"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onJumpToTask(task.id)}
                  className={`text-left text-[13px] leading-snug text-foreground hover:text-primary ${
                    summary ? "font-semibold" : "font-medium"
                  }`}
                >
                  {task.label}
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {critical ? <Flame className="size-3.5 text-destructive" /> : null}
                  <button
                    type="button"
                    onClick={() => onJumpToTask(task.id)}
                    aria-label={t`Jump to ${task.label} on Gantt`}
                    className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-primary"
                  >
                    <GanttChart className="size-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="size-2 rounded-full" style={{ backgroundColor: cat.color }} />
                  {cat.label}
                </span>
                <span className="tabular-nums">
                  {task.start} → {task.end}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <select
                  disabled={readOnly}
                  aria-label={t`Status for ${task.label}`}
                  value={status}
                  onChange={(event) =>
                    onCommit(setTaskStatus(plan, task.id, event.target.value as KanbanStatus))
                  }
                  className="h-8 rounded-lg border border-border bg-background px-2 text-[12px] text-foreground"
                >
                  {KANBAN_STATUSES.map((option) => (
                    <option key={option} value={option}>
                      {statusLabel(option)}
                    </option>
                  ))}
                </select>

                <select
                  disabled={readOnly}
                  aria-label={t`Priority for ${task.label}`}
                  value={priority}
                  onChange={(event) =>
                    onCommit(
                      setTaskPriority(
                        plan,
                        task.id,
                        (event.target.value || null) as TaskPriority | null,
                      ),
                    )
                  }
                  className="h-8 rounded-lg border border-border bg-background px-2 text-[12px] text-foreground"
                >
                  <option value="">{t`None`}</option>
                  {TASK_PRIORITIES.map((option) => (
                    <option key={option} value={option}>
                      {priorityLabel(option)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={(event) =>
                    onOpenAssign(task.id, event.currentTarget.getBoundingClientRect())
                  }
                  className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground"
                >
                  {task.assignee ? (
                    profile ? (
                      <PersonAvatar name={profile.name} image={profile.photo} size={20} />
                    ) : (
                      <span className="grid size-5 place-items-center rounded-full bg-muted text-[9.5px] font-semibold">
                        {initialsOf(task.assignee)}
                      </span>
                    )
                  ) : (
                    <UserPlus className="size-3.5" />
                  )}
                  <span className="truncate">{task.assignee || t`Assign owner`}</span>
                </button>

                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    disabled={readOnly}
                    aria-label={t`Progress for ${task.label}`}
                    value={progress}
                    onChange={(event) =>
                      onCommit(setTaskProgress(plan, task.id, Number(event.target.value) / 100))
                    }
                    className="h-1.5 w-20 accent-primary"
                  />
                  <span className="w-8 text-right text-[11px] font-medium tabular-nums text-muted-foreground">
                    {progress}%
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
