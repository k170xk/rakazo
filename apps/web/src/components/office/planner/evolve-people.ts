import type { Person } from "@jantt/core";
import type { EvolvePersonOption } from "@rakazo/contracts";
import type { PlanDocument } from "./plan";

/**
 * Task owners come from Evolve's CV profiles. A task stores the person's name in `assignee` (what
 * Jantt shows and edits); the plan's `people` list keeps the Evolve profile id for each name in use,
 * so the link survives renames elsewhere and the assistant can read whose CV a task points at.
 */
const EVOLVE_ID_PREFIX = "evolve:";

export type EvolvePlanPerson = Person & { evolveProfileId: string };

const key = (name: string) => name.trim().toLowerCase();

function isEvolvePerson(person: Person): person is EvolvePlanPerson {
  return person.id.startsWith(EVOLVE_ID_PREFIX);
}

function toPlanPerson(profile: EvolvePersonOption): EvolvePlanPerson {
  return {
    id: `${EVOLVE_ID_PREFIX}${profile.id}`,
    name: profile.name,
    ...(profile.jobTitle ? { role: profile.jobTitle } : {}),
    evolveProfileId: String(profile.id),
  };
}

/** The Evolve profile with exactly this name, ignoring case and spacing at the ends. */
export function findEvolvePerson(directory: readonly EvolvePersonOption[], name: string) {
  const wanted = key(name);
  return wanted ? directory.find((person) => key(person.name) === wanted) : undefined;
}

/** Profiles where every typed word appears in the name or job title, best matches first. */
export function matchEvolvePeople(directory: readonly EvolvePersonOption[], query: string, limit = 8) {
  const words = key(query).split(/\s+/).filter(Boolean);
  if (!words.length) return directory.slice(0, limit);
  const scored = directory.flatMap((person) => {
    const name = key(person.name);
    const haystack = `${name} ${key(person.jobTitle ?? "")}`;
    if (!words.every((word) => haystack.includes(word))) return [];
    const score = name.startsWith(words[0]!) ? 0 : name.split(/\s+/).some((part) => part.startsWith(words[0]!)) ? 1 : 2;
    return [{ person, score }];
  });
  return scored
    .sort((a, b) => a.score - b.score || a.person.name.localeCompare(b.person.name))
    .slice(0, limit)
    .map(({ person }) => person);
}

export type AssigneeOption =
  | { kind: "evolve"; person: EvolvePersonOption }
  | { kind: "name"; name: string }
  | { kind: "new"; name: string };

/**
 * Choices for a task's owner: people already on this programme first (Evolve or typed in), then
 * other Evolve profiles, then the typed text as a new name when it matches nobody exactly. Owners
 * outside the company, such as contractors and clients, are kept as plain names.
 */
export function assigneeOptions(
  directory: readonly EvolvePersonOption[],
  planAssignees: readonly string[],
  query: string,
  limit = 8,
): AssigneeOption[] {
  const words = key(query).split(/\s+/).filter(Boolean);
  const matches = (text: string) => words.every((word) => key(text).includes(word));
  const seen = new Set<string>();
  const options: AssigneeOption[] = [];
  const add = (option: AssigneeOption) => {
    const name = option.kind === "evolve" ? option.person.name : option.name;
    if (seen.has(key(name)) || options.length >= limit) return;
    seen.add(key(name));
    options.push(option);
  };
  for (const name of planAssignees) {
    if (!name.trim()) continue;
    const profile = findEvolvePerson(directory, name);
    if (!matches(profile ? `${profile.name} ${profile.jobTitle ?? ""}` : name)) continue;
    add(profile ? { kind: "evolve", person: profile } : { kind: "name", name: name.trim() });
  }
  for (const person of matchEvolvePeople(directory, query, limit)) add({ kind: "evolve", person });
  const typed = query.trim().replace(/\s+/g, " ");
  if (typed && !seen.has(key(typed))) {
    if (options.length >= limit) options.pop();
    options.push({ kind: "new", name: typed });
  }
  return options;
}

/** The plan as Jantt should see it: every Evolve profile listed, so owners show their job titles. */
export function withDirectoryPeople(plan: PlanDocument, directory: readonly EvolvePersonOption[]): PlanDocument {
  if (!directory.length) return plan;
  const own = (plan.people ?? []).filter((person) => !isEvolvePerson(person));
  return { ...plan, people: [...own, ...directory.map(toPlanPerson)] };
}

/** The plan to save: only the Evolve profiles some task is assigned to, never the whole directory. */
export function withAssignedPeople(plan: PlanDocument, directory: readonly EvolvePersonOption[]): PlanDocument {
  const assigned = new Set((plan.tasks ?? []).map((task) => key(task.assignee ?? "")).filter(Boolean));
  const current = plan.people ?? [];
  const own = current.filter((person) => !isEvolvePerson(person));
  const linked = new Map<string, EvolvePlanPerson>();
  for (const person of current) {
    if (isEvolvePerson(person) && assigned.has(key(person.name))) linked.set(key(person.name), person);
  }
  for (const name of assigned) {
    if (linked.has(name)) continue;
    const profile = findEvolvePerson(directory, name);
    if (profile) linked.set(name, toPlanPerson(profile));
  }
  const people = [...own, ...[...linked.values()].map(({ id, name, role, evolveProfileId }) => ({
    id,
    name,
    ...(role ? { role } : {}),
    evolveProfileId,
  }))];
  if (!people.length) {
    if (!plan.people) return plan;
    const { people: _drop, ...rest } = plan;
    return rest;
  }
  return { ...plan, people };
}
