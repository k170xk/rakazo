import { ORPCError } from "@orpc/server";
import {
  BUILTIN_AGENT_SKILLS,
  COMPANY_MODEL_SECRET_RECORD,
  chatAttachmentBytesByPerson,
  companyFeatures,
  companyModel,
  companyToolsWithDefaults,
  effectiveComputerAccess,
  listCompanyVaultItems,
  listPiCatalog,
  nextCleanupSlot,
  pageUrlOrigin,
  refreshCompanyPolicy,
  removeCompanyVaultItem,
  resolveEnvironmentDeploymentModel,
  serverDisk,
  storeCompanyVaultItem,
  verifyCatalogProviderApiKey,
  videoRenderLoad,
  videoRenderSlots,
} from "@rakazo/adapters";
import type {
  Actor,
  BotSecretMetadata,
  CompanyAdminState,
  CompanyComputersState,
  CompanyFeatureId,
  CompanyFeatures,
  CompanyModelInput,
  CompanyTools,
  CompanyToolsState,
  CompanyVaultPutInput,
  ComputerAccess,
  ThinkingLevel,
} from "@rakazo/contracts";
import {
  BotSecretAuth,
  ComputerAccessSchema,
  canonicalPiProviderId,
  companyFeaturesFrom,
  FileCleanupResultSchema,
  ThinkingLevelSchema,
} from "@rakazo/contracts";
import type { Prisma } from "@rakazo/db";
import { findDefaultVoiceCredential, runAsSystem } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { isAdmin, requireAdmin } from "./admins.js";
import type { RouterDeps } from "./router.js";
import { companyVoiceOwner } from "./voice.js";

type CompanyAdminDeps = Pick<
  RouterDeps,
  "prisma" | "secrets" | "modelConnectionFetch" | "evolveTools"
> & {
  env: Pick<RouterDeps["env"], "adminEmails">;
  dataDir?: string;
};

const FEATURE_OFF: Record<CompanyFeatureId, string> = {
  computers: "Computers are turned off for your company.",
  connectedApps: "Connected apps are turned off for your company.",
  mcpServers: "Custom MCP servers are turned off for your company.",
  plugins: "Plugins are turned off for your company.",
  messaging: "Messaging apps are turned off for your company.",
  routines: "Routines are turned off for your company.",
  memberModels: "Your administrator chooses the models for your company.",
  evolvePlugins: "Building Evolve plugins is turned off for your company.",
  cursorAgents: "Cursor cloud agents are turned off for your company.",
  evolveTools: "Evolve's tools are turned off for your company.",
  staffIntegrations: "Connecting apps and plugins is coming soon.",
  voice: "Voice is turned off for your company.",
  sendWithEnter: "Your administrator sets how Enter works in chats.",
  streamReplies: "Your administrator sets whether replies stream.",
  toolActivity: "Your administrator sets whether tool activity shows.",
  webImages: "Your administrator sets whether web images load automatically.",
  accountData: "Exporting, importing and deleting accounts is turned off for your company.",
  personalVault: "Personal vaults are turned off for your company.",
  staffSkills:
    "Writing skills, browsing skill packs and adding them from GitHub is turned off for your company.",
  chatFileSearch: "Searching chat files is turned off for your company.",
};

/** Switches that only limit members; admins keep these so they can configure and test. */
const ADMIN_EXEMPT: ReadonlySet<CompanyFeatureId> = new Set([
  "memberModels",
  "staffIntegrations",
  "staffSkills",
]);

/** Fails a member's request for something the company turned off; admins keep model choice and integrations. */
export async function requireCompanyFeature(
  deps: Pick<RouterDeps, "prisma"> & { env: Pick<RouterDeps["env"], "adminEmails"> },
  actor: Pick<Actor, "userId">,
  feature: CompanyFeatureId,
): Promise<void> {
  if (companyFeatures()[feature]) return;
  if (ADMIN_EXEMPT.has(feature) && (await isAdmin(deps, actor.userId))) return;
  throw new ORPCError("FORBIDDEN", { message: FEATURE_OFF[feature] });
}

