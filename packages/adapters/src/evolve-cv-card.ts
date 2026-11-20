import type { StaffCvChange } from "@rakazo/contracts";
import type { FleetCardSummary } from "./approval-ask.js";

type PreviewProject = {
  id?: unknown;
  job_number?: unknown;
  name?: unknown;
  client?: unknown;
  year?: unknown;
  summary?: unknown;
  value?: unknown;
  cover_url?: unknown;
};

export type StaffCvPreview = {
  step?: unknown;
  person?: { id?: unknown; name?: unknown; email?: unknown; role?: unknown } | null;
  matches?: unknown;
  bios?: unknown;
  selected_bio_id?: unknown;
  target_role?: unknown;
  special_mentions?: unknown;
  hide_images?: unknown;
  tailored?: unknown;
  projects?: unknown;
  suggestions?: unknown;
  other_projects?: unknown;
  roster?: unknown;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function projects(value: unknown): PreviewProject[] {
  return Array.isArray(value) ? (value as PreviewProject[]) : [];
}

function listed(value: unknown): StaffCvChange["projects"] {
  return projects(value).map((project) => ({
    id: text(project.id),
    jobNumber: text(project.job_number) || null,
    name: text(project.name) || "Project",
    client: text(project.client) || null,
    year: text(project.year) || null,
    value: text(project.value) || null,
    summary: text(project.summary).slice(0, 4000),
    imageUrl: text(project.cover_url) || null,
  }));
}

const STEPS = ["person", "projects", "mentions", "other"] as const;

/** The card for one step of a staff CV; its lines are what clients without the card show. */
export function staffCvCardSummary(preview: StaffCvPreview): FleetCardSummary | null {
  const main = listed(preview.projects);
  const named = text(preview.person?.name);
  const rawStep = text(preview.step);
  const explicit = STEPS.includes(rawStep as (typeof STEPS)[number]);
  // Only a CV preview. Other Evolve cards have neither a CV step nor a finished project list.
  if (!explicit && !(named && main.length > 0)) return null;
  const step: StaffCvChange["step"] = explicit ? (rawStep as StaffCvChange["step"]) : "other";
  const personId = Number(preview.person?.id);
  const change: StaffCvChange = {
    step,
    person: named
      ? {
          ...(Number.isInteger(personId) && personId > 0 ? { id: personId } : {}),
          name: named,
          email: text(preview.person?.email) || null,
          role: text(preview.person?.role) || null,
        }
      : null,
    matches: (Array.isArray(preview.matches) ? preview.matches : []).slice(0, 8).flatMap((row) => {
      const match = row as { id?: unknown; name?: unknown; email?: unknown; role?: unknown };
      const id = Number(match.id);
      const name = text(match.name);
      if (!Number.isInteger(id) || id <= 0 || !name) return [];
      return [{ id, name, email: text(match.email) || null, role: text(match.role) || null }];
    }),
    bios: (Array.isArray(preview.bios) ? preview.bios : []).slice(0, 20).flatMap((row) => {
      const bio = row as { id?: unknown; title?: unknown };
      const id = text(bio.id);
      const title = text(bio.title);
      return id && title ? [{ id, title }] : [];
    }),
    selectedBioId: text(preview.selected_bio_id) || null,
    targetRole: text(preview.target_role),
    specialMentions: text(preview.special_mentions),
    hideImages: preview.hide_images === true,
    tailored: preview.tailored === true,
    projects: main.slice(0, 8),
    suggestions: listed(preview.suggestions).slice(0, 25),
    otherProjects: listed(preview.other_projects).slice(0, 6),
    roster: (Array.isArray(preview.roster) ? preview.roster : []).slice(0, 6).flatMap((row) => {
      const person = row as {
        id?: unknown;
        name?: unknown;
        email?: unknown;
        role?: unknown;
        bio_id?: unknown;
      };
      const id = Number(person.id);
      const name = text(person.name);
      const role = text(person.role);
      if (!Number.isInteger(id) || id <= 0 || !name || !role) return [];
      return [
        {
          id,
          name,
          email: text(person.email) || null,
          role,
          ...(text(person.bio_id) ? { bioId: text(person.bio_id) } : {}),
        },
      ];
    }),
  };
  if (step === "other" && ((!named && change.roster.length === 0) || main.length === 0))
    return null;
  const names = change.roster.map((person) => person.name);
  const who = names.length > 1 ? names.join(", ") : (names[0] ?? change.person?.name);
  const title =
    step === "person"
      ? names.length > 1
        ? `CVs for ${who}`
        : who
          ? `Choose ${names[0] ?? who}'s role`
          : "Whose CVs are these?"
      : step === "projects"
        ? names.length > 1
          ? `Projects for these ${names.length} CVs`
          : `Projects for ${who}'s CV`
        : step === "mentions"
          ? names.length > 1
            ? `Special mentions for these ${names.length} CVs`
            : `Special mentions for ${who}`
          : names.length > 1
            ? `Create these ${names.length} CVs?`
            : `Create ${who}'s CV?`;
  const lines = [
    `Step: ${step}`,
    ...(names.length ? [`People: ${who}`] : who ? [`Person: ${who}`] : []),
    ...(change.targetRole ? [`Role: ${change.targetRole}`] : []),
    ...(change.projects.length
      ? [
          `Projects: ${change.projects.map((project) => project.jobNumber || project.name).join(", ")}`,
        ]
      : []),
    ...(change.specialMentions ? [`Special mentions: ${change.specialMentions}`] : []),
    ...(change.otherProjects.length
      ? [
          `Other projects: ${change.otherProjects.map((project) => project.jobNumber || project.name).join(", ")}`,
        ]
      : []),
  ];
  return { title, lines, onceOnly: true, staffCv: change };
}
