import { ORPCError } from "@orpc/server";
import {
  BUILTIN_AGENT_SKILLS,
  COMPANY_MODEL_SECRET_RECORD,
  companyFeatures,
  companyModel,
  companyToolsWithDefaults,
  effectiveComputerAccess,
  listPiCatalog,
  refreshCompanyPolicy,
  resolveEnvironmentDeploymentModel,
  verifyCatalogProviderApiKey,
  videoRenderLoad,
  videoRenderSlots,
} from "@rakazo/adapters";
import type {
  Actor,
  CompanyAdminState,
  CompanyComputersState,
  CompanyFeatureId,
  CompanyFeatures,
  CompanyModelInput,
  CompanyTools,
  CompanyToolsState,
  ComputerAccess,
} from "@rakazo/contracts";
import {
  ComputerAccessSchema,
  canonicalPiProviderId,
  companyFeaturesFrom,
} from "@rakazo/contracts";
import type { Prisma } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { isAdmin, requireAdmin } from "./admins.js";
import type { RouterDeps } from "./router.js";

type CompanyAdminDeps = Pick<
  RouterDeps,
  "prisma" | "secrets" | "modelConnectionFetch" | "evolveTools"
> & {
  env: Pick<RouterDeps["env"], "adminEmails">;
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
};

/** Fails a member's request for something the company turned off; admins keep model choice. */
export async function requireCompanyFeature(
  deps: Pick<RouterDeps, "prisma"> & { env: Pick<RouterDeps["env"], "adminEmails"> },
  actor: Pick<Actor, "userId">,
  feature: CompanyFeatureId,
): Promise<void> {
  if (companyFeatures()[feature]) return;
  if (feature === "memberModels" && (await isAdmin(deps, actor.userId))) return;
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
    environmentModel: environment.configured
      ? { provider: environment.provider, modelId: environment.model }
      : null,
    features: companyFeaturesFrom(row?.companyFeatures),
    tools: toolsState(deps, companyToolsWithDefaults(row?.companyTools)),
    computers: await computersState(deps, companyToolsWithDefaults(row?.companyTools)),
    admins: deps.env.adminEmails ?? [],
    staff: { accounts, withOwnModels: owners.length },
  };
}

async function computersState(
  deps: CompanyAdminDeps,
  policy: CompanyTools,
): Promise<CompanyComputersState> {
  const [people, runningComputers, load] = await Promise.all([
    runAsSystem("list computer access", () =>
      deps.prisma.user.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, email: true, computerAccess: true },
      }),
    ),
    runAsSystem("count running computers", () =>
      deps.prisma.computer.count({ where: { state: "running" } }),
    ),
    videoRenderLoad(deps.prisma),
  ]);
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
      };
    }),
    capacity: {
      runningComputers,
      videoSlots: videoRenderSlots(),
      videoRendering: load.rendering,
      videoQueued: load.queued,
    },
  };
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

/** Fails a request that drives a computer directly, such as its screen or terminal, without Full access. */
export async function requireFullComputer(
  deps: Pick<RouterDeps, "prisma">,
  actor: Pick<Actor, "userId">,
): Promise<void> {
  const user = await runAsSystem("read computer access", () =>
    deps.prisma.user.findUnique({ where: { id: actor.userId }, select: { computerAccess: true } }),
  );
  if (effectiveComputerAccess(user?.computerAccess) === "full") return;
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