function readSettings(deps: Pick<RouterDeps, "prisma">) {
  return runAsSystem("read the company policy", () =>
    deps.prisma.deploymentSettings.findUnique({
      where: { id: "default" },
      select: {
        companyFeatures: true,
        companyTools: true,
        defaultModelProvider: true,
        defaultModelId: true,
        deploymentModelCredentialCipher: true,
        companyModelUpdatedAt: true,
        companyThinkingLevel: true,
        fileCleanupLastRunAt: true,
        fileCleanupLastResult: true,
        fileCleanupRequestedAt: true,
        updatedAt: true,
      },
    }),
  );
}

export async function companyAdminState(
  deps: CompanyAdminDeps,
  actor: Actor,
): Promise<CompanyAdminState> {
  await requireAdmin(deps, actor.userId);
  const [row, accounts, owners] = await Promise.all([
    readSettings(deps),
    runAsSystem("count accounts", () => deps.prisma.user.count()),
    runAsSystem("count accounts with their own models", () =>
      deps.prisma.userModelCredential.findMany({ distinct: ["userId"], select: { userId: true } }),
    ),
  ]);
  const saved =
    row?.defaultModelProvider && row.defaultModelId && row.deploymentModelCredentialCipher
      ? { provider: row.defaultModelProvider, modelId: row.defaultModelId }
      : null;
  const live = companyModel();
  const providerName =
    saved && listPiCatalog().find((entry) => entry.provider === saved.provider)?.providerName;
  const environment = resolveEnvironmentDeploymentModel();
  return {
    model: saved
      ? {
          ...saved,
          providerName: providerName ?? null,
          keyHint: live?.provider === saved.provider ? live.key.slice(-4) : null,
          updatedAt: (row?.companyModelUpdatedAt ?? row?.updatedAt ?? new Date()).toISOString(),
        }
      : null,
    thinkingLevel: ThinkingLevelSchema.safeParse(row?.companyThinkingLevel).data ?? null,
    assistantModels: companyToolsWithDefaults(row?.companyTools).assistantModels ?? {},
    staffApps: companyToolsWithDefaults(row?.companyTools).staffApps ?? null,
    environmentModel: environment.configured
      ? { provider: environment.provider, modelId: environment.model }
      : null,
    features: companyFeaturesFrom(row?.companyFeatures),
    tools: toolsState(deps, companyToolsWithDefaults(row?.companyTools)),
    computers: await computersState(deps, companyToolsWithDefaults(row?.companyTools), row),
    admins: deps.env.adminEmails ?? [],
    voice: await voiceState(deps, actor),
    staff: { accounts, withOwnModels: owners.length },
  };
}

async function computersState(
  deps: CompanyAdminDeps,
  policy: CompanyTools,
  cleanup: {
    fileCleanupLastRunAt: Date | null;
    fileCleanupLastResult: unknown;
    fileCleanupRequestedAt: Date | null;
  } | null,
): Promise<CompanyComputersState> {
  const [people, runningComputers, load, homes, disk] = await Promise.all([
    runAsSystem("list computer access", () =>
      deps.prisma.user.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, email: true, computerAccess: true, storageLimitMb: true },
      }),
    ),
    runAsSystem("count running computers", () =>
      deps.prisma.computer.count({ where: { state: "running" } }),
    ),
    videoRenderLoad(deps.prisma),
    runAsSystem("read computer storage", () =>
      deps.prisma.computer.groupBy({
        by: ["userId"],
        where: { homeBytes: { not: null } },
        _sum: { homeBytes: true },
      }),
    ),
    serverDisk(deps.dataDir),
  ]);
  const used = new Map(homes.map((row) => [row.userId, Number(row._sum.homeBytes ?? 0n)]));
  for (const row of await chatAttachmentBytesByPerson(deps.prisma)) {
    used.set(row.userId, (used.get(row.userId) ?? 0) + Number(row.bytes));
  }
  const computersOn = companyFeatures().computers;
  return {
    defaultAccess: policy.defaultComputerAccess,
    people: people.map((person) => {
      const access = ComputerAccessSchema.safeParse(person.computerAccess);
      const stored = access.success ? access.data : null;
      return {
        userId: person.id,
        name: person.name,
        email: person.email,
        access: stored,
        effective: computersOn ? (stored ?? policy.defaultComputerAccess) : "none",
        storageLimitMb: person.storageLimitMb,
        effectiveStorageLimitMb: person.storageLimitMb ?? policy.defaultStorageLimitMb,
        storageUsedBytes: used.get(person.id) ?? null,
      };
    }),
    capacity: {
      runningComputers,
      videoSlots: videoRenderSlots(),
      videoRendering: load.rendering,
      videoQueued: load.queued,
    },
    storage: {
      fileRetentionDays: policy.fileRetentionDays,
      defaultStorageLimitMb: policy.defaultStorageLimitMb,
      chatFileRetentionDays: policy.chatFileRetentionDays,
      cleanup: cleanupState(policy, cleanup),
      disk: disk && { usedBytes: disk.usedBytes, totalBytes: disk.totalBytes },
    },
  };
}

