import { Trans, useLingui } from "@lingui/react/macro";
import {
  auditScheduleIntegrity,
  calculateEVM,
  computeBaselineVariance,
  detectOverAllocations,
  type CriticalPathResult,
} from "@jantt/core";
import { Button } from "@rakazo/ui-web";
import {
  AlertCircle,
  AlertTriangle,
  BookmarkCheck,
  CheckCircle2,
  Flame,
  GanttChart,
  Info,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { boardTasks } from "./filters";
import type { PlanDocument } from "./plan";

type HealthTab = "overview" | "audit";

function gradeTone(grade: "A" | "B" | "C" | "D" | "F"): string {
  if (grade === "A" || grade === "B") return "bg-primary/15 text-primary border-primary/30";
  if (grade === "C") {
    return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
  }
  return "bg-destructive/15 text-destructive border-destructive/30";
}

function formatRatio(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

function progressPercent(progress: number | null | undefined): number {
  const raw = typeof progress === "number" ? progress : 0;
  return raw <= 1 ? raw * 100 : raw;
}

export function PlannerHealthView({
  plan,
  critical,
  readOnly,
  onSaveBaseline,
  onJumpToTask,
}: {
  plan: PlanDocument;
  critical: CriticalPathResult;
  readOnly: boolean;
  onSaveBaseline: () => void;
  onJumpToTask: (taskId: string) => void;
}) {
  const { t } = useLingui();
  const [subTab, setSubTab] = useState<HealthTab>("overview");
  const tasks = plan.tasks ?? [];
  const workItems = useMemo(() => boardTasks(tasks), [tasks]);

  const audit = useMemo(() => auditScheduleIntegrity(tasks, critical), [tasks, critical]);
  const evm = useMemo(() => calculateEVM(workItems), [workItems]);
  const baseline = useMemo(() => computeBaselineVariance(plan), [plan]);

  // Collapse daily overallocations into one peak record per person.
  const overAllocatedPeople = useMemo(() => {
    const raw = detectOverAllocations(workItems);
    const byPerson = new Map<string, { resourceId: string; peakDate: string; peakTasks: number }>();
    for (const slot of raw) {
      if (!slot.isOverallocated) continue;
      const count = slot.tasks.length;
      const existing = byPerson.get(slot.resourceId);
      if (!existing || count > existing.peakTasks) {
        byPerson.set(slot.resourceId, {
          resourceId: slot.resourceId,
          peakDate: slot.date,
          peakTasks: count,
        });
      }
    }
    return [...byPerson.values()].sort((a, b) => b.peakTasks - a.peakTasks);
  }, [workItems]);

  const taskLabelById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task.label])),
    [tasks],
  );

  const categoryBreakdown = useMemo(() => {
    const counts = new Map<string, { label: string; color: string; count: number; avgProgress: number }>();
    for (const task of workItems) {
      const key = task.category || "uncategorised";
      const meta = task.category ? plan.categories?.[task.category] : undefined;
      const entry = counts.get(key) ?? {
        label: meta?.label || task.category || t`General`,
        color: meta?.color || "#76BF43",
        count: 0,
        avgProgress: 0,
      };
      entry.avgProgress =
        (entry.avgProgress * entry.count + progressPercent(task.progress)) / (entry.count + 1);
      entry.count += 1;
      counts.set(key, entry);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }, [workItems, plan.categories, t]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-muted/20 p-3 sm:p-5"
      data-testid="planner-health-view"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        {/* Header strip */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-full border border-foreground/[0.08] bg-background p-0.5">
            <button
              type="button"
              onClick={() => setSubTab("overview")}
              className={`h-7 rounded-full px-3 text-[12px] font-medium transition-colors ${
                subTab === "overview"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Trans>Overview</Trans>
            </button>
            <button
              type="button"
              onClick={() => setSubTab("audit")}
              className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors ${
                subTab === "audit"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Trans>Schedule audit & EVM</Trans>
              {audit.issues.length > 0 ? (
                <span className="rounded-full bg-foreground/[0.08] px-1.5 text-[10px] font-semibold tabular-nums text-foreground">
                  {audit.issues.length}
                </span>
              ) : null}
            </button>
          </div>

          {!readOnly ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onSaveBaseline}
              data-testid="planner-health-save-baseline"
              className="h-8 rounded-full px-3 text-[12px]"
            >
              <BookmarkCheck className="mr-1.5 size-3.5 text-primary" />
              <Trans>Save baseline snapshot</Trans>
            </Button>
          ) : null}
        </div>

        {/* Top KPI Cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Health Score */}
          <div className="flex flex-col justify-between gap-2 rounded-xl border border-border bg-card p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] font-medium text-muted-foreground">
                <Trans>Schedule health</Trans>
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${gradeTone(audit.grade)}`}
              >
                {audit.grade}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold tabular-nums text-foreground">
                {audit.healthScore}
              </span>
              <span className="text-[12px] text-muted-foreground">/ 100</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {audit.issues.length === 0 ? (
                <Trans>No schedule integrity issues detected</Trans>
              ) : (
                <Trans>{audit.issues.length} audit findings to review</Trans>
              )}
            </p>
          </div>

          {/* Completion */}
          <div className="flex flex-col justify-between gap-2 rounded-xl border border-border bg-card p-3.5">
            <span className="text-[11.5px] font-medium text-muted-foreground">
              <Trans>Overall progress</Trans>
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tabular-nums text-foreground">
                {Math.round(evm.projectProgressPercent)}%
              </span>
              <span className="text-[11.5px] text-muted-foreground">
                ({evm.taskCountCompleted}/{evm.taskCountTotal})
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(100, Math.max(0, evm.projectProgressPercent))}%` }}
              />
            </div>
          </div>

          {/* Critical path */}
          <div className="flex flex-col justify-between gap-2 rounded-xl border border-border bg-card p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] font-medium text-muted-foreground">
                <Trans>Critical path</Trans>
              </span>
              <Flame className="size-4 text-destructive" aria-hidden="true" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tabular-nums text-foreground">
                {critical.criticalTaskIds.size}
              </span>
              <span className="text-[12px] text-muted-foreground">
                <Trans>critical tasks</Trans>
              </span>
            </div>
            <p className="truncate text-[11px] tabular-nums text-muted-foreground">
              {critical.projectEarlyFinish ? (
                <Trans>Forecast finish: {critical.projectEarlyFinish}</Trans>
              ) : (
                <Trans>Add dated tasks to forecast finish</Trans>
              )}
            </p>
          </div>

          {/* Baseline / Resource load */}
          <div className="flex flex-col justify-between gap-2 rounded-xl border border-border bg-card p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] font-medium text-muted-foreground">
                {baseline ? <Trans>Baseline variance</Trans> : <Trans>Resource conflicts</Trans>}
              </span>
              <Users className="size-4 text-muted-foreground" aria-hidden="true" />
            </div>
            {baseline ? (
              <>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold tabular-nums text-foreground">
                    {baseline.totalDelayedTasks}
                  </span>
                  <span className="text-[12px] text-muted-foreground">
                    <Trans>delayed</Trans>
                  </span>
                </div>
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  <Trans>
                    {baseline.totalOnScheduleTasks} on schedule · {baseline.totalAheadTasks} ahead
                  </Trans>
                </p>
              </>
            ) : (
              <>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold tabular-nums text-foreground">
                    {overAllocatedPeople.length}
                  </span>
                  <span className="text-[12px] text-muted-foreground">
                    <Trans>overlaps</Trans>
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {overAllocatedPeople.length === 0 ? (
                    <Trans>No assignee double-bookings</Trans>
                  ) : (
                    <Trans>Assignees with concurrent tasks</Trans>
                  )}
                </p>
              </>
            )}
          </div>
        </div>

        {subTab === "overview" ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Workstream breakdown */}
            <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
              <h3 className="text-[13px] font-semibold text-foreground">
                <Trans>Workstream breakdown</Trans>
              </h3>
              {categoryBreakdown.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">
                  <Trans>No work items yet.</Trans>
                </p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {categoryBreakdown.map((item) => (
                    <div key={item.label} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="flex items-center gap-2 font-medium text-foreground">
                          <span
                            className="size-2.5 rounded-full"
                            style={{ backgroundColor: item.color }}
                          />
                          {item.label}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {item.count} · {Math.round(item.avgProgress)}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, Math.max(0, Math.round(item.avgProgress)))}%`,
                            backgroundColor: item.color,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Resource over-allocations & top issues */}
            <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-semibold text-foreground">
                  <Trans>Attention needed</Trans>
                </h3>
                {audit.issues.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setSubTab("audit")}
                    className="text-[11.5px] font-medium text-primary hover:underline"
                  >
                    <Trans>View full audit</Trans>
                  </button>
                ) : null}
              </div>

              {audit.issues.length === 0 && overAllocatedPeople.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/10 p-3 text-[12.5px] text-primary">
                  <CheckCircle2 className="size-4 shrink-0" />
                  <Trans>Schedule looks clean — no dangling logic or resource overlaps.</Trans>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {audit.issues.slice(0, 5).map((issue, index) => (
                    <div
                      key={`${issue.type}-${issue.taskId ?? index}`}
                      className="flex items-start justify-between gap-2 rounded-lg border border-border/80 bg-muted/25 px-3 py-2 text-[12px]"
                    >
                      <div className="flex min-w-0 items-start gap-2">
                        {issue.severity === "high" ? (
                          <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                        ) : issue.severity === "medium" ? (
                          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                        ) : (
                          <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">{issue.message}</p>
                          {issue.taskId && taskLabelById.has(issue.taskId) ? (
                            <p className="truncate text-[11px] text-muted-foreground">
                              {taskLabelById.get(issue.taskId)}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      {issue.taskId ? (
                        <button
                          type="button"
                          onClick={() => onJumpToTask(issue.taskId!)}
                          className="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-primary"
                          title={t`Jump to task on Gantt`}
                        >
                          <GanttChart className="size-3.5" />
                        </button>
                      ) : null}
                    </div>
                  ))}

                  {overAllocatedPeople.slice(0, 3).map((conflict) => (
                    <div
                      key={`${conflict.resourceId}-${conflict.peakDate}`}
                      className="flex items-start justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px]"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">
                          <Trans>
                            {conflict.resourceId} assigned to {conflict.peakTasks} overlapping tasks
                          </Trans>
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          <Trans>Peak overlap on {conflict.peakDate}</Trans>
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* EVM strip */}
            <section className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-foreground">
                  <Trans>Earned Value & Schedule Performance (EVM)</Trans>
                </h3>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {evm.daysRemaining > 0 ? (
                    <Trans>{evm.daysRemaining} days remaining</Trans>
                  ) : (
                    <Trans>Programme window elapsed</Trans>
                  )}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-border/70 bg-muted/25 p-2.5">
                  <div className="text-[11px] text-muted-foreground">SPI</div>
                  <div className="text-lg font-bold tabular-nums text-foreground">
                    {formatRatio(evm.spi)}
                  </div>
                  <div className="text-[10.5px] text-muted-foreground">
                    <Trans>Schedule index</Trans>
                  </div>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/25 p-2.5">
                  <div className="text-[11px] text-muted-foreground">CPI</div>
                  <div className="text-lg font-bold tabular-nums text-foreground">
                    {formatRatio(evm.cpi)}
                  </div>
                  <div className="text-[10.5px] text-muted-foreground">
                    <Trans>Cost index</Trans>
                  </div>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/25 p-2.5">
                  <div className="text-[11px] text-muted-foreground">
                    <Trans>Blocked</Trans>
                  </div>
                  <div className="text-lg font-bold tabular-nums text-foreground">
                    {evm.taskCountBlocked}
                  </div>
                  <div className="text-[10.5px] text-muted-foreground">
                    <Trans>Impeded items</Trans>
                  </div>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/25 p-2.5">
                  <div className="text-[11px] text-muted-foreground">
                    <Trans>In progress</Trans>
                  </div>
                  <div className="text-lg font-bold tabular-nums text-foreground">
                    {evm.taskCountInProgress}
                  </div>
                  <div className="text-[10.5px] text-muted-foreground">
                    <Trans>Active items</Trans>
                  </div>
                </div>
              </div>
            </section>

            {/* Full DCMA audit list */}
            <section className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-foreground">
                  <Trans>Schedule integrity audit</Trans>
                </h3>
                <span className="text-[11.5px] text-muted-foreground">
                  <Trans>
                    Missing logic: {audit.missingLogicCount} · High float: {audit.highFloatCount} ·
                    Negative float: {audit.negativeFloatCount}
                  </Trans>
                </span>
              </div>

              {audit.issues.length === 0 ? (
                <p className="text-[12.5px] text-muted-foreground">
                  <Trans>All DCMA schedule integrity checks passed.</Trans>
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {audit.issues.map((issue, index) => (
                    <div
                      key={`${issue.type}-${issue.taskId ?? index}`}
                      className="flex items-start justify-between gap-3 rounded-lg border border-border/80 bg-muted/20 p-3 text-[12px]"
                    >
                      <div className="flex min-w-0 items-start gap-2">
                        {issue.severity === "high" ? (
                          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                        ) : issue.severity === "medium" ? (
                          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                        ) : (
                          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">{issue.message}</p>
                          {issue.recommendation ? (
                            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                              {issue.recommendation}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      {issue.taskId ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onJumpToTask(issue.taskId!)}
                          className="h-7 shrink-0 rounded-full px-2.5 text-[11px]"
                        >
                          <GanttChart className="mr-1 size-3" />
                          <Trans>Locate</Trans>
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
