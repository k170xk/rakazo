import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Jantt } from "@jantt/react";
import { toast } from "@rakazo/ui-web";
import {
  auditScheduleIntegrity,
  calculateCriticalPath,
  type Task,
  type ViewportOptions,
} from "@jantt/core";
import "@jantt/core/theme.css";
import "./planner-theme.css";
import { useMedia } from "../../../lib/pages";
import { isSummaryTask, outlineDepth } from "./ms-project-plan";
import { linkTasks, programmeWindow, type PlanDocument } from "./plan";
import { prefersDarkText } from "./bar-contrast";
import { fitTimelineHeader } from "./header-fit";
import type { EvolvePersonOption } from "@rakazo/contracts";
import { EvolveAssigneePicker } from "./EvolveAssigneePicker";
import { withAssignedPeople, withDirectoryPeople } from "./evolve-people";
import { withCategories, type PlanCategory } from "./categories";
import { NewCategoryControl } from "./NewCategoryControl";
import { ASSIGN_ATTR, decorateAssignees, type AssigneeLabels } from "./assignee-slots";
import { QuickAssignPopover } from "./QuickAssignPopover";
import {
  activePlanNotes,
  boardTasks,
  createNewTask,
  EMPTY_FILTERS,
  filterPlanTasks,
  hasActiveFilters,
  saveBaselineSnapshot,
  type PlanFilters,
  type PlanViewMode,
} from "./filters";
import { PlannerToolbar } from "./PlannerToolbar";
import { PlannerKanbanView } from "./PlannerKanbanView";
import { PlannerTasksView } from "./PlannerTasksView";
import { PlannerHealthView } from "./PlannerHealthView";
import { PlannerNotesView } from "./PlannerNotesView";
import { PlannerJsonDialog } from "./PlannerJsonDialog";

export type PlannerWorkbenchProps = {
  plan: PlanDocument;
  readOnly?: boolean;
  selectedTaskId?: string | null;
  /** Tasks to point out, such as the ones the assistant just changed. */
  highlightTaskIds?: ReadonlySet<string>;
  /** The chart view to start from; the studio keeps it so a newly loaded version opens the same way. */
  initialView?: ViewportOptions;
  onViewChange?: (view: ViewportOptions) => void;
  /** Where the chart was scrolled; kept by the studio so a newly loaded version stays in place. */
  scroll?: { current: ChartScroll | null };
  /** Evolve CV profiles to assign tasks to; without them the owner box stays free text. */
  people?: readonly EvolvePersonOption[];
  onCommit: (plan: PlanDocument) => void;
  onSelectTask?: (taskId: string | null) => void;
};

const NO_HIGHLIGHTS: ReadonlySet<string> = new Set();
const NO_PEOPLE: readonly EvolvePersonOption[] = [];

export type ChartScroll = { left: number; top: number };

/** Jantt scrolls itself (to today) after mounting, so a restored position is applied for a moment. */
const RESTORE_SCROLL_MS = 1200;

const INDENT_PX = 14;

/** On <body> while a task bar is held; planner-theme.css hides Jantt's hover card meanwhile. */
const DRAGGING_CLASS = "planner-dragging-task";

const KEPT_VIEW_KEYS = [
  "scale",
  "dayWidth",
  "rowHeight",
  "rowHeightMode",
  "showCriticalPath",
  "showBaselines",
  "autoCascade",
  "linkRouting",
  "labelWidth",
] as const satisfies readonly (keyof ViewportOptions)[];

/** The task on the row under the pointer: its name in the task list, or the same height in the chart. */
function rowTaskIdAt(root: HTMLElement, hit: Element, clientY: number): string | null {
  const labelRow = hit.closest<HTMLElement>(".jantt-label-row[data-row-id]");
  if (labelRow) return labelRow.dataset.rowId ?? null;
  if (!hit.closest(".jantt-timeline-area")) return null;
  for (const row of root.querySelectorAll<HTMLElement>(".jantt-label-row[data-row-id]")) {
    const rect = row.getBoundingClientRect();
    if (clientY >= rect.top && clientY < rect.bottom) return row.dataset.rowId ?? null;
  }
  return null;
}