/** One person's storage limit; null returns them to the company default. */
export async function setStorageLimit(
  deps: CompanyAdminDeps,
  actor: Actor,
  input: { userId: string; limitMb: number | null },
): Promise<CompanyAdminState> {
  await requireAdmin(deps, actor.userId);
  const updated = await runAsSystem("save storage limit", () =>
    deps.prisma.user.updateMany({
      where: { id: input.userId },
      data: { storageLimitMb: input.limitMb },
    }),
  );
  if (!updated.count) throw new ORPCError("NOT_FOUND", { message: "No such person." });
  getLogger().info("company_admin.storage_limit_saved", {
    userId: input.userId,
    limitMb: input.limitMb,
    by: actor.userId,
  });
  return companyAdminState(deps, actor);
}

function cleanupState(
  policy: CompanyTools,
  row: {
    fileCleanupLastRunAt: Date | null;
    fileCleanupLastResult: unknown;
    fileCleanupRequestedAt: Date | null;
  } | null,
): CompanyComputersState["storage"]["cleanup"] {
  const lastRunAt = row?.fileCleanupLastRunAt ?? null;
  const requestedAt = row?.fileCleanupRequestedAt ?? null;
  const next = nextCleanupSlot(policy, Date.now());
  return {
    schedule: policy.fileCleanupSchedule,
    hour: policy.fileCleanupHour,
    weekday: policy.fileCleanupWeekday,
    lastRunAt: lastRunAt?.toISOString() ?? null,
    lastResult: FileCleanupResultSchema.safeParse(row?.fileCleanupLastResult).data ?? null,
    nextRunAt: next === null ? null : new Date(next).toISOString(),
    requested: Boolean(requestedAt && (!lastRunAt || requestedAt > lastRunAt)),
  };
}

/** Asks the worker to clean up now; it picks the request up within a minute. */
export async function requestFileCleanup(
  deps: CompanyAdminDeps,
  actor: Actor,
): Promise<CompanyAdminState> {
  await requireAdmin(deps, actor.userId);
  await runAsSystem("request a file cleanup", () =>
    deps.prisma.deploymentSettings.upsert({
      where: { id: "default" },
      create: { id: "default", fileCleanupRequestedAt: new Date() },
      update: { fileCleanupRequestedAt: new Date() },
    }),
  );
  getLogger().info("company_admin.file_cleanup_requested", { by: actor.userId });
  return companyAdminState(deps, actor);
}

/** One person's level; null returns them to the company default. */
export async function setComputerAccess(
  deps: CompanyAdminDeps,
  actor: Actor,
  input: { userId: string; access: ComputerAccess | null },
): Promise<CompanyAdminState> {
  await requireAdmin(deps, actor.userId);
  const updated = await runAsSystem("save computer access", () =>
    deps.prisma.user.updateMany({
      where: { id: input.userId },
      data: { computerAccess: input.access },
    }),
  );
  if (!updated.count) throw new ORPCError("NOT_FOUND", { message: "No such person." });
  getLogger().info("company_admin.computer_access_saved", {
    userId: input.userId,
    access: input.access,
    by: actor.userId,
  });
  return companyAdminState(deps, actor);
}

export async function computerAccessOf(
  deps: Pick<RouterDeps, "prisma">,
  actor: Pick<Actor, "userId">,
) {
  const user = await runAsSystem("read computer access", () =>
    deps.prisma.user.findUnique({ where: { id: actor.userId }, select: { computerAccess: true } }),
  );
  return effectiveComputerAccess(user?.computerAccess);
}

