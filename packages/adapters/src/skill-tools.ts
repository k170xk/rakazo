import type { SkillRecord, SkillSource } from "@rakazo/core";
import {
  buildSkillMd,
  findSkillByName,
  isSkillReadOnly,
  mergeBuiltinSkills,
  parseSkillMd,
} from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { availableInSpace } from "@rakazo/db";
import { enabledBuiltinAgentSkills } from "./builtin-skills.js";
import { companyAssistantConfig, companySkills } from "./company-policy.js";
import { evolveToolsNote } from "./evolve-company-tools.js";

export const SKILL_TOOL_NAMES = new Set([
  "skill_read",
  "skill_create",
  "skill_update",
  "skill_delete",
]);

/** Match CreateAgentSkillInput / UpdateAgentSkillInput / parseSkillMd bounds. */
const MAX_SKILL_CONTENT_CHARS = 100_000;
const MAX_SKILL_NAME_CHARS = 80;
const MAX_SKILL_DESCRIPTION_CHARS = 2000;

type SkillOwner = {
  spaceId: string;
  userId: string;
};

type AgentSkillRow = {
  id: string;
  name: string;
  description: string;
  content: string;
  source: string;
};

function asSource(value: string): SkillSource {
  if (value === "builtin" || value === "plugin" || value === "company" || value === "user") {
    return value;
  }
  return "user";
}

function toRecord(row: AgentSkillRow): SkillRecord & { id: string } {
  const source = asSource(row.source);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    content: row.content,
    source,
    readOnly: isSkillReadOnly(source),
  };
}

export function builtinAgentSkillRecords(
  assistantId?: string | null,
): Array<SkillRecord & { id: string }> {
  const config = companyAssistantConfig(assistantId);
  const attachedBuiltins = new Set(
    (config?.skills ?? [])
      .filter((entry) => entry.skillKey.startsWith("builtin:"))
      .map((entry) => entry.skillKey.slice("builtin:".length).toLowerCase()),
  );
  const agentDisabled = new Set((config?.disabledSkills ?? []).map((name) => name.toLowerCase()));
  return enabledBuiltinAgentSkills()
    .filter((skill) => {
      const lower = skill.name.toLowerCase();
      return !agentDisabled.has(lower) || attachedBuiltins.has(lower);
    })
    .map((skill) => ({
      id: `builtin:${skill.name}`,
      name: skill.name,
      description: skill.description,
      content: skill.content,
      source: "builtin" as const,
      readOnly: true,
    }));
}

/**
 * Company-defined skills visible to a run: every skill marked `availableToAll`, plus any
 * company skill attached (required or available) to the bot's default agent.
 */
export function companyAgentSkillRecords(
  assistantId?: string | null,
): Array<SkillRecord & { id: string }> {
  const all = companySkills();
  if (all.length === 0) return [];
  const config = companyAssistantConfig(assistantId);
  const attachedIds = new Set(
    (config?.skills ?? [])
      .filter((entry) => entry.skillKey.startsWith("company:"))
      .map((entry) => entry.skillKey.slice("company:".length)),
  );
  return all
    .filter((skill) => skill.availableToAll || attachedIds.has(skill.id))
    .map((skill) => ({
      id: `company:${skill.id}`,
      name: skill.name,
      description: skill.description,
      content: skill.content,
      source: "company" as const,
      readOnly: true,
    }));
}

/** All built-in and company skills available to a run without loading personal owner skills. */
export function sharedAgentSkillRecords(
  assistantId?: string | null,
): Array<SkillRecord & { id: string }> {
  return mergeBuiltinSkills(
    builtinAgentSkillRecords(assistantId),
    companyAgentSkillRecords(assistantId),
  );
}

/**
 * Applies a default agent's skill policy (attached company skills + per-agent disabled built-in
 * skills) to a preloaded skill list without hitting the database a second time.
 */
export function applyAssistantSkillPolicy(
  loaded: readonly (SkillRecord & { id: string })[],
  assistantId?: string | null,
): Array<SkillRecord & { id: string }> {
  const userAndPlugin = loaded.filter(
    (skill) => skill.source !== "builtin" && skill.source !== "company",
  );
  const company = companyAgentSkillRecords(assistantId);
  const nonBuiltin = mergeBuiltinSkills(userAndPlugin, company);
  return mergeBuiltinSkills(builtinAgentSkillRecords(assistantId), nonBuiltin);
}

