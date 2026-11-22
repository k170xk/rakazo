import { randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import {
  BUILTIN_AGENT_SKILLS,
  builtinAgentTools,
  callEvolveAssistants,
  clearEvolveAccessCache,
  companyToolsWithDefaults,
  EvolvePluginsError,
  refreshCompanyPolicy,
} from "@rakazo/adapters";
import type {
  Actor,
  AdminDefaultAgent,
  AdminDefaultAgentCreateInput,
  AdminDefaultAgentsState,
  AdminDefaultAgentUpdateInput,
  AdminVectorStore,
  AdminVectorStoreFile,
  AdminVectorStoreUploadInput,
  CompanyAssistantConfig,
  CompanyAssistantModel,
  CompanySkill,
  CompanySkillCreateInput,
  CompanySkillUpdateInput,
  CompanyTools,
  EvolveAdminAssistant,
} from "@rakazo/contracts";
import {
  EvolveAdminAssistantReplySchema,
  EvolveAdminListReplySchema,
  EvolveVectorStoreFileReplySchema,
  EvolveVectorStoreFilesReplySchema,
  EvolveVectorStoreReplySchema,
  EvolveVectorStoresListReplySchema,
} from "@rakazo/contracts";
import type { Prisma } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { requireAdmin } from "./admins.js";
import { resolveSkillContent } from "./agent-skills.js";
import type { RouterDeps } from "./router.js";
import { actorEmail } from "./routes/bots.js";

const MAX_COMPANY_SKILLS = 100;

async function readCompanyTools(deps: Pick<RouterDeps, "prisma">): Promise<CompanyTools> {
  const row = await runAsSystem("read company tools", () =>
    deps.prisma.deploymentSettings.findUnique({
      where: { id: "default" },
      select: { companyTools: true },
    }),
  );
  return companyToolsWithDefaults(row?.companyTools);
}

async function saveCompanyTools(
  deps: Pick<RouterDeps, "prisma" | "secrets">,
  next: CompanyTools,
): Promise<void> {
  const json = next as unknown as Prisma.InputJsonValue;
  await runAsSystem("save company tools", () =>
    deps.prisma.deploymentSettings.upsert({
      where: { id: "default" },
      create: { id: "default", companyTools: json },
      update: { companyTools: json },
    }),
  );
  await refreshCompanyPolicy(deps.prisma, deps.secrets);
}

/** Calls Evolve's evolve-assistants edge function as the admin. */
async function callEvolveAsAdmin(
  deps: RouterDeps,
  actor: Actor,
  body: Record<string, unknown>,
  options?: { timeoutMs?: number },
): Promise<unknown> {
  await requireAdmin(deps, actor.userId);
  const email = await actorEmail(deps, actor);
  if (!deps.evolvePlugins || !email) {
    throw new ORPCError("BAD_REQUEST", { message: "Evolve is not linked to this server." });
  }
  try {
    return await callEvolveAssistants(deps.evolvePlugins, email, body, options);
  } catch (error) {
    if (
      error instanceof EvolvePluginsError &&
      (error.status === 400 || error.status === 403 || error.status === 404)
    ) {
      const code =
        error.status === 403 ? "FORBIDDEN" : error.status === 404 ? "NOT_FOUND" : "BAD_REQUEST";
      throw new ORPCError(code, { message: error.message });
    }
    getLogger().warn("evolve admin assistants call failed", {
      action: body.action,
      error: String(error),
    });
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Evolve could not be reached. Try again shortly.",
    });
  }
}

