import { useEffect, useMemo, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Jantt } from "@jantt/react";
import { toast } from "@rakazo/ui-web";
import type { Task, ViewportOptions } from "@jantt/core";
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

const KEPT_VIEW_KEYS = [
  "scale",
  "dayWidth",
  "rowHeight",
  "rowHeightMode",
  "showCriticalPath",
  "showBaselines",
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

/** Mark summary / outline rows after Jantt paints (it has no built-in summary style). */
function syncOutlineClasses(root: HTMLElement, plan: PlanDocument, highlights: ReadonlySet<string>) {
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
    // Only write when it differs: the observer watches style changes, so a same-value write would loop.
    const indent = `${depth * INDENT_PX}px`;
    if (row.style.getPropertyValue("--outline-indent") !== indent) {
      row.style.setProperty("--outline-indent", indent);
    }
  }
  for (const bar of root.querySelectorAll<HTMLElement>(".jantt-task-bar[data-task-id], .jantt-milestone[data-task-id]")) {
    const id = bar.getAttribute("data-task-id");
    if (!id) continue;
    const task = byId.get(id);
    bar.classList.toggle("is-summary", task ? isSummaryTask(task) : false);
    bar.classList.toggle("is-ai-changed", highlights.has(id));
    bar.classList.toggle("is-light-bar", prefersDarkText(bar.style.background || bar.style.backgroundColor));
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
 * The Gantt chart for Project Planner Studio. Theme CSS maps Jantt variables onto Evolve tokens
 * and keeps the toolbar on one scrollable row on laptop and phone widths.
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
  const rootRef = useRef<HTMLDivElement>(null);
  // Jantt re-applies the viewport prop on every data update, so keep the person's own scale,
  // zoom and toggles here or each edit would snap the chart back to the defaults.
  const [view, setView] = useState<ViewportOptions>(() => initialView ?? {});
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  useEffect(() => {
    onViewChangeRef.current?.(view);
  }, [view]);
  const chartWindow = useMemo(() => programmeWindow(plan.tasks ?? []), [plan.tasks]);
  const viewport = useMemo<ViewportOptions>(
    () => ({
      scale: "month",
      // Fit mode sets overflow-y:hidden so large programmes cannot scroll — use fixed rows.
      rowHeightMode: "custom",
      // Jantt's slider minimum; its bars bottom out at 18px there, still enough for the 12px task text.
      // Touch screens keep taller rows so each task stays easy to tap.
      rowHeight: compact ? 40 : 26,
      // Wide enough for typical construction task names without ellipsis; people can still drag it.
      ...(compact ? {} : { labelWidth: 420 }),
      showCriticalPath: true,
      linkRouting: "orthogonal",
      ...view,
      ...chartWindow,
    }),
    [compact, view, chartWindow],
  );

  const chartData = useMemo(() => withDirectoryPeople(plan, people), [plan, people]);
  const newCategories = useRef(new Map<string, PlanCategory>());
  const commit = (next: PlanDocument) =>
    onCommit(withAssignedPeople(withCategories(next, newCategories.current), people));

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
    const root = rootRef.current;
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
    const root = rootRef.current;
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
    () => [...new Set((plan.tasks ?? []).map((task) => task.assignee?.trim() ?? "").filter(Boolean))],
    [plan.tasks],
  );

  // The avatar and plus button sit inside Jantt's task row, whose own click opens the drawer.
  useEffect(() => {
    const root = rootRef.current;
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
    const tasks = (plan.tasks ?? []).map((task) => {
      if (task.id !== taskId) return task;
      const { assignee: _old, ...rest } = task;
      return name ? { ...rest, assignee: name } : rest;
    });
    commit({ ...plan, tasks });
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      syncOutlineClasses(root, plan, highlightTaskIds);
      decorateAssignees(root, plan, people, !readOnly, assigneeLabels);
      fitTimelineHeader(root);
    };
    apply();
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(apply);
    });
    // Style changes cover a bar recoloured in place (category change) without a re-mount.
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [plan, highlightTaskIds, people, readOnly, assigneeLabels]);

  const assigningTask = assigning ? plan.tasks?.find((task) => task.id === assigning.taskId) : undefined;

  return (
    <div
      ref={rootRef}
      className="planner-workbench size-full min-h-0"
      data-testid="planner-workbench"
    >
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
  );
}
