import * as z from "zod";

/**
 * Evolve references: projects, people and exemplar tender responses picked in the composer's
 * References dialog, matching Evolve chat's ReferencesDialog. Evolve's datasheets, profiles
 * and tender_responses tables are the source; a sent set is kept on the message as a block.
 */

const ReferenceId = z.string().trim().min(1).max(64);
const ShortText = z.string().max(2_000);
const LongText = z.string().max(100_000);

/** The context budget Evolve's dialog measures selections against (20k characters). */
export const EVOLVE_REFERENCES_MAX_CONTEXT_CHARS = 20_000;
/** Evolve's people roles are required before references can be added. */
export const EVOLVE_REFERENCE_ROLE_MAX_LENGTH = 200;
const MAX_ITEMS = 100;
export const EVOLVE_REFERENCE_CV_MAX_LENGTH = 40_000;

export const EvolveReferenceProjectSchema = z.object({
  id: ReferenceId,
  name: ShortText,
  client: ShortText,
  value: ShortText,
  summary: LongText,
  image: z.string().url().max(2_000).optional(),
});
export type EvolveReferenceProject = z.infer<typeof EvolveReferenceProjectSchema>;

export const EvolveReferencePersonSchema = z.object({
  id: ReferenceId,
  name: ShortText,
  photo: z.string().url().max(2_000).optional(),
  role: z.string().max(EVOLVE_REFERENCE_ROLE_MAX_LENGTH).optional(),
  /** Their Evolve CV as text; the server fills it in when the reference is sent. */
  cv: z.string().max(EVOLVE_REFERENCE_CV_MAX_LENGTH).optional(),
});
export type EvolveReferencePerson = z.infer<typeof EvolveReferencePersonSchema>;

export const EvolveReferenceExemplarSchema = z.object({
  id: ReferenceId,
  response_text: LongText,
  title: ShortText.nullable().optional(),
  response_title: ShortText.nullable().optional(),
  category: ShortText.nullable().optional(),
  tags: z.array(ShortText).max(50).nullable().optional(),
  quality_score: z.number().nullable().optional(),
  tender_type: ShortText.nullable().optional(),
  sector: ShortText.nullable().optional(),
  word_count: z.number().nullable().optional(),
  complexity_level: ShortText.nullable().optional(),
});
export type EvolveReferenceExemplar = z.infer<typeof EvolveReferenceExemplarSchema>;

export const EvolveReferencesSchema = z.object({
  projects: z.array(EvolveReferenceProjectSchema).max(MAX_ITEMS).default([]),
  people: z.array(EvolveReferencePersonSchema).max(MAX_ITEMS).default([]),
  exemplars: z.array(EvolveReferenceExemplarSchema).max(MAX_ITEMS).default([]),
});
export type EvolveReferences = z.infer<typeof EvolveReferencesSchema>;

/** One project card in the dialog, as Evolve's useSupabaseProjects maps a datasheet row. */
export const EvolveProjectOptionSchema = z.object({
  id: ReferenceId,
  name: z.string(),
  client: z.string(),
  year: z.number(),
  description: z.string(),
  image: z.string(),
  value: z.string().nullable(),
  jobNumber: z.string().nullable(),
});
export type EvolveProjectOption = z.infer<typeof EvolveProjectOptionSchema>;

export const EvolveProjectPageSchema = z.object({
  projects: z.array(EvolveProjectOptionSchema),
  page: z.number().int().nonnegative(),
  nextPage: z.number().int().nonnegative().nullable(),
  prevPage: z.number().int().nonnegative().nullable(),
});
export type EvolveProjectPage = z.infer<typeof EvolveProjectPageSchema>;

/** One person in the dialog: an active Evolve profile. */
export const EvolvePersonOptionSchema = z.object({
  id: ReferenceId,
  name: z.string(),
  photo: z.string().nullable(),
  jobTitle: z.string().nullable(),
});
export type EvolvePersonOption = z.infer<typeof EvolvePersonOptionSchema>;

const CvRow = z.record(z.string(), z.unknown());

/** One person's CV as Evolve's evolve-assistants function returns it. */
export const EvolvePersonCvSchema = z.object({
  id: ReferenceId,
  profile: z.record(z.string(), z.unknown()),
  qualifications: z.array(CvRow).default([]),
  otherQualifications: z.array(CvRow).default([]),
  healthSafety: z.array(CvRow).default([]),
  employment: z.array(CvRow).default([]),
  skills: z.array(CvRow).default([]),
  languages: z.array(CvRow).default([]),
  roleBios: z.array(CvRow).default([]),
});
export type EvolvePersonCv = z.infer<typeof EvolvePersonCvSchema>;

function cvText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function cvYearMonth(value: unknown): string {
  const text = cvText(value);
  const match = /^(\d{4})-(\d{2})/.exec(text);
  return match ? `${match[2]}/${match[1]}` : text;
}

function cvQualification(row: Record<string, unknown>, withExpiry = false): string {
  const name = cvText(row.name);
  const details = [
    cvText(row.type),
    cvText(row.institution),
    cvYearMonth(row.graduation_date),
    withExpiry && cvText(row.expiry_date) ? `expires ${cvYearMonth(row.expiry_date)}` : "",
  ].filter(Boolean);
  return `${name}${details.length ? ` (${details.join(", ")})` : ""}`;
}