/** The person's chart choices from a Jantt viewport change; same object when nothing changed. */
function keptView(current: ViewportOptions, next: ViewportOptions): ViewportOptions {
  let changed = false;
  const kept: ViewportOptions = { ...current };
  for (const key of KEPT_VIEW_KEYS) {
    const value = next[key];
    if (value === undefined || current[key] === value) continue;
    (kept as Record<string, unknown>)[key] = value;
    changed = true;
  }
  return changed ? kept : current;
}

/** Mark summary / outline rows and optional filter dimming after Jantt paints. */
function syncOutlineClasses(
  root: HTMLElement,
  plan: PlanDocument,
  highlights: ReadonlySet<string>,
  filterMatchedIds: ReadonlySet<string> | null,
) {
  const byId = new Map((plan.tasks ?? []).map((task) => [task.id, task]));
  for (const row of root.querySelectorAll<HTMLElement>(".jantt-label-row[data-row-id]")) {
    const id = row.getAttribute("data-row-id");
    if (!id) continue;
    const task = byId.get(id);
    const depth = task ? outlineDepth(task) : 0;
    const summary = task ? isSummaryTask(task) : false;
    row.classList.toggle("is-summary", summary);
    row.classList.toggle("is-ai-changed", highlights.has(id));
    row.classList.toggle("is-outline-child", depth > 0);
    row.classList.toggle("is-filter-muted", filterMatchedIds !== null && !filterMatchedIds.has(id));
    row.classList.toggle("is-filter-match", filterMatchedIds !== null && filterMatchedIds.has(id));
    // Only write when it differs: the observer watches style changes, so a same-value write would loop.
    const indent = `${depth * INDENT_PX}px`;
    if (row.style.getPropertyValue("--outline-indent") !== indent) {
      row.style.setProperty("--outline-indent", indent);
    }
  }
  for (const bar of root.querySelectorAll<HTMLElement>(
    ".jantt-task-bar[data-task-id], .jantt-milestone[data-task-id]",
  )) {
    const id = bar.getAttribute("data-task-id");
    if (!id) continue;
    const task = byId.get(id);
    bar.classList.toggle("is-summary", task ? isSummaryTask(task) : false);
    bar.classList.toggle("is-ai-changed", highlights.has(id));
    bar.classList.toggle("is-light-bar", prefersDarkText(bar.style.background || bar.style.backgroundColor));
    bar.classList.toggle("is-filter-muted", filterMatchedIds !== null && !filterMatchedIds.has(id));
    bar.classList.toggle("is-filter-match", filterMatchedIds !== null && filterMatchedIds.has(id));
  }
  for (const gridRow of root.querySelectorAll<HTMLElement>(".jantt-grid-row")) {
    // Grid rows are positional; match by index against label rows when possible.
    gridRow.classList.remove("is-summary");
  }
  const labels = [...root.querySelectorAll<HTMLElement>(".jantt-label-row[data-row-id]")];
  const grids = [...root.querySelectorAll<HTMLElement>(".jantt-grid-row")];
  for (let i = 0; i < Math.min(labels.length, grids.length); i++) {
    if (labels[i]?.classList.contains("is-summary")) grids[i]?.classList.add("is-summary");
  }
}

/**
 * Project Programme workbench: Evolve-branded view/action chrome over Jantt's Gantt engine,
 * plus Kanban, Tasks, Health & PM audit, Project Notes, and validated JSON views.
 */
