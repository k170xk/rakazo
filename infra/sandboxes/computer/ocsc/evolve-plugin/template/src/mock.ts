/**
 * Sample data for npm run dev. It has the same shape as Evolve's answers but is invented, so a
 * plugin is built and tested without any real person's data. Not included in the built plugin.
 * data.<source> scopes answer from mock-data.json: give each source the columns
 * evolve_plugin_scopes lists for it. Add ?theme=dark to the address, or use the switch in the
 * corner, to check dark mode.
 */
import manifest from "../evolve-plugin.json";
import type { DataResult, EvolveContext, Person, Skill, ThemeMode } from "./evolve";
import mockData from "./mock-data.json";

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

const dataSources = mockData as Record<string, Record<string, unknown>[]>;
let skills = (dataSources["data.cv_skills"] ?? []) as Skill[];

/** The same search, filters, sorting and paging Evolve applies, over the sample rows. */
function readSample(scope: string, params: Record<string, unknown>): DataResult {
  const all = scope === "data.cv_skills" ? skills : dataSources[scope];
  if (!all) throw new Error(`Add sample rows for "${scope}" to src/mock-data.json.`);
  const columns = Object.keys(all[0] ?? {});
  let rows = [...all] as Record<string, unknown>[];
  const term = String(params.search ?? "")
    .trim()
    .toLowerCase();
  if (term.length >= 2)
    rows = rows.filter((row) =>
      Object.values(row).some((v) => typeof v === "string" && v.toLowerCase().includes(term)),
    );
  for (const [column, value] of Object.entries((params.filters as Record<string, unknown>) ?? {})) {
    if (!columns.includes(column)) throw new Error(`"${column}" cannot be filtered on.`);
    rows = rows.filter((row) =>
      value === null ? row[column] == null : String(row[column]) === String(value),
    );
  }
  const orderBy = typeof params.orderBy === "string" ? params.orderBy : null;
  if (orderBy) {
    const dir = params.ascending === false ? -1 : 1;
    rows.sort((a, b) => String(a[orderBy] ?? "").localeCompare(String(b[orderBy] ?? "")) * dir);
  }
  const limit = Math.min(Math.max(Number(params.limit) || 50, 1), 200);
  const offset = Math.max(Number(params.offset) || 0, 0);
  return {
    rows: rows.slice(offset, offset + limit),
    columns,
    hasMore: rows.length > offset + limit,
    limit,
    offset,
  };
}

const themeListeners = new Set<(theme: { mode: ThemeMode }) => void>();
let mode: ThemeMode =
  new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";

function applyMode(next: ThemeMode) {
  mode = next;
  document.documentElement.classList.toggle("dark", mode === "dark");
  for (const listener of themeListeners) listener({ mode });
}

/** A dev-only switch, standing in for Evolve's own dark mode setting. */
function addThemeSwitch() {
  const button = document.createElement("button");
  const label = () => (mode === "dark" ? "Light mode" : "Dark mode");
  button.textContent = label();
  button.style.cssText =
    "position:fixed;right:12px;bottom:12px;z-index:9999;font:500 12px system-ui;padding:6px 10px;border-radius:6px;border:1px solid #888;background:#222;color:#fff;opacity:.8;cursor:pointer";
  button.onclick = () => {
    applyMode(mode === "dark" ? "light" : "dark");
    button.textContent = label();
  };
  document.body.appendChild(button);
}

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
  applyMode(mode);
  addThemeSwitch();
  const context = (): EvolveContext => ({
    user: { name: people[0]!.full_name },
    plugin: { slug: manifest.slug, name: manifest.name, version: manifest.version },
    scopes: manifest.scopes,
    preview: true,
    theme: { mode },
  });
  return {
    ready: async () => context(),
    context,
    onTheme(listener: (theme: { mode: ThemeMode }) => void) {
      themeListeners.add(listener);
      return () => themeListeners.delete(listener);
    },
    async call(scope: string, params: Record<string, unknown> = {}) {
      if (!manifest.scopes.includes(scope)) {
        throw new Error(`"${scope}" is not in evolve-plugin.json, so Evolve would refuse it.`);
      }
      const handler = scope.startsWith("data.")
        ? (p: Record<string, unknown>) => readSample(scope, p)
        : handlers[scope];
      if (!handler) throw new Error(`Evolve has no scope called "${scope}".`);
      await new Promise((resolve) => setTimeout(resolve, 150));
      return structuredClone(handler(params));
    },
  };
}