/**
 * Resolves every skill attached as `mode: "required"` on the given default agent, in order.
 * Required skills are injected in full into the system prompt so the agent must always obey them.
 */
export function resolveAssistantRequiredSkills(
  assistantId: string | null | undefined,
): Array<SkillRecord & { id: string }> {
  const config = companyAssistantConfig(assistantId);
  const required = (config?.skills ?? []).filter((entry) => entry.mode === "required");
  if (required.length === 0) return [];
  const byCompanyId = new Map(companySkills().map((skill) => [skill.id, skill] as const));
  const byBuiltinName = new Map(
    enabledBuiltinAgentSkills().map((skill) => [skill.name.toLowerCase(), skill] as const),
  );
  const resolved: Array<SkillRecord & { id: string }> = [];
  const seen = new Set<string>();
  for (const entry of required) {
    if (seen.has(entry.skillKey)) continue;
    seen.add(entry.skillKey);
    if (entry.skillKey.startsWith("company:")) {
      const id = entry.skillKey.slice("company:".length);
      const skill = byCompanyId.get(id);
      if (skill) {
        resolved.push({
          id: `company:${skill.id}`,
          name: skill.name,
          description: skill.description,
          content: skill.content,
          source: "company",
          readOnly: true,
        });
      }
    } else if (entry.skillKey.startsWith("builtin:")) {
      const name = entry.skillKey.slice("builtin:".length).toLowerCase();
      const skill = byBuiltinName.get(name);
      if (skill) {
        resolved.push({
          id: `builtin:${skill.name}`,
          name: skill.name,
          description: skill.description,
          content: skill.content,
          source: "builtin",
          readOnly: true,
        });
      }
    }
  }
  return resolved;
}

