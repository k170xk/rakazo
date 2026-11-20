import { describe, expect, it } from "vitest";
import { comparePlans, readPlanSnapshot, summary } from "./history-diff";

const encode = (plan: unknown) => new TextEncoder().encode(JSON.stringify(plan));

const base = {
  meta: { title: "Clinic" },
  categories: { default: { label: "General", color: "#76BF43" } },
  tasks: [
    { id: "t1", label: "Foundations", category: "default", start: "2026-03-02", end: "2026-03-10" },
    { id: "t2", label: "Windows", category: "default", start: "2026-03-11", end: "2026-03-20" },
  ],
};

describe("programme history", () => {
  it("names category, owner, priority, notes and baseline changes, not only dates", async () => {
    const before = await readPlanSnapshot(encode(base));
    const after = await readPlanSnapshot(
      encode({
        ...base,
        categories: { ...base.categories, structure: { label: "Structure", color: "#8B5CF6" } },
        tasks: [
          {
            ...base.tasks[0],
            category: "structure",
            assignee: "Keith Knox",
            priority: "high",
            notes: "Await GI report",
            baseline: { start: "2026-03-02", end: "2026-03-10" },
          },
          base.tasks[1],
        ],
      }),
    );
    const diff = comparePlans(before, after);
    expect(diff.categoriesAdded.map((category) => category.label)).toEqual(["Structure"]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]!.changes.map((change) => change.kind)).toEqual([
      "category",
      "owner",
      "priority",
      "notes",
      "baseline",
    ]);
    expect(summary(diff)).toBe("1 category changed, 1 task updated");
  });

  it("notices a reorder and reports an unchanged save as no changes", async () => {
    const before = await readPlanSnapshot(encode(base));
    const reordered = await readPlanSnapshot(encode({ ...base, tasks: [base.tasks[1], base.tasks[0]] }));
    expect(summary(comparePlans(before, reordered))).toBe("Tasks reordered");
    expect(summary(comparePlans(before, before))).toBe("No changes");
  });
});
