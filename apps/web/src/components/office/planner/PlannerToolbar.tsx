import { Trans, useLingui } from "@lingui/react/macro";
import type { LinkRoutingStyle, RowHeightMode, TimeScale, ViewportOptions } from "@jantt/core";
import { SCALE_DAY_WIDTHS } from "@jantt/core";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
} from "@rakazo/ui-web";
import {
  Activity,
  BookmarkCheck,
  Calendar,
  ChevronDown,
  Code2,
  Columns3,
  GanttChart,
  ListTodo,
  Minus,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
  StickyNote,
  X,
} from "lucide-react";
import { useState } from "react";
import {
  activeFilterCount,
  EMPTY_FILTERS,
  hasActiveFilters,
  KANBAN_STATUSES,
  TASK_PRIORITIES,
  type KanbanStatus,
  type PlanFilters,
  type PlanViewMode,
  type TaskPriority,
} from "./filters";
import type { PlanDocument } from "./plan";

const SCALES: readonly TimeScale[] = ["day", "week", "month", "quarter", "year"];

const ROW_PRESETS: readonly { label: string; height?: number; mode: RowHeightMode }[] = [
  { label: "Compact", height: 26, mode: "custom" },
  { label: "Default", height: 40, mode: "custom" },
  { label: "Spacious", height: 56, mode: "custom" },
  { label: "Fit", mode: "fit" },
];

export type PlannerToolbarProps = {
  plan: PlanDocument;
  viewMode: PlanViewMode;
  onViewModeChange: (mode: PlanViewMode) => void;
  viewport: ViewportOptions;
  onViewportPatch: (patch: Partial<ViewportOptions>) => void;
  filters: PlanFilters;
  onFiltersChange: (next: PlanFilters) => void;
  totalTasks: number;
  matchingTasks: number;
  criticalCount: number;
  healthGrade: "A" | "B" | "C" | "D" | "F" | null;
  notesCount: number;
  assignees: readonly string[];
  readOnly: boolean;
  onAddTask: () => void;
  onJumpToday: () => void;
  onSaveBaseline: () => void;
  onOpenJson: () => void;
};

const pillBtn =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-foreground/[0.08] bg-background px-3 text-[12px] font-medium text-foreground transition-colors outline-none hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

function toggleItem<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((value) => value !== item) : [...list, item];
}

function gradeDotClass(grade: "A" | "B" | "C" | "D" | "F" | null): string {
  if (!grade) return "";
  if (grade === "A" || grade === "B") return "bg-primary";
  if (grade === "C") return "bg-amber-500";
  return "bg-destructive";
}