/** Renders mandatory default-agent skills as a high-priority system instruction block. */
export function formatRequiredSkillsInstruction(
  skills: readonly (SkillRecord & { id: string })[],
): string | undefined {
  if (skills.length === 0) return undefined;
  const blocks = skills.map((skill) => {
    const parsed = parseSkillMd(skill.content);
    const body = "error" in parsed ? skill.content.trim() : parsed.body.trim();
    const unavailable = evolveToolsNote(skill.content);
    return [
      `### Required skill: ${skill.name}`,
      skill.description ? `Purpose: ${skill.description}` : undefined,
      body || skill.content.trim(),
      unavailable ? `Note: ${unavailable}` : undefined,
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [
    "Mandatory company skills for this agent — you MUST follow every rule in these skills on every response. Where a required skill disagrees with general house style about tone, formatting, structure, openings, pronouns or word choice, follow the required skill. Approval rules, privacy and security boundaries still win.",
    ...blocks,
  ].join("\n\n");
}

function rejectOversizedContent(content: string): string | undefined {
  if (content.length > MAX_SKILL_CONTENT_CHARS) {
    return `Skill content must be at most ${MAX_SKILL_CONTENT_CHARS} characters.`;
  }
  return undefined;
}

function rejectInvalidSkillFields(name: string, description: string): string | undefined {
  if (!name) return "Skill name is required.";
  if (!description) return "Skill description is required.";
  if (name.length > MAX_SKILL_NAME_CHARS) {
    return `Skill name must be at most ${MAX_SKILL_NAME_CHARS} characters.`;
  }
  if (description.length > MAX_SKILL_DESCRIPTION_CHARS) {
    return `Skill description must be at most ${MAX_SKILL_DESCRIPTION_CHARS} characters.`;
  }
  return undefined;
}

/**
 * A bot changes only skills that live in its own space alone: writing this space's details into
 * a skill other spaces read would carry them across the boundary.
 */
function onlyInSpace(owner: SkillOwner) {
  return {
    spaceId: owner.spaceId,
    userId: owner.userId,
    allSpaces: false,
    availableIn: { none: {} },
  };
}

const SHARED_SKILL_ERROR =
  "Could not change this skill. A skill available in other spaces can only be changed by the user.";

export async function listAgentSkillRecords(
  prisma: PrismaClient,
  owner: SkillOwner,
  options?: { assistantId?: string | null },
): Promise<Array<SkillRecord & { id: string }>> {
  const rows = await prisma.agentSkill.findMany({
    where: availableInSpace(owner),
    // Reference files are read one at a time through skill_read, never with the catalog.
    omit: { files: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const company = companyAgentSkillRecords(options?.assistantId);
  const nonBuiltin = mergeBuiltinSkills(rows.map(toRecord), company);
  return mergeBuiltinSkills(builtinAgentSkillRecords(options?.assistantId), nonBuiltin);
}

async function findOwnedSkill(
  prisma: PrismaClient,
  owner: SkillOwner,
  input: { skillId?: string; name?: string },
  options?: { assistantId?: string | null; nonOwnerChatRun?: boolean },
): Promise<(SkillRecord & { id: string }) | null> {
  const skills = options?.nonOwnerChatRun
    ? sharedAgentSkillRecords(options?.assistantId)
    : await listAgentSkillRecords(prisma, owner, options);
  if (input.skillId) {
    return skills.find((skill) => skill.id === input.skillId) ?? null;
  }
  if (input.name) return findSkillByName(skills, input.name) ?? null;
  return null;
}

/** The text files stored beside a skill's SKILL.md, keyed by relative path. */
export function skillFiles(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export async function skillReadFromTool(
  prisma: PrismaClient,
  owner: SkillOwner,
  input: { name?: string; skillId?: string; file?: string },
  options?: { assistantId?: string | null; nonOwnerChatRun?: boolean },
): Promise<Record<string, unknown>> {
  const skill = await findOwnedSkill(prisma, owner, input, options);
  if (!skill) return { error: "Skill not found." };
  const builtin = skill.id.startsWith("builtin:");
  const company = skill.id.startsWith("company:");
  const row =
    builtin || company
      ? null
      : await prisma.agentSkill.findFirst({
          where: { id: skill.id, ...availableInSpace(owner) },
          select: { files: true },
        });
  const files = builtin
    ? (enabledBuiltinAgentSkills().find((entry) => `builtin:${entry.name}` === skill.id)?.files ??
      {})
    : company
      ? {}
      : skillFiles(row?.files);
  const paths = Object.keys(files).sort();
  const wanted = input.file?.trim().replace(/^\.\//, "");
  if (wanted) {
    // Only exact stored paths resolve, so no path can reach outside the skill.
    const text = files[wanted];
    if (text === undefined) return { error: `No file "${wanted}" in this skill.`, files: paths };
    return { name: skill.name, file: wanted, content: text };
  }
  const unavailable = evolveToolsNote(skill.content);
  return {
    name: skill.name,
    description: skill.description,
    source: skill.source,
    readOnly: skill.readOnly,
    follow:
      "Follow this skill for the task. Where it disagrees with house style about how to do the task, including voice, pronouns, openings and word choice, follow this skill. The user's request, approval rules and security boundaries still win.",
    content: skill.content,
    ...(paths.length ? { files: paths } : {}),
    ...(unavailable ? { unavailable } : {}),
  };
}

export async function skillCreateFromTool(
  prisma: PrismaClient,
  owner: SkillOwner,
  input: { name?: string; description?: string; body?: string; content?: string },
): Promise<Record<string, unknown>> {
  let name = "";
  let description = "";
  let content = "";
  if (input.content?.trim()) {
    const parsed = parseSkillMd(input.content);
    if ("error" in parsed) return { error: parsed.error };
    name = parsed.name;
    description = parsed.description;
    content = buildSkillMd(parsed);
  } else {
    name = String(input.name ?? "").trim();
    description = String(input.description ?? "").trim();
    const body = String(input.body ?? "").trim();
    if (!name || !description) {
      return {
        error: "Provide name and description (and optional body), or full SKILL.md content.",
      };
    }
    const invalid = rejectInvalidSkillFields(name, description);
    if (invalid) return { error: invalid };
    content = buildSkillMd({ name, description, body });
  }

  const oversized = rejectOversizedContent(content);
  if (oversized) return { error: oversized };

  const existing = await findOwnedSkill(prisma, owner, { name });
  if (existing) return { error: `A skill named "${existing.name}" already exists.` };

  try {
    const row = await prisma.agentSkill.create({
      data: {
        spaceId: owner.spaceId,
        userId: owner.userId,
        name,
        description,
        content,
        source: "user",
      },
    });
    return {
      ok: true,
      id: row.id,
      name: row.name,
      description: row.description,
      hint: `Created skill. Mention /${row.name} so the user can open it.`,
    };
  } catch {
    return { error: "Could not create skill (name may already exist)." };
  }
}

export async function skillUpdateFromTool(
  prisma: PrismaClient,
  owner: SkillOwner,
  input: {
    name?: string;
    skillId?: string;
    newName?: string;
    description?: string;
    body?: string;
    content?: string;
  },
): Promise<Record<string, unknown>> {
  const existing = await findOwnedSkill(prisma, owner, {
    skillId: input.skillId,
    name: input.name,
  });
  if (!existing) return { error: "Skill not found." };
  if (existing.readOnly || existing.source !== "user" || existing.id.startsWith("builtin:")) {
    return { error: "Builtin and plugin skills are read-only." };
  }

  let nextContent = existing.content;
  let nextName = existing.name;
  let nextDescription = existing.description;

  if (input.content?.trim()) {
    const parsed = parseSkillMd(input.content);
    if ("error" in parsed) return { error: parsed.error };
    nextName = parsed.name;
    nextDescription = parsed.description;
    nextContent = buildSkillMd(parsed);
  } else {
    const prior = parseSkillMd(existing.content);
    if ("error" in prior) return { error: prior.error };
    // `name` is only a lookup key (see findOwnedSkill above); renames require `newName`.
    nextName = String(input.newName ?? existing.name).trim() || existing.name;
    nextDescription =
      input.description !== undefined ? String(input.description).trim() : existing.description;
    const body = input.body !== undefined ? String(input.body) : prior.body;
    const invalidFields = rejectInvalidSkillFields(nextName, nextDescription);
    if (invalidFields) return { error: invalidFields };
    nextContent = buildSkillMd({
      name: nextName,
      description: nextDescription,
      body,
      frontmatter: prior.frontmatter,
    });
  }

  const invalid = rejectInvalidSkillFields(nextName, nextDescription);
  if (invalid) return { error: invalid };
  const oversized = rejectOversizedContent(nextContent);
  if (oversized) return { error: oversized };

  if (nextName.toLowerCase() !== existing.name.toLowerCase()) {
    const clash = await findOwnedSkill(prisma, owner, { name: nextName });
    if (clash && clash.id !== existing.id) {
      return { error: `A skill named "${clash.name}" already exists.` };
    }
  }

  try {
    // Re-scope mutate to owner + user source so a stale id cannot cross tenants.
    const updated = await prisma.agentSkill.updateMany({
      where: { id: existing.id, ...onlyInSpace(owner), source: "user" },
      data: {
        name: nextName,
        description: nextDescription,
        content: nextContent,
      },
    });
    if (updated.count !== 1) return { error: SHARED_SKILL_ERROR };
    return { ok: true, id: existing.id, name: nextName, description: nextDescription };
  } catch {
    return { error: "Could not update skill." };
  }
}

export async function skillDeleteFromTool(
  prisma: PrismaClient,
  owner: SkillOwner,
  input: { name?: string; skillId?: string },
): Promise<Record<string, unknown>> {
  const existing = await findOwnedSkill(prisma, owner, input);
  if (!existing) return { error: "Skill not found." };
  if (existing.readOnly || existing.source !== "user" || existing.id.startsWith("builtin:")) {
    return { error: "Builtin and plugin skills are read-only." };
  }
  const deleted = await prisma.agentSkill.deleteMany({
    where: { id: existing.id, ...onlyInSpace(owner), source: "user" },
  });
  if (deleted.count !== 1) return { error: SHARED_SKILL_ERROR };
  return { ok: true, name: existing.name };
}