function normalizeConfig(config: CompanyAssistantConfig | undefined): CompanyAssistantConfig {
  if (!config) return {};
  const next: CompanyAssistantConfig = {};
  if (config.standingInstructions !== undefined) {
    const trimmed = config.standingInstructions.trim();
    if (trimmed) next.standingInstructions = trimmed;
  }
  if (config.skills && config.skills.length > 0) {
    const seen = new Set<string>();
    const deduped = [];
    for (const entry of config.skills) {
      const key = entry.skillKey.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push({ skillKey: key, mode: entry.mode });
    }
    if (deduped.length > 0) next.skills = deduped;
  }
  if (config.temperature !== undefined && config.temperature !== null) {
    next.temperature = Math.round(config.temperature * 100) / 100;
  }
  if (config.maxTokens !== undefined && config.maxTokens !== null) {
    next.maxTokens = config.maxTokens;
  }
  if (config.disabledBuiltinTools && config.disabledBuiltinTools.length > 0) {
    next.disabledBuiltinTools = [...new Set(config.disabledBuiltinTools)].sort();
  }
  if (config.disabledEvolveTools && config.disabledEvolveTools.length > 0) {
    next.disabledEvolveTools = [...new Set(config.disabledEvolveTools)].sort();
  }
  if (config.disabledSkills && config.disabledSkills.length > 0) {
    next.disabledSkills = [...new Set(config.disabledSkills)].sort();
  }
  if (config.hidden === true) next.hidden = true;
  return next;
}

function hasAnyConfig(config: CompanyAssistantConfig): boolean {
  return Object.keys(config).length > 0;
}

function mergeAdminAgent(raw: EvolveAdminAssistant, tools: CompanyTools): AdminDefaultAgent {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    evolveModel: raw.model,
    instructions: raw.instructions,
    systemInstructions: raw.systemInstructions,
    fileSearchEnabled: raw.fileSearchEnabled,
    vectorStoreIds: raw.vectorStoreIds,
    enablePeople: raw.enablePeople,
    enableResponses: raw.enableResponses,
    allowedGroupIds: raw.allowedGroupIds,
    allowedUsers: raw.allowedUsers,
    isLineManagerOnly: raw.isLineManagerOnly,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    rakazoModel: tools.assistantModels?.[raw.id] ?? null,
    config: tools.assistantConfigs?.[raw.id] ?? {},
  };
}

// ---------------------------------------------------------------------------
// Company Skills CRUD
// ---------------------------------------------------------------------------

export async function listCompanySkills(
  deps: Pick<RouterDeps, "prisma" | "env">,
  actor: Actor,
): Promise<CompanySkill[]> {
  await requireAdmin(deps, actor.userId);
  const tools = await readCompanyTools(deps);
  return [...(tools.companySkills ?? [])].sort((a, b) => a.name.localeCompare(b.name));
}