/** Fails a request that drives a computer directly, such as its screen or terminal, without Full access. */
export async function requireFullComputer(
  deps: Pick<RouterDeps, "prisma">,
  actor: Pick<Actor, "userId">,
): Promise<void> {
  if ((await computerAccessOf(deps, actor)) === "full") return;
  throw new ORPCError("FORBIDDEN", {
    message: "Your administrator has not given you full computer access.",
  });
}

/**
 * Admins keep full computer access when levels arrive, so a new company default never locks
 * them out of their own computers; they can change their own level afterwards.
 */
export async function keepAdminsOnFullComputers(
  deps: Pick<RouterDeps, "prisma"> & { env: Pick<RouterDeps["env"], "adminEmails"> },
): Promise<void> {
  const admins = deps.env.adminEmails ?? [];
  if (!admins.length) return;
  await runAsSystem("keep admins on full computers", () =>
    deps.prisma.user.updateMany({
      where: {
        email: { in: admins, mode: "insensitive" },
        emailVerified: true,
        computerAccess: null,
      },
      data: { computerAccess: "full" },
    }),
  );
}

function toolsState(deps: CompanyAdminDeps, policy: CompanyTools): CompanyToolsState {
  const offSkills = new Set(policy.disabledSkills.map((name) => name.toLowerCase()));
  const evolve = deps.evolveTools?.health() ?? {
    status: "not-configured" as const,
    tools: [],
    checkedAt: null,
    error: null,
  };
  return {
    skills: BUILTIN_AGENT_SKILLS.map((skill) => ({
      name: skill.name,
      description: skill.description,
      enabled: !offSkills.has(skill.name.toLowerCase()),
    })),
    evolve: {
      ...evolve,
      tools: evolve.tools.map((tool) => ({
        ...tool,
        enabled: !policy.disabledTools.includes(tool.name),
      })),
    },
  };
}

export async function setCompanyModel(
  deps: CompanyAdminDeps,
  actor: Actor,
  input: CompanyModelInput,
): Promise<CompanyAdminState> {
  await requireAdmin(deps, actor.userId);
  const provider = canonicalPiProviderId(input.provider);
  const entry = listPiCatalog().find(
    (candidate) => candidate.provider === provider && candidate.id === input.modelId,
  );
  if (!entry) throw new ORPCError("BAD_REQUEST", { message: "Choose a model from the list." });
  if (entry.auth === "oauth")
    throw new ORPCError("BAD_REQUEST", {
      message: "This model needs a personal sign-in. Choose a provider that takes an API key.",
    });
  const row = await readSettings(deps);
  let ciphertext = row?.deploymentModelCredentialCipher ?? null;
  if (input.apiKey) {
    try {
      await verifyCatalogProviderApiKey(
        { provider, apiKey: input.apiKey },
        deps.modelConnectionFetch,
        AbortSignal.timeout(20_000),
      );
    } catch {
      // Provider errors can echo the key back.
      throw new ORPCError("BAD_REQUEST", {
        message: `${entry.providerName} did not accept this key.`,
      });
    }
    const stored = await deps.secrets.put(
      input.apiKey,
      {
        operationId: "company-admin.model",
        traceId: "company-admin.model",
        spaceId: actor.spaceId,
        userId: actor.userId,
        signal: AbortSignal.timeout(20_000),
      },
      { recordId: COMPANY_MODEL_SECRET_RECORD },
    );
    ciphertext = stored.ciphertext;
  } else if (!ciphertext || row?.defaultModelProvider !== provider) {
    throw new ORPCError("BAD_REQUEST", { message: `Enter an API key for ${entry.providerName}.` });
  }
  const data = {
    defaultModelProvider: provider,
    defaultModelId: entry.id,
    deploymentModelCredentialCipher: ciphertext,
    companyModelUpdatedAt: new Date(),
  };
  await runAsSystem("save the company model", () =>
    deps.prisma.deploymentSettings.upsert({
      where: { id: "default" },
      create: { id: "default", ...data },
      update: data,
    }),
  );
  if (
    input.apiKey &&
    row?.deploymentModelCredentialCipher &&
    row.deploymentModelCredentialCipher !== ciphertext
  ) {
    await deps.secrets
      .delete(row.deploymentModelCredentialCipher, COMPANY_MODEL_SECRET_RECORD)
      .catch(() => undefined);
  }
  getLogger().info("company_admin.model_saved", { provider, modelId: entry.id, by: actor.userId });
  await refreshCompanyPolicy(deps.prisma, deps.secrets);
  return companyAdminState(deps, actor);
}

