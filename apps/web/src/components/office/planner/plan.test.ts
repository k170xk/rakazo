import { describe, expect, it } from "vitest";
import {
  blankPlan,
  changedTaskIds,
  evolveLinkOf,
  linkTasks,
  parsePlan,
  planBytes,
  programmeWindow,
  withEvolveLink,
  type PlanDocument,
} from "./plan";

describe("linkTasks", () => {
  const plan: PlanDocument = {
    ...blankPlan("Links"),
    tasks: [
      { id: "a", label: "A", category: "default", start: "2027-01-04", end: "2027-01-08" },
      { id: "b", label: "B", category: "default", start: "2027-01-04", end: "2027-01-06" },
    ],
  };

  it("adds the dependency and moves the successor after its predecessor", () => {
    const result = linkTasks(plan, "a", "b");
    if (!result || "error" in result) throw new Error("expected a linked plan");
    const b = result.plan.tasks.find((task) => task.id === "b");
    expect(b?.dependsOn).toBe("a");
    expect((b?.start ?? "") > "2027-01-08").toBe(true);
  });

  it("ignores self links and existing links, and refuses loops", () => {
    expect(linkTasks(plan, "a", "a")).toBeNull();
    const linked = linkTasks(plan, "a", "b");
    if (!linked || "error" in linked) throw new Error("expected a linked plan");
    expect(linkTasks(linked.plan, "a", "b")).toBeNull();
    expect(linkTasks(linked.plan, "b", "a")).toEqual({ error: "cycle" });
  });
});

describe("changedTaskIds", () => {
  const before: PlanDocument = {
    ...blankPlan("Changes"),
    tasks: [
      { id: "a", label: "A", category: "default", start: "2027-01-04", end: "2027-01-08" },
      { id: "b", label: "B", category: "default", start: "2027-01-04", end: "2027-01-06" },
    ],
  };

  it("lists added and edited tasks, not unchanged or removed ones", () => {
    const after: PlanDocument = {
      ...before,
      tasks: [
        { ...before.tasks[0]!, end: "2027-01-12" },
        { id: "c", label: "C", category: "default", start: "2027-02-01", end: "2027-02-03" },
      ],
    };
    expect([...changedTaskIds(before, after)].sort()).toEqual(["a", "c"]);
    expect(changedTaskIds(before, before).size).toBe(0);
    expect(changedTaskIds(null, after).size).toBe(0);
  });
});

describe("programmeWindow", () => {
  it("shows twelve months from this month for a new programme, crossing into next year", () => {
    expect(programmeWindow([], new Date(2026, 10, 20))).toEqual({
      startDate: "2026-11-01",
      endDate: "2027-11-01",
    });
  });

  it("starts at the first of the month of the earliest task", () => {
    const tasks = [{ start: "2027-05-14" }, { start: "2027-01-04" }, { start: "" }];
    expect(programmeWindow(tasks, new Date(2026, 10, 20))).toEqual({
      startDate: "2027-01-01",
      endDate: "2028-01-01",
    });
  });
});

describe("blankPlan", () => {
  it("returns a valid empty programme with the given title", () => {
    const plan = blankPlan("Site programme");
    expect(plan.meta?.title).toBe("Site programme");
    expect(plan.tasks).toEqual([]);
    expect(parsePlan(planBytes(plan)).meta?.title).toBe("Site programme");
  });
});

describe("evolve link", () => {
  it("stores and clears the Evolve job on meta.evolve", () => {
    const linked = withEvolveLink(blankPlan("A"), {
      jobNumber: "HEL18",
      projectId: "p1",
      name: "Flood risk",
    });
    expect(evolveLinkOf(linked)).toEqual({
      jobNumber: "HEL18",
      projectId: "p1",
      name: "Flood risk",
    });
    expect(evolveLinkOf(withEvolveLink(linked, null))).toBeNull();
  });
});