export async function createCompanySkill(
  deps: Pick<RouterDeps, "prisma" | "env" | "secrets">,
  actor: Actor,
  input: CompanySkillCreateInput,
): Promise<CompanySkill> {
  await requireAdmin(deps, actor.userId);
  const resolved = resolveSkillContent(input);
  const tools = await readCompanyTools(deps);
  const existing = tools.companySkills ?? [];
  if (existing.length >= MAX_COMPANY_SKILLS) {
    throw new ORPCError("BAD_REQUEST", {
      message: `At most ${MAX_COMPANY_SKILLS} company skills are allowed.`,
    });
  }
  const collision =
    existing.some((skill) => skill.name.toLowerCase() === resolved.name.toLowerCase()) ||
    BUILTIN_AGENT_SKILLS.some((skill) => skill.name.toLowerCase() === resolved.name.toLowerCase());
  if (collision) {
    throw new ORPCError("CONFLICT", { message: "A skill with that name already exists." });
  }
  const now = new Date().toISOString();
  const created: CompanySkill = {
    id: randomUUID(),
    name: resolved.name,
    description: resolved.description,
    content: resolved.content,
    availableToAll: input.availableToAll === true,
    ...(input.hiddenFromStaff === true ? { hiddenFromStaff: true } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await saveCompanyTools(deps, {
    ...tools,
    companySkills: [...existing, created],
  });
  return created;
}

export async function updateCompanySkill(
  deps: Pick<RouterDeps, "prisma" | "env" | "secrets">,
  actor: Actor,
  input: CompanySkillUpdateInput,
): Promise<CompanySkill> {
  await requireAdmin(deps, actor.userId);
  const tools = await readCompanyTools(deps);
  const existing = tools.companySkills ?? [];
  const index = existing.findIndex((skill) => skill.id === input.id);
  if (index < 0) {
    throw new ORPCError("NOT_FOUND", { message: "Company skill not found." });
  }
  const current = existing[index]!;
  const hasContentChange =
    input.content !== undefined ||
    input.name !== undefined ||
    input.description !== undefined ||
    input.body !== undefined;
  const resolved = hasContentChange
    ? resolveSkillContent({
        content: input.content,
        name: input.name,
        description: input.description,
        body: input.body,
        prior: { content: current.content },
      })
    : { name: current.name, description: current.description, content: current.content };

  const collision =
    existing.some(
      (skill) =>
        skill.id !== current.id && skill.name.toLowerCase() === resolved.name.toLowerCase(),
    ) ||
    BUILTIN_AGENT_SKILLS.some((skill) => skill.name.toLowerCase() === resolved.name.toLowerCase());
  if (collision) {
    throw new ORPCError("CONFLICT", { message: "A skill with that name already exists." });
  }

  const nextHiddenFromStaff =
    input.hiddenFromStaff !== undefined ? input.hiddenFromStaff : current.hiddenFromStaff;
  const updated: CompanySkill = {
    ...current,
    name: resolved.name,
    description: resolved.description,
    content: resolved.content,
    availableToAll: input.availableToAll ?? current.availableToAll,
    ...(nextHiddenFromStaff ? { hiddenFromStaff: true } : { hiddenFromStaff: undefined }),
    updatedAt: new Date().toISOString(),
  };
  if (!updated.hiddenFromStaff) delete updated.hiddenFromStaff;
  const nextSkills = [...existing];
  nextSkills[index] = updated;
  await saveCompanyTools(deps, { ...tools, companySkills: nextSkills });
  return updated;
}

export async function removeCompanySkill(
  deps: Pick<RouterDeps, "prisma" | "env" | "secrets">,
  actor: Actor,
  id: string,
): Promise<{ ok: true }> {
  await requireAdmin(deps, actor.userId);
  const tools = await readCompanyTools(deps);
  const existing = tools.companySkills ?? [];
  if (!existing.some((skill) => skill.id === id)) {
    throw new ORPCError("NOT_FOUND", { message: "Company skill not found." });
  }
  const skillKey = `company:${id}`;
  const nextConfigs: Record<string, CompanyAssistantConfig> = {};
  for (const [assistantId, config] of Object.entries(tools.assistantConfigs ?? {})) {
    const filteredSkills = (config.skills ?? []).filter((entry) => entry.skillKey !== skillKey);
    const cleaned = normalizeConfig({ ...config, skills: filteredSkills });
    if (hasAnyConfig(cleaned)) nextConfigs[assistantId] = cleaned;
  }
  await saveCompanyTools(deps, {
    ...tools,
    companySkills: existing.filter((skill) => skill.id !== id),
    assistantConfigs: nextConfigs,
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Default Agents CRUD (Evolve assistants + Rakazo model/config)
// ---------------------------------------------------------------------------

export async function listDefaultAgents(
  deps: RouterDeps,
  actor: Actor,
): Promise<AdminDefaultAgentsState> {
  const [reply, tools] = await Promise.all([
    callEvolveAsAdmin(deps, actor, { action: "admin.list" }),
    readCompanyTools(deps),
  ]);
  const parsed = EvolveAdminListReplySchema.safeParse(reply);
  if (!parsed.success) {
    getLogger().warn("evolve admin.list reply invalid", { issues: parsed.error.issues.length });
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Evolve returned default agents this server cannot read.",
    });
  }
  const companySkills = [...(tools.companySkills ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const builtinSkills = BUILTIN_AGENT_SKILLS.map((skill) => ({
    name: skill.name,
    description: skill.description,
  })).sort((a, b) => a.name.localeCompare(b.name));
  const builtinTools = builtinAgentTools
    .map((tool) => ({
      name: tool.name,
      description: tool.description.split(".")[0]?.trim() || tool.description.slice(0, 140),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    agents: parsed.data.assistants.map((assistant) => mergeAdminAgent(assistant, tools)),
    groups: parsed.data.groups,
    people: parsed.data.people,
    companySkills,
    builtinSkills,
    builtinTools,
  };
}

export async function createDefaultAgent(
  deps: RouterDeps,
  actor: Actor,
  input: AdminDefaultAgentCreateInput,
): Promise<AdminDefaultAgent> {
  const reply = await callEvolveAsAdmin(deps, actor, {
    action: "admin.create",
    name: input.name,
    description: input.description,
    model: input.evolveModel ?? input.rakazoModel?.modelId ?? "gpt-5",
    instructions: input.instructions,
    systemInstructions: input.systemInstructions ?? "",
    fileSearchEnabled: input.fileSearchEnabled,
    vectorStoreIds: input.vectorStoreIds,
    enablePeople: input.enablePeople,
    enableResponses: input.enableResponses,
    allowedGroupIds: input.allowedGroupIds,
    allowedUsers: input.allowedUsers,
    isLineManagerOnly: input.isLineManagerOnly,
  });
  const parsed = EvolveAdminAssistantReplySchema.safeParse(reply);
  if (!parsed.success) {
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Evolve returned an invalid default agent.",
    });
  }
  const created = parsed.data.assistant;
  clearEvolveAccessCache();

  const tools = await readCompanyTools(deps);
  const nextModels: Record<string, CompanyAssistantModel> = { ...(tools.assistantModels ?? {}) };
  if (input.rakazoModel) {
    nextModels[created.id] = input.rakazoModel;
  }
  const nextConfigs: Record<string, CompanyAssistantConfig> = { ...(tools.assistantConfigs ?? {}) };
  const normalized = normalizeConfig(input.config);
  if (hasAnyConfig(normalized)) {
    nextConfigs[created.id] = normalized;
  }
  const nextTools: CompanyTools = {
    ...tools,
    assistantModels: nextModels,
    assistantConfigs: nextConfigs,
  };
  await saveCompanyTools(deps, nextTools);
  return mergeAdminAgent(created, nextTools);
}

export async function updateDefaultAgent(
  deps: RouterDeps,
  actor: Actor,
  input: AdminDefaultAgentUpdateInput,
): Promise<AdminDefaultAgent> {
  const evolveBody: Record<string, unknown> = { action: "admin.update", id: input.id };
  if (input.name !== undefined) evolveBody.name = input.name;
  if (input.description !== undefined) evolveBody.description = input.description;
  if (input.evolveModel !== undefined) evolveBody.model = input.evolveModel;
  if (input.instructions !== undefined) evolveBody.instructions = input.instructions;
  if (input.systemInstructions !== undefined) {
    evolveBody.systemInstructions = input.systemInstructions;
  }
  if (input.fileSearchEnabled !== undefined) evolveBody.fileSearchEnabled = input.fileSearchEnabled;
  if (input.vectorStoreIds !== undefined) evolveBody.vectorStoreIds = input.vectorStoreIds;
  if (input.enablePeople !== undefined) evolveBody.enablePeople = input.enablePeople;
  if (input.enableResponses !== undefined) evolveBody.enableResponses = input.enableResponses;
  if (input.allowedGroupIds !== undefined) evolveBody.allowedGroupIds = input.allowedGroupIds;
  if (input.allowedUsers !== undefined) evolveBody.allowedUsers = input.allowedUsers;
  if (input.isLineManagerOnly !== undefined) evolveBody.isLineManagerOnly = input.isLineManagerOnly;

  const reply = await callEvolveAsAdmin(deps, actor, evolveBody);
  const parsed = EvolveAdminAssistantReplySchema.safeParse(reply);
  if (!parsed.success) {
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Evolve returned an invalid default agent.",
    });
  }
  const updated = parsed.data.assistant;
  clearEvolveAccessCache();

  const tools = await readCompanyTools(deps);
  let changedTools = false;
  const nextModels: Record<string, CompanyAssistantModel> = { ...(tools.assistantModels ?? {}) };
  if (input.rakazoModel !== undefined) {
    changedTools = true;
    if (input.rakazoModel === null) {
      delete nextModels[updated.id];
    } else {
      nextModels[updated.id] = input.rakazoModel;
    }
  }
  const nextConfigs: Record<string, CompanyAssistantConfig> = { ...(tools.assistantConfigs ?? {}) };
  if (input.config !== undefined) {
    changedTools = true;
    const normalized = normalizeConfig(input.config);
    if (hasAnyConfig(normalized)) {
      nextConfigs[updated.id] = normalized;
    } else {
      delete nextConfigs[updated.id];
    }
  }
  const nextTools: CompanyTools = changedTools
    ? { ...tools, assistantModels: nextModels, assistantConfigs: nextConfigs }
    : tools;
  if (changedTools) {
    await saveCompanyTools(deps, nextTools);
  }
  return mergeAdminAgent(updated, nextTools);
}

export async function removeDefaultAgent(
  deps: RouterDeps,
  actor: Actor,
  id: string,
): Promise<{ ok: true }> {
  await callEvolveAsAdmin(deps, actor, { action: "admin.delete", id });
  clearEvolveAccessCache();

  const tools = await readCompanyTools(deps);
  const nextModels = { ...(tools.assistantModels ?? {}) };
  const nextConfigs = { ...(tools.assistantConfigs ?? {}) };
  if (id in nextModels || id in nextConfigs) {
    delete nextModels[id];
    delete nextConfigs[id];
    await saveCompanyTools(deps, {
      ...tools,
      assistantModels: nextModels,
      assistantConfigs: nextConfigs,
    });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// OpenAI Vector Stores & Files (via Evolve admin)
// ---------------------------------------------------------------------------

export async function listVectorStores(
  deps: RouterDeps,
  actor: Actor,
): Promise<AdminVectorStore[]> {
  const reply = await callEvolveAsAdmin(deps, actor, { action: "admin.vectorStores.list" });
  const parsed = EvolveVectorStoresListReplySchema.safeParse(reply);
  if (!parsed.success) {
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Evolve returned vector stores this server cannot read.",
    });
  }
  return parsed.data.vectorStores;
}

export async function createVectorStore(
  deps: RouterDeps,
  actor: Actor,
  name: string,
): Promise<AdminVectorStore> {
  const reply = await callEvolveAsAdmin(deps, actor, {
    action: "admin.vectorStores.create",
    name,
  });
  const parsed = EvolveVectorStoreReplySchema.safeParse(reply);
  if (!parsed.success) {
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Evolve returned an invalid vector store.",
    });
  }
  return parsed.data.vectorStore;
}

export async function listVectorStoreFiles(
  deps: RouterDeps,
  actor: Actor,
  vectorStoreId: string,
): Promise<AdminVectorStoreFile[]> {
  const reply = await callEvolveAsAdmin(
    deps,
    actor,
    { action: "admin.vectorStores.files", vectorStoreId },
    { timeoutMs: 30_000 },
  );
  const parsed = EvolveVectorStoreFilesReplySchema.safeParse(reply);
  if (!parsed.success) {
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Evolve returned vector store files this server cannot read.",
    });
  }
  return parsed.data.files;
}

export async function uploadVectorStoreFile(
  deps: RouterDeps,
  actor: Actor,
  input: AdminVectorStoreUploadInput,
): Promise<AdminVectorStoreFile> {
  const reply = await callEvolveAsAdmin(
    deps,
    actor,
    {
      action: "admin.vectorStores.uploadFile",
      vectorStoreId: input.vectorStoreId,
      filename: input.filename,
      contentBase64: input.contentBase64,
      mimeType: input.mimeType,
    },
    { timeoutMs: 90_000 },
  );
  const parsed = EvolveVectorStoreFileReplySchema.safeParse(reply);
  if (!parsed.success) {
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Evolve returned an invalid uploaded file record.",
    });
  }
  return parsed.data.file;
}

export async function removeVectorStoreFile(
  deps: RouterDeps,
  actor: Actor,
  input: { vectorStoreId: string; fileId: string },
): Promise<{ ok: true }> {
  await callEvolveAsAdmin(deps, actor, {
    action: "admin.vectorStores.removeFile",
    vectorStoreId: input.vectorStoreId,
    fileId: input.fileId,
  });
  return { ok: true };
}
