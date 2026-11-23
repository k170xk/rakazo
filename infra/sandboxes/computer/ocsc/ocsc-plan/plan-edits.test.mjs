import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  analyzeSchedule,
  applyEdits,
  compactScheduleSummary,
  describePlan,
  preparePlan,
  rollupSummaryTasks,
  withCategories,
} from "./plan-edits.mjs";

const plan = () => ({
  meta: { title: "Clinic fit-out", createdAt: "2026-03-02" },
  categories: { default: { label: "General", color: "#76BF43" } },
  tasks: [
    { id: "t1", label: "Survey", category: "default", start: "2026-03-02", end: "2026-03-04" },
    { id: "t2", label: "Design", category: "default", start: "2026-03-05", end: "2026-03-10", dependsOn: "t1" },
    { id: "t3", label: "Tender", category: "default", start: "2026-03-11", end: "2026-03-13" },
  ],
});

const edit = (edits, base = plan()) => applyEdits(base, edits).plan;

test("an Evolve owner is stored as the studio's owner picker stores one", () => {
  const next = edit([
    { op: "assign", ids: ["t1", "t2"], name: "Keith Kenny", evolveProfileId: "42", jobTitle: "Director" },
  ]);
  assert.equal(next.tasks[0].assignee, "Keith Kenny");
  assert.equal(next.tasks[1].assignee, "Keith Kenny");
  assert.deepEqual(next.people, [{ id: "evolve:42", name: "Keith Kenny", role: "Director", evolveProfileId: "42" }]);
});

test("an outside owner is a plain name, and an Evolve person no task uses is dropped", () => {
  const assigned = edit([{ op: "assign", id: "t1", name: "Keith Kenny", evolveProfileId: "42" }]);
  const next = edit([{ op: "assign", id: "t1", name: "  Acme   Contractors " }], assigned);
  assert.equal(next.tasks[0].assignee, "Acme Contractors");
  assert.equal(next.people, undefined);
  const cleared = edit([{ op: "assign", id: "t1", name: null }], next);
  assert.equal("assignee" in cleared.tasks[0], false);
});

test("categories are added, renamed, recoloured and deleted with their tasks reassigned", () => {
  let next = edit([
    { op: "add_category", label: "Mechanical & Electrical", color: "#3b82f6" },
    { op: "update_task", ids: ["t2", "t3"], category: "Mechanical & Electrical" },
  ]);
  assert.deepEqual(next.categories["mechanical-electrical"], { label: "Mechanical & Electrical", color: "#3B82F6" });
  assert.equal(next.tasks[1].category, "mechanical-electrical");

  next = edit([{ op: "update_category", key: "Mechanical & Electrical", label: "M&E", color: "#EF4444" }], next);
  assert.deepEqual(next.categories["mechanical-electrical"], { label: "M&E", color: "#EF4444" });

  next = edit([{ op: "delete_category", key: "M&E" }], next);
  assert.equal(next.categories["mechanical-electrical"], undefined);
  assert.equal(next.tasks[1].category, "default");
});

test("a task naming a new category creates it with a label and the next unused colour", () => {
  const next = edit([{ op: "add_task", id: "t4", label: "Snagging", category: "Handover", start: "2026-03-16" }]);
  assert.deepEqual(next.categories.handover, { label: "Handover", color: "#3B82F6" });
  assert.equal(next.tasks.find((task) => task.id === "t4").category, "handover");
  assert.equal(withCategories({ tasks: [{ category: "fit_out" }] }).categories.fit_out.label, "Fit out");
});

test("update_task sets every drawer field and null clears one", () => {
  let next = edit([
    {
      op: "update_task",
      id: "t1",
      progress: 50,
      status: "In progress",
      priority: "High",
      notes: "Access via rear gate",
      estimatedCost: "1200",
      actualCost: 900,
      wbs: "1.1",
      urgent: true,
      outlineLevel: 2,
      fields: { zone: "A" },
    },
  ]);
  const task = next.tasks[0];
  assert.equal(task.progress, 0.5);
  assert.equal(task.status, "in-progress");
  assert.equal(task.priority, "high");
  assert.equal(task.notes, "Access via rear gate");
  assert.equal(task.estimatedCost, 1200);
  assert.equal(task.urgent, true);
  assert.deepEqual(task.fields, { zone: "A", outlineLevel: 2 });

  next = edit([{ op: "update_task", id: "t1", notes: null, priority: null }], next);
  assert.equal("notes" in next.tasks[0], false);
  assert.equal("priority" in next.tasks[0], false);
});