/** A person's whole Evolve CV as plain text for the model. */
export function evolvePersonCvText(cv: EvolvePersonCv): string {
  const p = cv.profile;
  const lines: string[] = [];
  const field = (label: string, value: unknown) => {
    const text = cvText(value);
    if (text) lines.push(`${label}: ${text}`);
  };
  field("CV role", p.cvRole);
  field("Job title", p.jobTitle);
  field("Grade", p.grade);
  field("Discipline", p.discipline);
  field("Department", p.department);
  field("Location", p.location);
  field("Joined OCSC", cvYearMonth(p.hireDate));
  if (p.chartered === true) lines.push("Chartered: yes");
  else if (cvText(p.chartershipInstitution)) {
    lines.push(
      `Working towards chartership: ${cvText(p.chartershipInstitution)}${cvText(p.chartershipTargetDate) ? ` (target ${cvYearMonth(p.chartershipTargetDate)})` : ""}`,
    );
  }
  field("LinkedIn", p.linkedin);
  field("Bio", p.bio);
  const section = (title: string, items: string[]) => {
    const kept = items.filter(Boolean);
    if (kept.length) lines.push(`${title}:`, ...kept.map((item) => `- ${item}`));
  };
  section(
    "Role bios",
    cv.roleBios.map((bio) => {
      const title = cvText(bio.role_title);
      const content = cvText(bio.bio_content);
      return content ? `${title ? `${title}: ` : ""}${content}` : "";
    }),
  );
  section(
    "Employment history",
    cv.employment.map((job) => {
      const end = job.is_current === true ? "present" : cvYearMonth(job.end_date);
      const dates = [cvYearMonth(job.start_date), end].filter(Boolean).join(" to ");
      const head = [cvText(job.role), cvText(job.company)].filter(Boolean).join(", ");
      const description = cvText(job.description);
      return `${head}${dates ? ` (${dates})` : ""}${description ? `: ${description}` : ""}`;
    }),
  );
  field("Experience", p.experience);
  section(
    "Professional qualifications",
    cv.qualifications.map((row) => cvQualification(row)),
  );
  section(
    "Other qualifications",
    cv.otherQualifications.map((row) => cvQualification(row)),
  );
  section(
    "Health and safety",
    cv.healthSafety.map((row) => cvQualification(row, true)),
  );
  field("Education", p.education);
  const skills = cv.skills
    .map((row) => {
      const skill = cvText(row.skill);
      const level = cvText(row.skill_level);
      return skill ? `${skill}${level ? ` (${level})` : ""}` : "";
    })
    .filter(Boolean);
  if (skills.length) lines.push(`Skills: ${skills.join(", ")}`);
  const languages = cv.languages
    .map((row) => {
      const language = cvText(row.language);
      const level = cvText(row.proficiency);
      return language ? `${language}${level ? ` (${level})` : ""}` : "";
    })
    .filter(Boolean);
  if (languages.length) lines.push(`Languages: ${languages.join(", ")}`);
  return lines.join("\n").slice(0, EVOLVE_REFERENCE_CV_MAX_LENGTH);
}

/** Which of the dialog's tabs this bot offers; Projects is always on when Evolve is linked. */
export const EvolveReferenceTabsSchema = z.object({
  available: z.boolean(),
  people: z.boolean(),
  exemplars: z.boolean(),
});
export type EvolveReferenceTabs = z.infer<typeof EvolveReferenceTabsSchema>;

export function hasEvolveReferences(references: EvolveReferences | undefined): boolean {
  return Boolean(
    references &&
      (references.projects.length > 0 ||
        references.people.length > 0 ||
        references.exemplars.length > 0),
  );
}

/** What Evolve shows for a references message; the model sees evolveReferencesPromptText. */
export const EVOLVE_REFERENCES_MESSAGE_TEXT = "Added references to conversation context";

function personPromptText(person: EvolveReferencePerson): string {
  const role = person.role?.trim();
  const lines = [`• ${person.name}`];
  if (role) {
    lines.push(
      `  - Role: ${role} (the role this person will hold here; it overrides any role or job title in their CV)`,
    );
  }
  const cv = person.cv?.trim();
  if (cv) lines.push("  - CV:", ...cv.split("\n").map((line) => `    ${line}`));
  return lines.join("\n");
}

/**
 * The text Evolve chat sends the model for a references message (useChatAssistant.ts). People
 * also carry their typed role, which overrides their CV, and their whole CV: Evolve requires a
 * role "for proper AI context" but leaves both out of its text.
 */
export function evolveReferencesPromptText(references: EvolveReferences): string {
  const { projects, people, exemplars } = references;
  return [
    projects.length > 0
      ? `Please use the following reference projects as immediate context for this conversation.\n\n${projects.map((p) => `• ${p.name}\n  - Client: ${p.client}\n  - Value: ${p.value}\n  - Summary: ${p.summary}`).join("\n\n")}`
      : "",
    people.length > 0
      ? `\n\nPlease use the following people as context for this conversation.\n\n${people.map(personPromptText).join("\n\n")}`
      : "",
    exemplars.length > 0
      ? `\n\nPlease use the following exemplar responses as context for this conversation.\n\n${exemplars.map((ex) => `• ${ex.title || ex.response_title || "Exemplar"}\n  - Text: ${ex.response_text}`).join("\n\n")}`
      : "",
  ].join("");
}

/** Characters a selection adds, counted the way Evolve's context meter counts them. */
export function evolveReferencesContextChars(references: EvolveReferences): number {
  let total = 0;
  for (const p of references.projects) {
    total += p.name.length + p.client.length + p.value.length + p.summary.length;
  }
  for (const p of references.people) total += p.name.length + (p.role ?? "").length;
  for (const ex of references.exemplars) {
    total +=
      (ex.title ?? "").length +
      (ex.response_title ?? "").length +
      ex.response_text.length +
      (ex.category ?? "").length +
      (ex.tender_type ?? "").length +
      (ex.sector ?? "").length +
      (ex.tags?.join(" ") ?? "").length;
  }
  return total;
}