export function PlannerWorkbench({
  plan,
  readOnly = false,
  highlightTaskIds = NO_HIGHLIGHTS,
  initialView,
  onViewChange,
  scroll,
  people = NO_PEOPLE,
  onCommit,
  onSelectTask,
}: PlannerWorkbenchProps) {
  const { t } = useLingui();
  const compact = useMedia("(max-width: 768px), (pointer: coarse)");
  const ganttRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<PlanViewMode>("gantt");
  const [filters, setFilters] = useState<PlanFilters>(EMPTY_FILTERS);
  const [jsonOpen, setJsonOpen] = useState(false);

  // Jantt re-applies the viewport prop on every data update, so keep the person's own scale,
  // zoom and toggles here or each edit would snap the chart back to the defaults.
  const [view, setView] = useState<ViewportOptions>(() => initialView ?? {});
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  useEffect(() => {
    onViewChangeRef.current?.(view);
  }, [view]);

  const patchViewport = useCallback((patch: Partial<ViewportOptions>) => {
    setView((current) => ({ ...current, ...patch }));
  }, []);

  const chartWindow = useMemo(() => programmeWindow(plan.tasks ?? []), [plan.tasks]);
  const defaultScale = useMemo<"month" | "quarter" | "year">(() => {
    const list = plan.tasks ?? [];
    let minStart = "";
    let maxEnd = "";
    for (const task of list) {
      if (task.start && (!minStart || task.start < minStart)) minStart = task.start;
      if (task.end && (!maxEnd || task.end > maxEnd)) maxEnd = task.end;
    }
    if (!minStart || !maxEnd) return "month";
    const spanDays = Math.round((Date.parse(maxEnd) - Date.parse(minStart)) / 86_400_000);
    if (spanDays > 1095) return "year";
    if (spanDays > 540) return "quarter";
    return "month";
  }, [plan.tasks]);
  const viewport = useMemo<ViewportOptions>(
    () => ({
      scale: defaultScale,
      // Fit mode sets overflow-y:hidden so large programmes cannot scroll — use fixed rows.
      rowHeightMode: "custom",
      // Jantt's slider minimum; its bars bottom out at 18px there, still enough for the 12px task text.
      // Touch screens keep taller rows so each task stays easy to tap.
      rowHeight: compact ? 40 : 26,
      // Wide enough for typical construction task names without ellipsis; people can still drag it.
      ...(compact ? {} : { labelWidth: 420 }),
      showCriticalPath: true,
      autoCascade: true,
      linkRouting: "orthogonal",
      ...view,
      ...chartWindow,
    }),
    [compact, defaultScale, view, chartWindow],
  );

  const tasks = plan.tasks ?? [];
  const workItems = useMemo(() => boardTasks(tasks), [tasks]);
  const defaultGapDays =
    typeof plan.meta?.defaultGapDays === "number" ? plan.meta.defaultGapDays : 0;
  const critical = useMemo(
    () => calculateCriticalPath(tasks, { defaultGapDays }),
    [tasks, defaultGapDays],
  );
  const healthGrade = useMemo(
    () => (workItems.length > 0 ? auditScheduleIntegrity(workItems, critical).grade : null),
    [workItems, critical],
  );
  const notesCount = useMemo(() => activePlanNotes(plan).length, [plan]);
  const filtersActive = hasActiveFilters(filters);
  const filteredTasks = useMemo(
    () => filterPlanTasks(plan, filters, critical.criticalTaskIds),
    [plan, filters, critical.criticalTaskIds],
  );
  const filterMatchedIds = useMemo(
    () => (filtersActive ? new Set(filteredTasks.map((task) => task.id)) : null),
    [filtersActive, filteredTasks],
  );

  const chartData = useMemo(() => withDirectoryPeople(plan, people), [plan, people]);
  const newCategories = useRef(new Map<string, PlanCategory>());
  const commit = useCallback(
    (next: PlanDocument) =>
      onCommit(withAssignedPeople(withCategories(next, newCategories.current), people)),
    [onCommit, people],
  );

  const planRef = useRef(plan);
  planRef.current = plan;
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const loopMessage = t`That link would make the programme loop back on itself.`;
  const loopMessageRef = useRef(loopMessage);
  loopMessageRef.current = loopMessage;

  // Jantt only links when the wire is dropped exactly on the other bar; also accept anywhere on
  // that task's row or its name in the task list, which is where people tend to let go.
  useEffect(() => {
    const root = ganttRef.current;
    if (!root || readOnly) return;
    let fromId: string | null = null;
    const onDown = (event: PointerEvent) => {
      const port = (event.target as Element | null)?.closest?.(".jantt-link-port-right");
      const id = port?.closest<HTMLElement>("[data-task-id]")?.dataset.taskId;
      if (!id) return;
      fromId = id;
      root.classList.add("is-linking");
    };
    const onUp = (event: PointerEvent) => {
      if (!fromId) return;
      const source = fromId;
      fromId = null;
      root.classList.remove("is-linking");
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      if (!hit || !root.contains(hit) || hit.closest("[data-task-id]")) return;
      const targetId = rowTaskIdAt(root, hit, event.clientY);
      if (!targetId) return;
      const result = linkTasks(planRef.current, source, targetId);
      if (!result) return;
      if ("error" in result) toast.error(loopMessageRef.current);
      else commitRef.current(result.plan);
    };
    root.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    return () => {
      root.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  }, [readOnly]);

  useEffect(() => {
    const root = ganttRef.current;
    if (!root || !scroll) return;
    const saved = scroll.current;
    const until = Date.now() + RESTORE_SCROLL_MS;
    let restoring = saved !== null;
    let frame = 0;
    const restore = () => {
      const body = root.querySelector<HTMLElement>(".jantt-body-wrap");
      if (body && saved) {
        body.scrollLeft = saved.left;
        body.scrollTop = saved.top;
      }
      if (Date.now() < until) frame = requestAnimationFrame(restore);
      else restoring = false;
    };
    if (saved) frame = requestAnimationFrame(restore);
    const stopRestoring = () => {
      restoring = false;
      cancelAnimationFrame(frame);
    };
    const onScroll = (event: Event) => {
      const body = event.target as HTMLElement;
      if (restoring || !body.classList?.contains("jantt-body-wrap")) return;
      scroll.current = { left: body.scrollLeft, top: body.scrollTop };
    };
    // A person scrolling or dragging takes over from the restore straight away.
    root.addEventListener("wheel", stopRestoring, { passive: true });
    root.addEventListener("pointerdown", stopRestoring);
    root.addEventListener("scroll", onScroll, true);
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener("wheel", stopRestoring);
      root.removeEventListener("pointerdown", stopRestoring);
      root.removeEventListener("scroll", onScroll, true);
    };
  }, [scroll]);

  const [assigning, setAssigning] = useState<{ taskId: string; anchor: DOMRect } | null>(null);
  const assigneeLabels = useMemo<AssigneeLabels>(
    () => ({
      add: t`Add an owner`,
      evolve: (name, jobTitle) => (jobTitle ? t`Owner: ${name} · ${jobTitle}` : t`Owner: ${name}`),
      external: (name) => t`Owner: ${name} (not in Evolve)`,
    }),
    [t],
  );
  const planAssignees = useMemo(
    () => [...new Set(tasks.map((task) => task.assignee?.trim() ?? "").filter(Boolean))],
    [tasks],
  );

  // The avatar and plus button sit inside Jantt's task row, whose own click opens the drawer.
  useEffect(() => {
    const root = ganttRef.current;
    if (!root || readOnly) return;
    const open = (event: Event) => {
      const target = (event.target as Element | null)?.closest?.<HTMLElement>(`[${ASSIGN_ATTR}]`);
      const taskId = target?.getAttribute(ASSIGN_ATTR);
      if (!target || !taskId) return false;
      event.preventDefault();
      event.stopPropagation();
      setAssigning((current) =>
        current?.taskId === taskId ? null : { taskId, anchor: target.getBoundingClientRect() },
      );
      return true;
    };
    const onClick = (event: MouseEvent) => void open(event);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") open(event);
    };
    root.addEventListener("click", onClick, true);
    root.addEventListener("keydown", onKeyDown, true);
    return () => {
      root.removeEventListener("click", onClick, true);
      root.removeEventListener("keydown", onKeyDown, true);
    };
  }, [readOnly]);

  const assignTask = (taskId: string, name: string | null) => {
    setAssigning(null);
    const nextTasks = tasks.map((task) => {
      if (task.id !== taskId) return task;
      const { assignee: _old, ...rest } = task;
      return name ? { ...rest, assignee: name } : rest;
    });
    commit({ ...plan, tasks: nextTasks });
  };

  // Jantt rebuilds every bar on each pointer move, and opens its hover card each time the pointer
  // "enters" a rebuilt bar; the card is appended to <body>, so the flag lives there.
  useEffect(() => {
    const root = ganttRef.current;
    if (!root || readOnly) return;
    const stop = () => document.body.classList.remove(DRAGGING_CLASS);
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const bar = (event.target as Element | null)?.closest?.(".jantt-task-bar, .jantt-milestone");
      if (!bar || !root.contains(bar)) return;
      document.body.classList.add(DRAGGING_CLASS);
    };
    root.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", stop, true);
    window.addEventListener("pointercancel", stop, true);
    return () => {
      stop();
      root.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", stop, true);
      window.removeEventListener("pointercancel", stop, true);
    };
  }, [readOnly]);

  useEffect(() => {
    const root = ganttRef.current;
    if (!root) return;
    const watch = { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] };
    // Runs in the observer's microtask, before the browser paints Jantt's new rows, so a drag never
    // shows a frame without avatars, outline styles or bar text colour. Our own writes are not observed.
    const observer = new MutationObserver(() => apply());
    const apply = () => {
      observer.disconnect();
      syncOutlineClasses(root, plan, highlightTaskIds, filterMatchedIds);
      decorateAssignees(root, plan, people, !readOnly, assigneeLabels);
      fitTimelineHeader(root);
      // Style changes cover a bar recoloured in place (category change) without a re-mount.
      observer.observe(root, watch);
    };
    apply();
    return () => observer.disconnect();
  }, [plan, highlightTaskIds, filterMatchedIds, people, readOnly, assigneeLabels]);

  const handleJumpToday = useCallback(() => {
    const root = ganttRef.current;
    if (!root) return;
    const body = root.querySelector<HTMLElement>(".jantt-body-wrap");
    const todayLine = root.querySelector<HTMLElement>(".jantt-today-line");
    if (!body || !todayLine) {
      toast.info(t`Today is outside this programme's date range.`);
      return;
    }
    const lineRect = todayLine.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const targetLeft = body.scrollLeft + (lineRect.left - bodyRect.left) - body.clientWidth / 3;
    body.scrollTo({ left: Math.max(0, targetLeft), behavior: "smooth" });
  }, [t]);

  const handleAddTask = useCallback(() => {
    if (readOnly) return;
    if (viewMode === "gantt") {
      const root = ganttRef.current;
      const trigger =
        root?.querySelector<HTMLElement>(".jantt-add-task-btn") ??
        root?.querySelector<HTMLElement>(".jantt-add-task-row");
      if (trigger) {
        trigger.click();
        return;
      }
    }
    const created = createNewTask(planRef.current, { label: t`New task` });
    commitRef.current(created.plan);
    onSelectTask?.(created.task.id);
    toast.success(t`Added "${created.task.label}"`);
  }, [readOnly, viewMode, t, onSelectTask]);

  const handleSaveBaseline = useCallback(() => {
    if (readOnly) return;
    const label = `Baseline ${new Date().toISOString().slice(0, 10)}`;
    const nextPlan = saveBaselineSnapshot(planRef.current, label);
    commitRef.current(nextPlan);
    setView((current) => ({ ...current, showBaselines: true }));
    toast.success(t`Saved baseline snapshot (${label})`);
  }, [readOnly, t]);

  const handleJumpToTask = useCallback(
    (taskId: string) => {
      setViewMode("gantt");
      onSelectTask?.(taskId);
      requestAnimationFrame(() => {
        const root = ganttRef.current;
        if (!root) return;
        const row = root.querySelector<HTMLElement>(`.jantt-label-row[data-row-id="${CSS.escape(taskId)}"]`);
        row?.scrollIntoView({ block: "center", behavior: "smooth" });
        const bar = root.querySelector<HTMLElement>(
          `.jantt-task-bar[data-task-id="${CSS.escape(taskId)}"], .jantt-milestone[data-task-id="${CSS.escape(taskId)}"]`,
        );
        const body = root.querySelector<HTMLElement>(".jantt-body-wrap");
        if (bar && body) {
          const barRect = bar.getBoundingClientRect();
          const bodyRect = body.getBoundingClientRect();
          const targetLeft = body.scrollLeft + (barRect.left - bodyRect.left) - body.clientWidth / 3;
          body.scrollTo({ left: Math.max(0, targetLeft), behavior: "smooth" });
        }
      });
    },
    [onSelectTask],
  );

  const openAssignForTask = useCallback(
    (taskId: string, anchor: DOMRect) => {
      if (readOnly) return;
      setAssigning((current) => (current?.taskId === taskId ? null : { taskId, anchor }));
    },
    [readOnly],
  );

  const assigningTask = assigning ? tasks.find((task) => task.id === assigning.taskId) : undefined;

  return (
    <div
      className="planner-workbench size-full min-h-0"
      data-testid="planner-workbench"
    >
      <PlannerToolbar
        plan={plan}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        viewport={viewport}
        onViewportPatch={patchViewport}
        filters={filters}
        onFiltersChange={setFilters}
        totalTasks={tasks.length}
        matchingTasks={filteredTasks.length}
        criticalCount={critical.criticalTaskIds.size}
        healthGrade={healthGrade}
        notesCount={notesCount}
        assignees={planAssignees}
        readOnly={readOnly}
        onAddTask={handleAddTask}
        onJumpToday={handleJumpToday}
        onSaveBaseline={handleSaveBaseline}
        onOpenJson={() => setJsonOpen(true)}
      />

      {!readOnly && people.length ? <EvolveAssigneePicker people={people} /> : null}
      {assigning && assigningTask && !readOnly ? (
        <QuickAssignPopover
          anchor={assigning.anchor}
          taskLabel={assigningTask.label ?? ""}
          current={assigningTask.assignee ?? ""}
          people={people}
          planAssignees={planAssignees}
          onPick={(name) => assignTask(assigning.taskId, name)}
          onClose={() => setAssigning(null)}
        />
      ) : null}
      {readOnly ? null : (
        <NewCategoryControl
          categories={plan.categories ?? {}}
          onCreate={(key, category) => newCategories.current.set(key, category)}
        />
      )}

      {/* Keep Jantt mounted so scroll, link wiring, and tab switching stay instant and lossless. */}
      <div
        ref={ganttRef}
        className={viewMode === "gantt" ? "flex min-h-0 flex-1 flex-col" : "hidden"}
      >
        <Jantt
          data={chartData}
          readOnly={readOnly}
          themeClassName="planner-jantt-theme"
          className="size-full"
          viewport={viewport}
          onViewportChange={(next) => setView((current) => keptView(current, next))}
          isMobile={compact}
          disableDragOnTouch={compact}
          onCommit={(next) => commit(next as PlanDocument)}
          onError={(error: Error) =>
            toast.error(/circular/i.test(error.message) ? loopMessage : error.message)
          }
          onTaskClick={(task: Task) => onSelectTask?.(task.id)}
          onTaskDelete={() => onSelectTask?.(null)}
        />
      </div>

      {viewMode === "kanban" ? (
        <PlannerKanbanView
          plan={plan}
          tasks={filteredTasks}
          criticalTaskIds={critical.criticalTaskIds}
          people={people}
          readOnly={readOnly}
          onCommit={commit}
          onOpenAssign={openAssignForTask}
          onJumpToTask={handleJumpToTask}
        />
      ) : null}

      {viewMode === "tasks" ? (
        <PlannerTasksView
          plan={plan}
          tasks={filteredTasks}
          criticalTaskIds={critical.criticalTaskIds}
          people={people}
          readOnly={readOnly}
          onCommit={commit}
          onOpenAssign={openAssignForTask}
          onJumpToTask={handleJumpToTask}
        />
      ) : null}

      {viewMode === "health" ? (
        <PlannerHealthView
          plan={plan}
          critical={critical}
          readOnly={readOnly}
          onSaveBaseline={handleSaveBaseline}
          onJumpToTask={handleJumpToTask}
        />
      ) : null}

      {viewMode === "notes" ? (
        <PlannerNotesView plan={plan} readOnly={readOnly} onCommit={commit} />
      ) : null}

      <PlannerJsonDialog
        open={jsonOpen}
        plan={plan}
        readOnly={readOnly}
        onClose={() => setJsonOpen(false)}
        onApply={commit}
      />
    </div>
  );
}