test("bad values are refused with a reason instead of being saved", () => {
  assert.throws(() => edit([{ op: "update_task", id: "t1", status: "done" }]), /status must be one of/);
  assert.throws(() => edit([{ op: "update_task", id: "t1", end: "2026-02-01" }]), /end is before start/);
  assert.throws(() => edit([{ op: "update_task", id: "t1", colour: "red" }]), /unknown task field colour/);
  assert.throws(() => edit([{ op: "add_category", label: "General" }]), /already exists/);
  assert.throws(() => edit([{ op: "delete_category", key: "default" }]), /cannot be deleted/);
});

test("links carry their type and lag, deletes remove links, and moves reorder", () => {
  let next = edit([{ op: "link_tasks", from: "t2", to: "t3", type: "ss", lag: 2 }]);
  assert.deepEqual(next.tasks[2].dependsOn, [{ id: "t2", type: "SS", lag: 2 }]);
  next = edit([{ op: "delete_task", id: "t2" }], next);
  assert.equal(next.tasks.find((task) => task.id === "t3").dependsOn, undefined);
  next = edit([{ op: "move_task", id: "t3", before: "t1" }], next);
  assert.deepEqual(next.tasks.map((task) => task.id), ["t3", "t1"]);
});

test("a baseline captures the current dates", () => {
  const next = edit([{ op: "set_baseline" }]);
  assert.deepEqual(next.tasks[1].baseline, { start: "2026-03-05", end: "2026-03-10" });
});

test("inspect lists every task with its fields, categories and people", () => {
  const next = edit([
    { op: "assign", id: "t1", name: "Keith Kenny", evolveProfileId: "42" },
    { op: "update_task", id: "t1", priority: "low" },
  ]);
  const view = describePlan(next);
  assert.equal(view.taskCount, 3);
  assert.equal(view.tasks.length, 3);
  assert.equal(view.tasks[0].assignee, "Keith Kenny");
  assert.equal(view.tasks[0].priority, "low");
  assert.deepEqual(view.people, [{ name: "Keith Kenny", evolveProfileId: "42", tasks: 1 }]);
  assert.deepEqual(view.categories[0], { key: "default", label: "General", color: "#76BF43", tasks: 3 });
  assert.equal(describePlan(next, { limit: 1 }).nextFrom, 1);
  assert.deepEqual(describePlan(next, { from: 1, limit: 1 }).tasks.map((task) => task.id), ["t2"]);
  const found = describePlan(next, { find: "keith" });
  assert.equal(found.matchingTasks, 1);
  assert.deepEqual(found.tasks.map((task) => task.id), ["t1"]);
});

test("preparePlan normalizes aliases, rolls up summary bars, and rejects circular links", () => {
  const built = preparePlan({
    meta: { title: "Bridge Works", createdAt: "2026-03-02", defaultGapDays: 0 },
    tasks: [
      { id: "p1", label: "Phase 1 — Design", wbs: "1", outlineLevel: 1, summary: true, start: "2026-03-02", end: "2026-03-02" },
      { id: "t1", label: "GI & Topo Survey", wbs: "1.1", outlineLevel: 2, category: "Civil", start: "2026-03-02", end: "2026-03-10" },
      { id: "t2", label: "Preliminary Design", wbs: "1.2", outlineLevel: 2, category: "Structural", start: "2026-03-11", end: "2026-03-25", dependencies: ["t1"] },
      { id: "t3", label: "Utility Checks", wbs: "1.3", outlineLevel: 2, category: "M&E", start: "2026-03-11", end: "2026-03-15", predecessors: "t1" },
      { id: "m1", label: "Design Freeze", wbs: "1.4", outlineLevel: 2, milestone: true, start: "2026-03-25", end: "2026-03-25", dependsOn: ["t2", "t3"] },
    ],
  });

  const p1 = built.tasks.find((t) => t.id === "p1");
  assert.equal(p1.fields.summary, true);
  assert.equal(p1.fields.outlineLevel, 1);
  assert.equal(p1.start, "2026-03-02");
  assert.equal(p1.end, "2026-03-25");

  const t2 = built.tasks.find((t) => t.id === "t2");
  const t3 = built.tasks.find((t) => t.id === "t3");
  assert.deepEqual(t2.dependsOn, ["t1"]);
  assert.deepEqual(t3.dependsOn, ["t1"]);

  const analysis = analyzeSchedule(built);
  assert.equal(analysis.logic.dependencyCount, 4);
  assert.equal(analysis.logic.unlinkedLeafTasks.length, 0);
  assert.equal(analysis.logic.summaryLinkWarnings.length, 0);
  assert.equal(analysis.warnings.length, 0);
  assert.deepEqual(
    analysis.criticalPath.tasks.map((t) => t.id),
    ["t1", "t2", "m1"],
  );

  // Parallel task t3 has positive float and lists m1 as its successor in describePlan.
  const view = describePlan(built);
  const t3View = view.tasks.find((t) => t.id === "t3");
  assert.equal(t3View.isCritical, undefined);
  assert.ok(t3View.totalFloat > 0);
  assert.deepEqual(t3View.successors, ["m1"]);

  // Circular links are rejected cleanly.
  assert.throws(
    () =>
      preparePlan({
        meta: { title: "Loop" },
        tasks: [
          { id: "a", label: "A", start: "2026-03-01", end: "2026-03-05", dependsOn: "b" },
          { id: "b", label: "B", start: "2026-03-06", end: "2026-03-10", dependsOn: "a" },
        ],
      }),
    /Circular dependency/,
  );
});

