/**
 * Sample data for npm run dev. It has the same shape as Evolve's answers but is invented, so a
 * plugin is built and tested without any real person's data. Not included in the built plugin.
 */
import manifest from "../evolve-plugin.json";
import type { EvolveContext, Person, Project, Skill } from "./evolve";

const people: Person[] = [
  {
    id: 1,
    full_name: "Sample Person",
    email: "sample.person@example.com",
    job_title: "Senior Engineer",
    department: "Civil",
    office_id: "dublin",
  },
  {
    id: 2,
    full_name: "Alex Murphy",
    email: "alex.murphy@example.com",
    job_title: "Graduate Engineer",
    department: "Structures",
    office_id: "dublin",
  },
  {
    id: 3,
    full_name: "Jordan Kelly",
    email: "jordan.kelly@example.com",
    job_title: "Associate",
    department: "Mechanical",
    office_id: "london",
  },
  {
    id: 4,
    full_name: "Sam Byrne",
    email: "sam.byrne@example.com",
    job_title: "Technician",
    department: "Civil",
    office_id: "cork",
  },
];

const offices = [
  { id: "dublin", name: "Dublin", country: "Ireland" },
  { id: "cork", name: "Cork", country: "Ireland" },
  { id: "london", name: "London", country: "United Kingdom" },
];

const projects: Project[] = [
  {
    id: "p1",
    name: "Riverside Bridge Upgrade",
    job_number: "S101",
    client: "Sample County Council",
    project_summary: "Strengthening of a three-span bridge.",
    year_completed: 2024,
  },
  {
    id: "p2",
    name: "Harbour Office Campus",
    job_number: "S102",
    client: "Example Developments",
    project_summary: "Structural and civil design for two office blocks.",
    year_completed: 2025,
  },
  {
    id: "p3",
    name: "Greenway Phase 2",
    job_number: "S103",
    client: "Sample Transport Authority",
    project_summary: "8 km cycle and walking route.",
    year_completed: null,
  },
];

let skills: Skill[] = [
  {
    id: "s1",
    skill: "Bridge design",
    category: "Structures",
    skill_level: "Advanced",
    is_software: false,
  },
  {
    id: "s2",
    skill: "AutoCAD Civil 3D",
    category: "Software",
    skill_level: "Intermediate",
    is_software: true,
  },
];

const storage = new Map<string, unknown>(
  Object.entries(JSON.parse(localStorage.getItem("evolve-plugin-mock-storage") ?? "{}")),
);
const persist = () =>
  localStorage.setItem("evolve-plugin-mock-storage", JSON.stringify(Object.fromEntries(storage)));

const matches = (query: unknown, ...fields: (string | null)[]) => {
  const term = String(query ?? "")
    .trim()
    .toLowerCase();
  return term.length < 2 || fields.some((field) => field?.toLowerCase().includes(term));
};

const handlers: Record<string, (params: Record<string, unknown>) => unknown> = {
  "me.read": () => people[0],
  "directory.read": (params) =>
    String(params.query ?? "").trim().length < 2
      ? []
      : people
          .filter((p) => matches(params.query, p.full_name, p.email, p.job_title, p.department))
          .slice(0, Number(params.limit) || 10),
  "offices.read": () => offices,
  "projects.read": (params) =>
    projects.filter((p) => matches(params.query, p.name, p.job_number, p.client)),
  "cv.read": () => ({ skills, qualifications: [], bios: [] }),
  "storage.personal": (params) => {
    const op = String(params.op ?? "get");
    const key = String(params.key ?? "");
    if (op === "list")
      return [...storage].map(([k, value]) => ({
        key: k,
        value,
        updated_at: new Date().toISOString(),
      }));
    if (!key) throw new Error("A key is required.");
    if (op === "get") return storage.get(key) ?? null;
    if (op === "set") {
      storage.set(key, params.value ?? null);
      persist();
      return { saved: true };
    }
    if (op === "delete") {
      storage.delete(key);
      persist();
      return { deleted: true };
    }
    throw new Error("Unknown storage operation.");
  },
  "cv.write": (params) => {
    if (params.op === "addSkill") {
      const added: Skill = {
        id: `s${Date.now()}`,
        skill: String(params.skill ?? ""),
        category: (params.category as string) ?? null,
        skill_level: (params.skillLevel as string) ?? null,
        is_software: params.isSoftware === true,
      };
      skills = [...skills, added];
      return added;
    }
    if (params.op === "removeSkill") {
      skills = skills.filter((s) => s.id !== params.id);
      return { removed: true };
    }
    throw new Error("Unknown CV operation.");
  },
};

export function createMockBridge() {
  const context: EvolveContext = {
    user: { name: people[0]!.full_name },
    plugin: { slug: manifest.slug, name: manifest.name, version: manifest.version },
    scopes: manifest.scopes,
    preview: true,
  };
  return {
    ready: async () => context,
    context: () => context,
    async call(scope: string, params: Record<string, unknown> = {}) {
      if (!manifest.scopes.includes(scope)) {
        throw new Error(`"${scope}" is not in evolve-plugin.json, so Evolve would refuse it.`);
      }
      const handler = handlers[scope];
      if (!handler) throw new Error(`Evolve has no scope called "${scope}".`);
      await new Promise((resolve) => setTimeout(resolve, 150));
      return structuredClone(handler(params));
    },
  };
}
