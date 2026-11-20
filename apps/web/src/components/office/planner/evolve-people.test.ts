import { describe, expect, it } from "vitest";
import type { EvolvePersonOption } from "@rakazo/contracts";
import {
  assigneeOptions,
  findEvolvePerson,
  matchEvolvePeople,
  withAssignedPeople,
  withDirectoryPeople,
} from "./evolve-people";
import type { PlanDocument } from "./plan";

const directory = [
  { id: "1", name: "Sarah Chen", photo: null, jobTitle: "Project Manager" },
  { id: "2", name: "Keith Nolan", photo: null, jobTitle: "Director" },
  { id: "3", name: "Aoife Kenny", photo: null, jobTitle: "Senior Engineer" },
] as EvolvePersonOption[];

const plan = (assignees: (string | undefined)[], people?: PlanDocument["people"]): PlanDocument => ({
  tasks: assignees.map((assignee, index) => ({
    id: `t${index}`,
    label: `Task ${index}`,
    category: "default",
    start: "2027-01-04",
    end: "2027-01-08",
    ...(assignee ? { assignee } : {}),
  })),
  ...(people ? { people } : {}),
});

const label = (option: ReturnType<typeof assigneeOptions>[number]) =>
  option.kind === "evolve" ? `evolve:${option.person.name}` : `${option.kind}:${option.name}`;

describe("assigneeOptions", () => {
  it("lists people already on the programme first, linking those in Evolve", () => {
    const options = assigneeOptions(directory, ["Mike Byrne (contractor)", "keith nolan"], "", 4);
    expect(options.map(label)).toEqual([
      "name:Mike Byrne (contractor)",
      "evolve:Keith Nolan",
      "evolve:Sarah Chen",
      "evolve:Aoife Kenny",
    ]);
  });

  it("offers the typed text as a new name only when nobody matches it exactly", () => {
    expect(assigneeOptions(directory, [], "  Joe   Bloggs ").map(label)).toEqual(["new:Joe Bloggs"]);
    expect(assigneeOptions(directory, [], "sarah chen").map(label)).toEqual(["evolve:Sarah Chen"]);
    expect(assigneeOptions(directory, ["Mike Byrne"], "mike").map(label)).toEqual([
      "name:Mike Byrne",
      "new:mike",
    ]);
  });

  it("keeps the new-name choice even when the list is full", () => {
    const options = assigneeOptions(directory, [], "e", 2);
    expect(options).toHaveLength(2);
    expect(options.at(-1)).toEqual({ kind: "new", name: "e" });
  });
});

describe("matchEvolvePeople", () => {
  it("matches every word across name and job title", () => {
    expect(matchEvolvePeople(directory, "senior aoife").map((p) => p.name)).toEqual(["Aoife Kenny"]);
    expect(matchEvolvePeople(directory, "ken").map((p) => p.name)).toEqual(["Aoife Kenny"]);
  });

  it("puts first-name matches before other matches", () => {
    expect(matchEvolvePeople(directory, "k").map((p) => p.name)).toEqual(["Keith Nolan", "Aoife Kenny"]);
  });
});

describe("findEvolvePerson", () => {
  it("ignores case and outer spaces", () => {
    expect(findEvolvePerson(directory, "  sarah chen ")?.id).toBe("1");
    expect(findEvolvePerson(directory, "Sarah")).toBeUndefined();
  });
});

describe("withAssignedPeople", () => {
  it("stores the Evolve profile of each assigned person only", () => {
    const saved = withAssignedPeople(withDirectoryPeople(plan(["Sarah Chen", "A contractor"]), directory), directory);
    expect(saved.people).toEqual([
      { id: "evolve:1", name: "Sarah Chen", role: "Project Manager", evolveProfileId: "1" },
    ]);
  });

  it("keeps people that did not come from Evolve and drops unassigned profiles", () => {
    const own = { id: "p1", name: "Site team" };
    const stale = { id: "evolve:2", name: "Keith Nolan", evolveProfileId: "2" };
    expect(withAssignedPeople(plan([undefined], [own, stale]), directory).people).toEqual([own]);
  });

  it("leaves a plan with no people unchanged", () => {
    const original = plan(["Nobody known"]);
    expect(withAssignedPeople(original, directory)).toBe(original);
  });
});
