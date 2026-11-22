import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  activePlanNotes,
  boardTasks,
  createNewTask,
  deletePlanNote,
  EMPTY_FILTERS,
  filterPlanTasks,
  normaliseTaskStatus,
  saveBaselineSnapshot,
  setTaskPriority,
  setTaskProgress,
  setTaskStatus,
  upsertPlanNote,
} from "./filters";
import type { PlanDocument } from "./plan";

const samplePlan: PlanDocument = {
  meta: { title: "Timber House" },
  categories: {
    groundworks: { label: "Groundworks", color: "#76BF43" },
    structure: { label: "Structure", color: "#8B5CF6" },
  },
  tasks: [
    {
      id: "stage-1",
      label: "Stage 1",
      category: "groundworks",
      start: "2027-01-04",
      end: "2027-01-22",
      fields: { summary: true },
    },
    {
      id: "excavation",
      label: "Excavation & foundations",
      category: "groundworks",
      start: "2027-01-04",
      end: "2027-01-12",
      assignee: "Keith Knox",
      status: "completed",
      progress: 1,
      priority: "high",
    },
    {
      id: "frame",
      label: "Timber frame erection",
      category: "structure",
      start: "2027-01-13",
      end: "2027-01-22",
      status: "in-progress",
      progress: 0.4,
      priority: "urgent",
      notes: "Crane booking confirmed",
    },
    {
      id: "handover",
      label: "Handover",
      category: "structure",
      start: "2027-01-22",
      end: "2027-01-22",
      milestone: true,
    },
  ],
};

describe("planner filters and task/note mutations", () => {
  it("filters tasks by query, category, status, priority, owner, critical and milestones", () => {
    const critical = new Set(["frame", "handover"]);

    expect(filterPlanTasks(samplePlan, EMPTY_FILTERS, critical)).toHaveLength(4);
    expect(
      filterPlanTasks(samplePlan, { ...EMPTY_FILTERS, query: "crane" }, critical).map((t) => t.id),
    ).toEqual(["frame"]);
    expect(
      filterPlanTasks(samplePlan, { ...EMPTY_FILTERS, categories: ["structure"] }, critical).map(
        (t) => t.id,
      ),
    ).toEqual(["frame", "handover"]);
    expect(
      filterPlanTasks(samplePlan, { ...EMPTY_FILTERS, statuses: ["completed"] }, critical).map(
        (t) => t.id,
      ),
    ).toEqual(["excavation"]);
    expect(
      filterPlanTasks(samplePlan, { ...EMPTY_FILTERS, priorities: ["urgent"] }, critical).map(
        (t) => t.id,
      ),
    ).toEqual(["frame"]);
    expect(
      filterPlanTasks(samplePlan, { ...EMPTY_FILTERS, assignee: "Keith Knox" }, critical).map(
        (t) => t.id,
      ),
    ).toEqual(["excavation"]);
    expect(
      filterPlanTasks(samplePlan, { ...EMPTY_FILTERS, milestonesOnly: true }, critical).map(
        (t) => t.id,
      ),
    ).toEqual(["handover"]);
    expect(
      filterPlanTasks(samplePlan, { ...EMPTY_FILTERS, criticalOnly: true }, critical).map(
        (t) => t.id,
      ),
    ).toEqual(["frame", "handover"]);
    expect(
      filterPlanTasks(samplePlan, { ...EMPTY_FILTERS, unassignedOnly: true }, critical).map(
        (t) => t.id,
      ),
    ).toEqual(["stage-1", "frame", "handover"]);

    expect(
      activeFilterCount({
        ...EMPTY_FILTERS,
        query: "ignored in pill count",
        categories: ["structure"],
        criticalOnly: true,
      }),
    ).toBe(2);
  });

  it("keeps summary rows out of Kanban status columns", () => {
    expect(boardTasks(samplePlan.tasks).map((t) => t.id)).toEqual([
      "excavation",
      "frame",
      "handover",
    ]);
  });

  it("updates status, progress, priority and baseline without dropping other tasks", () => {
    const done = setTaskStatus(samplePlan, "frame", "completed");
    expect(done.tasks).toHaveLength(samplePlan.tasks.length);
    const updated = done.tasks.find((t) => t.id === "frame")!;
    expect(normaliseTaskStatus(updated)).toBe("completed");
    expect(updated.progress).toBe(1);

    const halfway = setTaskProgress(done, "frame", 0.5);
    expect(halfway.tasks.find((t) => t.id === "frame")?.progress).toBe(0.5);

    const low = setTaskPriority(halfway, "frame", "low");
    expect(low.tasks.find((t) => t.id === "frame")?.priority).toBe("low");
    expect(low.tasks.find((t) => t.id === "frame")?.urgent).toBeUndefined();

    const baselined = saveBaselineSnapshot(low, "Tender baseline");
    expect(baselined.tasks.find((t) => t.id === "frame")?.baseline).toEqual({
      start: "2027-01-13",
      end: "2027-01-22",
    });
  });

  it("creates new tasks with unique ids and manages pinned project notes", () => {
    const { plan: withNew, task } = createNewTask(samplePlan);
    expect(withNew.tasks).toHaveLength(samplePlan.tasks.length + 1);
    expect(task.start).toBe("2027-01-23");
    expect(task.category).toBe("groundworks");

    const n1 = upsertPlanNote(withNew, { title: "Kickoff", content: "Agree scope" }, new Date("2026-11-21T10:00:00Z"));
    const n2 = upsertPlanNote(
      n1.plan,
      { title: "Pinned risk", content: "Lead time 6 weeks", pinned: true },
      new Date("2026-11-21T09:00:00Z"),
    );
    expect(activePlanNotes(n2.plan).map((n) => n.title)).toEqual(["Pinned risk", "Kickoff"]);

    const edited = upsertPlanNote(n2.plan, { id: n1.note.id, title: "Kickoff updated", content: "Signed" });
    expect(activePlanNotes(edited.plan).find((n) => n.id === n1.note.id)?.title).toBe("Kickoff updated");

    const afterDelete = deletePlanNote(edited.plan, n2.note.id);
    expect(activePlanNotes(afterDelete)).toHaveLength(1);
  });
});