export async function clearCompanyModel(
  deps: CompanyAdminDeps,
  actor: Actor,
): Promise<CompanyAdminState> {
  await requireAdmin(deps, actor.userId);
  const row = await readSettings(deps);
  await runAsSystem("clear the company model", () =>
    deps.prisma.deploymentSettings.updateMany({
      where: { id: "default" },
      data: {
        defaultModelProvider: null,
        defaultModelId: null,
        deploymentModelCredentialCipher: null,
        companyModelUpdatedAt: new Date(),
      },
    }),
  );
  if (row?.deploymentModelCredentialCipher) {
    await deps.secrets
      .delete(row.deploymentModelCredentialCipher, COMPANY_MODEL_SECRET_RECORD)
      .catch(() => undefined);
  }
  getLogger().info("company_admin.model_cleared", { by: actor.userId });
  await refreshCompanyPolicy(deps.prisma, deps.secrets);
  return companyAdminState(deps, actor);
}

/** How hard every bot thinks on the company model; null leaves it to the model. */
export async function setCompanyThinkingLevel(
  deps: CompanyAdminDeps,
  actor: Actor,
  thinkingLevel: ThinkingLevel | null,
): Promise<CompanyAdminState> {
  await requireAdmin(deps, actor.userId);
  await runAsSystem("save the company thinking level", () =>
    deps.prisma.deploymentSettings.upsert({
      where: { id: "default" },
      create: { id: "default", companyThinkingLevel: thinkingLevel },
      update: { companyThinkingLevel: thinkingLevel },
    }),
  );
  getLogger().info("company_admin.thinking_level_saved", { thinkingLevel, by: actor.userId });
  await refreshCompanyPolicy(deps.prisma, deps.secrets);
  return companyAdminState(deps, actor);
}

export async function setCompanyFeatures(
  deps: CompanyAdminDeps,
  actor: Actor,
  input: Partial<CompanyFeatures>,
): Promise<CompanyAdminState> {
  await requireAdmin(deps, actor.userId);
  const row = await readSettings(deps);
  const features = { ...companyFeaturesFrom(row?.companyFeatures), ...input };
  await runAsSystem("save the company features", () =>
    deps.prisma.deploymentSettings.upsert({
      where: { id: "default" },
      create: { id: "default", companyFeatures: features as Prisma.InputJsonObject },
      update: { companyFeatures: features as Prisma.InputJsonObject },
    }),
  );
  getLogger().info("company_admin.features_saved", { ...features, by: actor.userId });
  await refreshCompanyPolicy(deps.prisma, deps.secrets);
  return companyAdminState(deps, actor);
}

export async function setCompanyTools(
  deps: CompanyAdminDeps,
  actor: Actor,
  input: Partial<CompanyTools>,
): Promise<CompanyAdminState> {
  await requireAdmin(deps, actor.userId);
  const row = await readSettings(deps);
  const tools = { ...companyToolsWithDefaults(row?.companyTools), ...input };
  tools.disabledSkills = [...new Set(tools.disabledSkills)];
  tools.disabledTools = [...new Set(tools.disabledTools)];
  if (input.assistantModels) {
    const catalog = listPiCatalog();
    for (const chosen of Object.values(input.assistantModels)) {
      if (
        !catalog.some((entry) => entry.provider === chosen.provider && entry.id === chosen.modelId)
      )
        throw new ORPCError("BAD_REQUEST", { message: `Unknown model ${chosen.modelId}` });
    }
  }
  await runAsSystem("save the company tools", () =>
    deps.prisma.deploymentSettings.upsert({
      where: { id: "default" },
      create: { id: "default", companyTools: tools as Prisma.InputJsonObject },
      update: { companyTools: tools as Prisma.InputJsonObject },
    }),
  );
  getLogger().info("company_admin.tools_saved", { ...tools, by: actor.userId });
  await refreshCompanyPolicy(deps.prisma, deps.secrets);
  return companyAdminState(deps, actor);
}