test("analyzeSchedule flags unlinked tasks, open finishes, and summary-row links", () => {
  const broken = preparePlan({
    meta: { title: "Unlinked", defaultGapDays: 0 },
    tasks: [
      { id: "s1", label: "Stage 1", summary: true, outlineLevel: 1, start: "2026-03-01", end: "2026-03-10" },
      { id: "a", label: "Task A", outlineLevel: 2, start: "2026-03-01", end: "2026-03-10" },
      { id: "b", label: "Task B", outlineLevel: 2, start: "2026-03-11", end: "2026-03-20", dependsOn: "s1" },
      { id: "c", label: "Task C", outlineLevel: 2, start: "2026-03-05", end: "2026-03-12" },
    ],
  });
  const summary = compactScheduleSummary(broken);
  assert.deepEqual(summary.unlinkedLeafTasks, ["a", "c"]);
  assert.deepEqual(summary.summaryLinkWarnings, ["s1 → b"]);
  assert.ok(summary.warnings.some((w) => w.includes("unlinked leaf task")));
  assert.ok(summary.warnings.some((w) => w.includes("summary row")));
});

test("rollupSummaryTasks supports nested multi-level phases", () => {
  const rolled = rollupSummaryTasks([
    { id: "p1", label: "Phase 1", start: "2026-01-01", end: "2026-01-01", fields: { summary: true, outlineLevel: 1 } },
    { id: "p1a", label: "Sub-phase A", start: "2026-01-01", end: "2026-01-01", fields: { summary: true, outlineLevel: 2 } },
    { id: "t1", label: "Task 1", start: "2026-03-01", end: "2026-03-10", fields: { outlineLevel: 3 } },
    { id: "t2", label: "Task 2", start: "2026-03-11", end: "2026-04-05", fields: { outlineLevel: 3 } },
  ]);
  assert.equal(rolled[1].start, "2026-03-01");
  assert.equal(rolled[1].end, "2026-04-05");
  assert.equal(rolled[0].start, "2026-03-01");
  assert.equal(rolled[0].end, "2026-04-05");
});

test("ocsc-plan CLI returns critical path and health audit on new, edit and audit", () => {
  const dir = mkdtempSync(join(tmpdir(), "ocsc-plan-cli-"));
  try {
    const specPath = join(dir, "spec.json");
    writeFileSync(
      specPath,
      JSON.stringify({
        title: "Hospital MEP Fit-Out",
        tasks: [
          { id: "p1", label: "1. Design & Procurement", wbs: "1", outlineLevel: 1, summary: true, start: "2026-04-01", end: "2026-04-01" },
          { id: "d1", label: "MEP Stage 4 Design", wbs: "1.1", outlineLevel: 2, category: "Mechanical & Electrical", start: "2026-04-01", end: "2026-04-20" },
          { id: "pr1", label: "Switchgear Procurement", wbs: "1.2", outlineLevel: 2, category: "Electrical", start: "2026-04-21", end: "2026-06-15", dependsOn: "d1" },
          { id: "m1", label: "Power-On Milestone", wbs: "1.3", outlineLevel: 2, milestone: true, start: "2026-06-15", end: "2026-06-15", dependsOn: "pr1" },
        ],
      }),
    );
    const cli = join(import.meta.dirname, "ocsc-plan.mjs");
    const env = { ...process.env, WORKSPACE_DIR: dir };
    const created = JSON.parse(
      execFileSync(process.execPath, [cli, "new", "--spec", "spec.json", "--out", "outputs/mep.jantt"], { env, encoding: "utf8" }),
    );
    assert.equal(created.ok, true);
    assert.equal(created.schedule.dependencyCount, 2);
    assert.equal(created.schedule.criticalCount, 3);
    assert.equal(created.schedule.warnings, undefined);

    const audited = JSON.parse(
      execFileSync(process.execPath, [cli, "audit", "--in", "outputs/mep.jantt"], { env, encoding: "utf8" }),
    );
    assert.equal(audited.ok, true);
    assert.equal(audited.schedule.criticalPath.count, 3);
    assert.equal(audited.schedule.logic.summaryTaskCount, 1);
    assert.equal(audited.schedule.logic.milestoneCount, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
