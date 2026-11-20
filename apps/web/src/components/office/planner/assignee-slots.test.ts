// @vitest-environment jsdom
import type { EvolvePersonOption } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { ASSIGN_ATTR, decorateAssignees, type AssigneeLabels } from "./assignee-slots";
import type { PlanDocument } from "./plan";

const directory = [
  { id: "1", name: "Sarah Chen", photo: "https://example.com/sarah.jpg", jobTitle: "Project Manager" },
  { id: "2", name: "Keith Knox", photo: null, jobTitle: null },
] as EvolvePersonOption[];

const labels: AssigneeLabels = {
  add: "Add an owner",
  evolve: (name, jobTitle) => (jobTitle ? `Owner: ${name} · ${jobTitle}` : `Owner: ${name}`),
  external: (name) => `Owner: ${name} (not in Evolve)`,
};

const plan: PlanDocument = {
  tasks: [
    { id: "a", label: "Design", category: "x", start: "2027-01-04", end: "2027-01-08", assignee: "Sarah Chen" },
    { id: "b", label: "Tender", category: "x", start: "2027-01-04", end: "2027-01-08", assignee: "keith knox" },
    { id: "c", label: "Survey", category: "x", start: "2027-01-04", end: "2027-01-08", assignee: "Mike Byrne" },
    { id: "d", label: "Handover", category: "x", start: "2027-01-04", end: "2027-01-08" },
  ],
};

function chart() {
  const root = document.createElement("div");
  root.innerHTML = plan
    .tasks!.map(
      (task) => `<div class="jantt-label-row" data-row-id="${task.id}"><div class="jantt-col-name">
        <span class="jantt-label-text">${task.label}</span>
        ${task.assignee ? '<span class="jantt-assignee-avatar" style="background: #38BDF8;">AB</span>' : ""}
      </div></div>`,
    )
    .join("");
  return root;
}

const row = (root: HTMLElement, id: string) => root.querySelector(`[data-row-id="${id}"]`)!;

describe("decorateAssignees", () => {
  it("shows Evolve photos, Evolve initials and outside owners differently", () => {
    const root = chart();
    decorateAssignees(root, plan, directory, true, labels);
    const sarah = row(root, "a").querySelector<HTMLElement>(".jantt-assignee-avatar")!;
    expect(sarah.dataset.look).toBe("photo");
    expect(sarah.querySelector("img")?.getAttribute("src")).toBe("https://example.com/sarah.jpg");
    expect(sarah.title).toBe("Owner: Sarah Chen · Project Manager");
    const keith = row(root, "b").querySelector<HTMLElement>(".jantt-assignee-avatar")!;
    expect(keith.dataset.look).toBe("evolve");
    expect(keith.textContent).toBe("AB");
    const mike = row(root, "c").querySelector<HTMLElement>(".jantt-assignee-avatar")!;
    expect(mike.dataset.look).toBe("external");
    expect(mike.title).toBe("Owner: Mike Byrne (not in Evolve)");
    expect(mike.getAttribute(ASSIGN_ATTR)).toBe("c");
  });

  it("adds a plus button only to editable tasks without an owner", () => {
    const root = chart();
    decorateAssignees(root, plan, directory, true, labels);
    expect(root.querySelectorAll(".planner-assign-add")).toHaveLength(1);
    expect(row(root, "d").querySelector(".planner-assign-add")?.getAttribute(ASSIGN_ATTR)).toBe("d");
    decorateAssignees(root, plan, directory, false, labels);
    expect(root.querySelectorAll(".planner-assign-add")).toHaveLength(0);
    expect(root.querySelector(`.jantt-assignee-avatar[${ASSIGN_ATTR}]`)).toBeNull();
  });

  it("changes nothing on a second pass, so the chart's mutation observer settles", () => {
    const root = chart();
    decorateAssignees(root, plan, directory, true, labels);
    const changes: MutationRecord[] = [];
    const observer = new MutationObserver((records) => changes.push(...records));
    observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    decorateAssignees(root, plan, directory, true, labels);
    changes.push(...observer.takeRecords());
    observer.disconnect();
    expect(changes).toEqual([]);
  });
});