export async function checkCompanyTools(
  deps: CompanyAdminDeps,
  actor: Actor,
): Promise<CompanyAdminState> {
  await requireAdmin(deps, actor.userId);
  await deps.evolveTools?.refresh();
  return companyAdminState(deps, actor);
}

async function voiceState(
  deps: CompanyAdminDeps,
  actor: Actor,
): Promise<CompanyAdminState["voice"]> {
  const owner = await companyVoiceOwner(deps);
  if (!owner) return { sharedBy: null, provider: null };
  const [user, cred] = await runAsSystem("read the company voice", () =>
    Promise.all([
      deps.prisma.user.findUnique({ where: { id: owner }, select: { name: true, email: true } }),
      findDefaultVoiceCredential(deps.prisma, { userId: owner, spaceId: actor.spaceId }, "account"),
    ]),
  );
  return {
    sharedBy: { userId: owner, name: user?.name || user?.email || "" },
    provider: cred?.provider ?? null,
  };
}

/** Shares the admin's own voice connection with everyone who has none, or stops sharing it. */
export async function shareCompanyVoice(
  deps: CompanyAdminDeps,
  actor: Actor,
  input: { share: boolean },
): Promise<CompanyAdminState> {
  await requireAdmin(deps, actor.userId);
  if (input.share) {
    const own = await findDefaultVoiceCredential(deps.prisma, actor, "account");
    if (!own)
      throw new ORPCError("BAD_REQUEST", {
        message: "Connect a voice provider and pick a voice first.",
      });
  } else if ((await companyVoiceOwner(deps)) === null) {
    return companyAdminState(deps, actor);
  }
  const companyVoiceUserId = input.share ? actor.userId : null;
  await runAsSystem("save the company voice", () =>
    deps.prisma.deploymentSettings.upsert({
      where: { id: "default" },
      create: { id: "default", companyVoiceUserId },
      update: { companyVoiceUserId },
    }),
  );
  getLogger().info("company_admin.voice_shared", { share: input.share, by: actor.userId });
  return companyAdminState(deps, actor);
}

function companyVaultDto(
  row: Awaited<ReturnType<typeof listCompanyVaultItems>>[number],
): BotSecretMetadata {
  const auth = BotSecretAuth.safeParse(row.auth);
  return {
    name: row.name,
    origin: row.origin,
    auth: auth.success ? auth.data : null,
    title: row.title,
    note: row.note,
    ...(row.preview ? { preview: row.preview } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCompanyVault(deps: CompanyAdminDeps, actor: Actor) {
  await requireAdmin(deps, actor.userId);
  return (await listCompanyVaultItems(deps.prisma, deps.secrets)).map(companyVaultDto);
}

export async function putCompanyVaultItem(
  deps: CompanyAdminDeps,
  actor: Actor,
  input: CompanyVaultPutInput,
): Promise<BotSecretMetadata> {
  await requireAdmin(deps, actor.userId);
  // A pasted page URL is saved under its site, as in a person's own vault.
  const site = pageUrlOrigin(input.destination.origin, { allowUserinfo: false, maxLength: 2048 });
  let name: string;
  try {
    name = await storeCompanyVaultItem({
      prisma: deps.prisma,
      secretStore: deps.secrets,
      adminUserId: actor.userId,
      spaceId: actor.spaceId,
      destination: { ...input.destination, ...(site ? { origin: site } : {}) },
      plaintext: input.value,
      title: input.title,
      note: input.note,
    });
  } catch (error) {
    // These messages describe the destination, never the value.
    throw new ORPCError("BAD_REQUEST", {
      message: error instanceof Error ? error.message : "The item was not saved.",
    });
  }
  getLogger().info("company_admin.vault_saved", { name, by: actor.userId });
  const [row] = await listCompanyVaultItems(deps.prisma, deps.secrets, name);
  if (!row) throw new ORPCError("CONFLICT", { message: "The item was not saved." });
  return companyVaultDto(row);
}

export async function removeCompanyVault(
  deps: CompanyAdminDeps,
  actor: Actor,
  name: string,
): Promise<{ ok: true }> {
  await requireAdmin(deps, actor.userId);
  await removeCompanyVaultItem(deps.prisma, deps.secrets, name);
  getLogger().info("company_admin.vault_removed", { name, by: actor.userId });
  return { ok: true };
}