export function PlannerToolbar({
  plan,
  viewMode,
  onViewModeChange,
  viewport,
  onViewportPatch,
  filters,
  onFiltersChange,
  totalTasks,
  matchingTasks,
  criticalCount,
  healthGrade,
  notesCount,
  assignees,
  readOnly,
  onAddTask,
  onJumpToday,
  onSaveBaseline,
  onOpenJson,
}: PlannerToolbarProps) {
  const { t } = useLingui();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const filterBadgeCount = activeFilterCount(filters);
  const filtered = hasActiveFilters(filters);
  const currentScale: TimeScale = viewport.scale ?? "month";
  const currentDayWidth = viewport.dayWidth ?? SCALE_DAY_WIDTHS[currentScale] ?? 10;
  const currentRowHeight = viewport.rowHeight ?? 26;
  const currentRowMode: RowHeightMode = viewport.rowHeightMode ?? "custom";
  const currentRouting: LinkRoutingStyle = viewport.linkRouting ?? "orthogonal";
  const showCritical = viewport.showCriticalPath !== false;
  const showBaselines = Boolean(viewport.showBaselines);
  const autoCascade = viewport.autoCascade !== false;

  const categories = Object.entries(plan.categories ?? {});
  const showActionRow = viewMode === "gantt" || viewMode === "kanban" || viewMode === "tasks";

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

  const scaleLabel = (scale: TimeScale) => {
    switch (scale) {
      case "day":
        return t`Day`;
      case "week":
        return t`Week`;
      case "month":
        return t`Month`;
      case "quarter":
        return t`Quarter`;
      case "year":
        return t`Year`;
    }
  };

  const tabs: {
    id: PlanViewMode;
    label: string;
    icon: typeof GanttChart;
    badge?: number;
    dotClass?: string;
  }[] = [
    { id: "gantt", label: t`Gantt`, icon: GanttChart },
    { id: "kanban", label: t`Kanban`, icon: Columns3 },
    { id: "tasks", label: t`Tasks`, icon: ListTodo },
    {
      id: "health",
      label: t`Health & PM`,
      icon: Activity,
      dotClass: totalTasks > 0 ? gradeDotClass(healthGrade) : undefined,
    },
    { id: "notes", label: t`Notes`, icon: StickyNote, badge: notesCount > 0 ? notesCount : undefined },
  ];

  return (
    <div className="shrink-0 select-none" data-testid="planner-chrome">
      {/* Row 1: View switcher + Gantt time-scale controls */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/60 px-2.5 py-1.5">
        <div
          role="tablist"
          aria-label={t`Programme views`}
          className="planner-scroll-strip flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-full border border-foreground/[0.06] bg-background/80 p-0.5"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = viewMode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`planner-tab-${tab.id}`}
                onClick={() => onViewModeChange(tab.id)}
                className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
                }`}
              >
                <Icon className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                <span>{tab.label}</span>
                {tab.dotClass ? (
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${tab.dotClass}`}
                    aria-hidden="true"
                  />
                ) : null}
                {tab.badge !== undefined ? (
                  <span className="rounded-full bg-foreground/[0.08] px-1.5 py-0 text-[10px] font-semibold tabular-nums text-foreground">
                    {tab.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {viewMode === "gantt" ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              data-testid="planner-today"
              onClick={onJumpToday}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-foreground/[0.08] bg-background px-2.5 text-[12px] font-medium text-foreground transition-colors outline-none hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring"
              title={t`Scroll timeline to today`}
            >
              <Calendar className="size-3.5 text-primary" strokeWidth={1.8} aria-hidden="true" />
              <span className="max-sm:hidden">
                <Trans>Today</Trans>
              </span>
            </button>

            {/* Full scale bar on md+; compact dropdown on narrow screens */}
            <div
              className="hidden items-center gap-0.5 rounded-full border border-foreground/[0.06] bg-background/80 p-0.5 md:inline-flex"
              role="group"
              aria-label={t`Timeline scale`}
            >
              {SCALES.map((scale) => {
                const active = currentScale === scale;
                return (
                  <button
                    key={scale}
                    type="button"
                    data-testid={`planner-scale-${scale}`}
                    aria-pressed={active}
                    onClick={() =>
                      onViewportPatch({ scale, dayWidth: SCALE_DAY_WIDTHS[scale] ?? 10 })
                    }
                    className={`inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      active
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
                    }`}
                  >
                    {scaleLabel(scale)}
                  </button>
                );
              })}
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger
                className="inline-flex h-7 items-center gap-1 rounded-full border border-foreground/[0.08] bg-background px-2.5 text-[12px] font-medium text-foreground outline-none hover:bg-foreground/[0.05] md:hidden"
                aria-label={t`Timeline scale`}
              >
                <span>{scaleLabel(currentScale)}</span>
                <ChevronDown className="size-3 opacity-65" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {SCALES.map((scale) => (
                  <DropdownMenuItem
                    key={scale}
                    onClick={() =>
                      onViewportPatch({ scale, dayWidth: SCALE_DAY_WIDTHS[scale] ?? 10 })
                    }
                  >
                    <span className={currentScale === scale ? "font-semibold text-primary" : ""}>
                      {scaleLabel(scale)}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenJson}
            data-testid="planner-json-trigger"
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-foreground/[0.08] bg-background px-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
            title={t`Inspect programme JSON`}
          >
            <Code2 className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
            <span className="max-sm:hidden">JSON</span>
          </button>
        )}
      </div>

      {/* Row 2: Add Task, Search, Filters, Settings */}
      {showActionRow ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-2.5 py-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {!readOnly ? (
              <button
                type="button"
                data-testid="planner-add-task"
                onClick={onAddTask}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="size-3.5" strokeWidth={2.2} aria-hidden="true" />
                <span className="max-xs:hidden">
                  <Trans>Add task</Trans>
                </span>
              </button>
            ) : null}

            <label className="relative flex h-8 min-w-[120px] max-w-[260px] flex-1 items-center rounded-full border border-foreground/[0.08] bg-muted/40 px-2.5 focus-within:border-primary/50 focus-within:bg-background">
              <Search
                className="mr-1.5 size-3.5 shrink-0 text-muted-foreground"
                strokeWidth={1.8}
                aria-hidden="true"
              />
              <input
                type="search"
                value={filters.query}
                onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
                placeholder={t`Search ${totalTasks} tasks…`}
                aria-label={t`Search tasks`}
                data-testid="planner-search-input"
                className="w-full min-w-0 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground outline-none [&::-webkit-search-cancel-button]:hidden"
              />
              {filters.query ? (
                <button
                  type="button"
                  onClick={() => onFiltersChange({ ...filters, query: "" })}
                  aria-label={t`Clear search`}
                  className="ml-1 grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </label>

            {filtered ? (
              <div className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <span className="rounded-full bg-primary/15 px-2 py-0.5 tabular-nums text-primary">
                  {matchingTasks} / {totalTasks}
                </span>
                <button
                  type="button"
                  onClick={() => onFiltersChange(EMPTY_FILTERS)}
                  className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  <Trans>Clear</Trans>
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {/* Filters Popover */}
            <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
              <PopoverTrigger
                data-testid="planner-filters-trigger"
                className={`${pillBtn} ${
                  filterBadgeCount > 0 ? "border-primary/40 bg-primary/10 text-primary" : ""
                }`}
              >
                <SlidersHorizontal className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
                <span className="max-sm:hidden">
                  <Trans>Filters</Trans>
                </span>
                {filterBadgeCount > 0 ? (
                  <span className="grid size-4 place-items-center rounded-full bg-primary text-[10px] font-semibold tabular-nums text-primary-foreground">
                    {filterBadgeCount}
                  </span>
                ) : null}
              </PopoverTrigger>
              {filtersOpen ? (
                <PopoverContent
                  align="end"
                  sideOffset={6}
                  className="z-[70] w-[310px] max-w-[calc(100vw-24px)] p-3.5"
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-semibold text-foreground">
                        <Trans>Filter tasks</Trans>
                      </span>
                      {filterBadgeCount > 0 ? (
                        <button
                          type="button"
                          onClick={() =>
                            onFiltersChange({ ...EMPTY_FILTERS, query: filters.query })
                          }
                          className="text-[11px] font-medium text-primary hover:underline"
                        >
                          <Trans>Reset filters</Trans>
                        </button>
                      ) : null}
                    </div>

                    {categories.length > 0 ? (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[11px] font-medium text-muted-foreground">
                          <Trans>Category</Trans>
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {categories.map(([key, cat]) => {
                            const active = filters.categories.includes(key);
                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={() =>
                                  onFiltersChange({
                                    ...filters,
                                    categories: toggleItem(filters.categories, key),
                                  })
                                }
                                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                                  active
                                    ? "border-primary bg-primary/15 text-primary"
                                    : "border-border bg-background text-foreground hover:bg-muted"
                                }`}
                              >
                                <span
                                  className="size-2 shrink-0 rounded-full"
                                  style={{ backgroundColor: cat.color || "#76BF43" }}
                                />
                                <span className="max-w-[120px] truncate">{cat.label || key}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        <Trans>Status</Trans>
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {KANBAN_STATUSES.map((status) => {
                          const active = filters.statuses.includes(status);
                          return (
                            <button
                              key={status}
                              type="button"
                              onClick={() =>
                                onFiltersChange({
                                  ...filters,
                                  statuses: toggleItem(filters.statuses, status),
                                })
                              }
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                                active
                                  ? "border-primary bg-primary/15 text-primary"
                                  : "border-border bg-background text-foreground hover:bg-muted"
                              }`}
                            >
                              {statusLabel(status)}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        <Trans>Priority</Trans>
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {TASK_PRIORITIES.map((priority) => {
                          const active = filters.priorities.includes(priority);
                          return (
                            <button
                              key={priority}
                              type="button"
                              onClick={() =>
                                onFiltersChange({
                                  ...filters,
                                  priorities: toggleItem(filters.priorities, priority),
                                })
                              }
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                                active
                                  ? "border-primary bg-primary/15 text-primary"
                                  : "border-border bg-background text-foreground hover:bg-muted"
                              }`}
                            >
                              {priorityLabel(priority)}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {assignees.length > 0 ? (
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="planner-filter-owner"
                          className="text-[11px] font-medium text-muted-foreground"
                        >
                          <Trans>Owner</Trans>
                        </label>
                        <select
                          id="planner-filter-owner"
                          value={filters.assignee}
                          onChange={(event) =>
                            onFiltersChange({ ...filters, assignee: event.target.value })
                          }
                          className="h-8 rounded-lg border border-border bg-background px-2 text-[12px] text-foreground outline-none focus:border-primary"
                        >
                          <option value="">{t`Anyone`}</option>
                          {assignees.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}

                    <div className="flex flex-col gap-2 border-t border-border pt-2.5">
                      <label className="flex cursor-pointer items-center justify-between gap-2 text-[12px] text-foreground">
                        <span>
                          <Trans>Critical path only</Trans>
                        </span>
                        <Switch
                          size="sm"
                          checked={filters.criticalOnly}
                          onCheckedChange={(checked) =>
                            onFiltersChange({ ...filters, criticalOnly: Boolean(checked) })
                          }
                        />
                      </label>
                      <label className="flex cursor-pointer items-center justify-between gap-2 text-[12px] text-foreground">
                        <span>
                          <Trans>Milestones only</Trans>
                        </span>
                        <Switch
                          size="sm"
                          checked={filters.milestonesOnly}
                          onCheckedChange={(checked) =>
                            onFiltersChange({ ...filters, milestonesOnly: Boolean(checked) })
                          }
                        />
                      </label>
                      <label className="flex cursor-pointer items-center justify-between gap-2 text-[12px] text-foreground">
                        <span>
                          <Trans>Unassigned only</Trans>
                        </span>
                        <Switch
                          size="sm"
                          checked={filters.unassignedOnly}
                          onCheckedChange={(checked) =>
                            onFiltersChange({ ...filters, unassignedOnly: Boolean(checked) })
                          }
                        />
                      </label>
                    </div>
                  </div>
                </PopoverContent>
              ) : null}
            </Popover>

            {/* Settings Popover */}
            <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
              <PopoverTrigger data-testid="planner-settings-trigger" className={pillBtn}>
                <Settings2 className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
                <span className="max-sm:hidden">
                  <Trans>Settings</Trans>
                </span>
              </PopoverTrigger>
              {settingsOpen ? (
                <PopoverContent
                  align="end"
                  sideOffset={6}
                  className="z-[70] w-[300px] max-w-[calc(100vw-24px)] p-3.5"
                >
                  <div className="flex flex-col gap-3">
                    <span className="text-[12px] font-semibold text-foreground">
                      <Trans>Programme settings</Trans>
                    </span>

                    {viewMode === "gantt" ? (
                      <>
                        {/* Zoom control */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] text-muted-foreground">
                            <Trans>Timeline zoom</Trans>
                          </span>
                          <div className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 p-0.5">
                            <button
                              type="button"
                              aria-label={t`Zoom out`}
                              onClick={() =>
                                onViewportPatch({
                                  dayWidth: Math.max(
                                    1.2,
                                    Math.round((currentDayWidth / 1.25) * 10) / 10,
                                  ),
                                })
                              }
                              className="grid size-6 place-items-center rounded-full hover:bg-background"
                            >
                              <Minus className="size-3" />
                            </button>
                            <span className="min-w-[38px] text-center text-[11px] font-medium tabular-nums text-foreground">
                              {Math.round(currentDayWidth)}px
                            </span>
                            <button
                              type="button"
                              aria-label={t`Zoom in`}
                              onClick={() =>
                                onViewportPatch({
                                  dayWidth: Math.min(
                                    80,
                                    Math.round(currentDayWidth * 1.25 * 10) / 10,
                                  ),
                                })
                              }
                              className="grid size-6 place-items-center rounded-full hover:bg-background"
                            >
                              <Plus className="size-3" />
                            </button>
                          </div>
                        </div>

                        {/* Row height presets */}
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[12px] text-muted-foreground">
                            <Trans>Row density</Trans>
                          </span>
                          <div className="grid grid-cols-4 gap-1 rounded-full border border-border bg-muted/40 p-0.5">
                            {ROW_PRESETS.map((preset) => {
                              const active =
                                preset.mode === "fit"
                                  ? currentRowMode === "fit"
                                  : currentRowMode === "custom" &&
                                    currentRowHeight === preset.height;
                              return (
                                <button
                                  key={preset.label}
                                  type="button"
                                  onClick={() =>
                                    onViewportPatch(
                                      preset.mode === "fit"
                                        ? { rowHeightMode: "fit" }
                                        : { rowHeightMode: "custom", rowHeight: preset.height },
                                    )
                                  }
                                  className={`h-6 rounded-full text-[11px] font-medium transition-colors ${
                                    active
                                      ? "bg-primary/15 text-primary"
                                      : "text-muted-foreground hover:text-foreground"
                                  }`}
                                >
                                  {preset.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Link routing */}
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[12px] text-muted-foreground">
                            <Trans>Link arrows</Trans>
                          </span>
                          <div className="grid grid-cols-3 gap-1 rounded-full border border-border bg-muted/40 p-0.5">
                            {(
                              [
                                ["orthogonal", t`90° Turn`],
                                ["curved", t`Curved`],
                                ["direct", t`Direct`],
                              ] as const
                            ).map(([routing, label]) => (
                              <button
                                key={routing}
                                type="button"
                                onClick={() => onViewportPatch({ linkRouting: routing })}
                                className={`h-6 rounded-full text-[11px] font-medium transition-colors ${
                                  currentRouting === routing
                                    ? "bg-primary/15 text-primary"
                                    : "text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Toggles */}
                        <div className="flex flex-col gap-2.5 border-t border-border pt-2.5">
                          <label className="flex cursor-pointer items-center justify-between gap-2 text-[12px] text-foreground">
                            <span className="flex items-center gap-1.5">
                              <span>
                                <Trans>Critical path</Trans>
                              </span>
                              <span className="rounded-full bg-destructive/12 px-1.5 py-0 text-[10px] font-semibold tabular-nums text-destructive">
                                {criticalCount}
                              </span>
                            </span>
                            <Switch
                              size="sm"
                              checked={showCritical}
                              onCheckedChange={(checked) =>
                                onViewportPatch({ showCriticalPath: Boolean(checked) })
                              }
                            />
                          </label>

                          <label className="flex cursor-pointer items-center justify-between gap-2 text-[12px] text-foreground">
                            <span>
                              <Trans>Show baselines</Trans>
                            </span>
                            <Switch
                              size="sm"
                              checked={showBaselines}
                              onCheckedChange={(checked) =>
                                onViewportPatch({ showBaselines: Boolean(checked) })
                              }
                            />
                          </label>

                          <label className="flex cursor-pointer items-center justify-between gap-2 text-[12px] text-foreground">
                            <span>
                              <Trans>Auto-cascade links</Trans>
                            </span>
                            <Switch
                              size="sm"
                              checked={autoCascade}
                              onCheckedChange={(checked) =>
                                onViewportPatch({ autoCascade: Boolean(checked) })
                              }
                            />
                          </label>
                        </div>
                      </>
                    ) : null}

                    {/* Actions: Save Baseline & Inspect JSON */}
                    <div className="flex flex-col gap-1.5 border-t border-border pt-2.5">
                      {!readOnly ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full justify-start gap-2 rounded-full text-[12px]"
                          onClick={() => {
                            setSettingsOpen(false);
                            onSaveBaseline();
                          }}
                        >
                          <BookmarkCheck className="size-3.5 text-primary" />
                          <Trans>Save current dates as baseline</Trans>
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full justify-start gap-2 rounded-full text-[12px]"
                        onClick={() => {
                          setSettingsOpen(false);
                          onOpenJson();
                        }}
                      >
                        <Code2 className="size-3.5 text-muted-foreground" />
                        <Trans>View programme JSON</Trans>
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              ) : null}
            </Popover>
          </div>
        </div>
      ) : null}
    </div>
  );
}
