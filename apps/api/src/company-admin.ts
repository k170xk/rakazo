import { ORPCError } from "@orpc/server";
import {
  COMPANY_MODEL_SECRET_RECORD,
  companyFeatures,
  companyModel,
  listPiCatalog,
  refreshCompanyPolicy,
  resolveEnvironmentDeploymentModel,
  verifyCatalogProviderApiKey,
} from "@rakazo/adapters";
import type {
  Actor,
  CompanyAdminState,
  CompanyFeatureId,
  CompanyFeatures,
  CompanyModelInput,
} from "@rakazo/contracts";
import { canonicalPiProviderId, companyFeaturesFrom } from "@rakazo/contracts";
import type { Prisma } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { isAdmin, requireAdmin } from "./admins.js";
import type { RouterDeps } from "./router.js";

type CompanyAdminDeps = Pick<RouterDeps, "prisma" | "secrets" | "modelConnectionFetch"> & {
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
    admins: deps.env.adminEmails ?? [],
    staff: { accounts, withOwnModels: owners.length },
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
