import type { SecretStore } from "@rakazo/adapter-kit";
import type { CompanyFeatures, CompanyTools, ThinkingLevel } from "@rakazo/contracts";
import {
  ComputerAccessSchema,
  companyFeaturesFrom,
  companyToolsFrom,
  DEFAULT_COMPANY_FEATURES,
  ThinkingLevelSchema,
} from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { runAsSystem } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";

/** Record id binding the company model's encrypted key to the deployment settings row. */
export const COMPANY_MODEL_SECRET_RECORD = "deployment-model";

/** Other processes pick up an admin's change within this window. */
const REFRESH_MS = 15_000;

export type LiveCompanyModel = { provider: string; model: string; key: string };

let loadedFeatures: CompanyFeatures | null = null;
let loadedModel: LiveCompanyModel | null = null;
let loadedTools: CompanyTools | null = null;
let loadedThinkingLevel: ThinkingLevel | null = null;

export function companyFeatures(): CompanyFeatures {
  return loadedFeatures ?? DEFAULT_COMPANY_FEATURES;
}

/** Built-in skills and company tools switched off for every account. */
export function companyTools(): CompanyTools {
  return loadedTools ?? companyToolsWithDefaults(undefined);
}

/**
 * The stored company tools; until an admin picks a default computer access level,
 * RAKAZO_COMPUTER_ACCESS_DEFAULT sets it, else everyone gets "tools".
 */
export function companyToolsWithDefaults(
  stored: unknown,
  env: NodeJS.ProcessEnv = process.env,
): CompanyTools {
  const tools = companyToolsFrom(stored);
  const chosen = ComputerAccessSchema.safeParse(
    (stored as { defaultComputerAccess?: unknown } | null | undefined)?.defaultComputerAccess,
  );
  if (chosen.success) return tools;
  const deployment = ComputerAccessSchema.safeParse(env.RAKAZO_COMPUTER_ACCESS_DEFAULT);
  return deployment.success ? { ...tools, defaultComputerAccess: deployment.data } : tools;
}

/** The admin-set model every account runs on when it has none of its own, with its key. */
export function companyModel(): LiveCompanyModel | null {
  return loadedModel;
}

/** How hard every bot thinks while members cannot choose models; null is the model's default. */
export function companyThinkingLevel(): ThinkingLevel | null {
  return loadedThinkingLevel;
}

/** Test seam: what a process would have read from deployment settings. */
export function setCompanyPolicy(policy: {
  features?: CompanyFeatures | null;
  model?: LiveCompanyModel | null;
  tools?: CompanyTools | null;
  thinkingLevel?: ThinkingLevel | null;
}): void {
  if (policy.thinkingLevel !== undefined) loadedThinkingLevel = policy.thinkingLevel;
  if (policy.tools !== undefined) loadedTools = policy.tools;
  if (policy.features !== undefined) loadedFeatures = policy.features;
  if (policy.model !== undefined) loadedModel = policy.model;
}

export async function refreshCompanyPolicy(
  prisma: PrismaClient,
  secrets: Pick<SecretStore, "load">,
): Promise<void> {
  const row = await runAsSystem("read the company policy", () =>
    prisma.deploymentSettings.findUnique({
      where: { id: "default" },
      select: {
        companyFeatures: true,
        companyTools: true,
        defaultModelProvider: true,
        defaultModelId: true,
        deploymentModelCredentialCipher: true,
        companyThinkingLevel: true,
      },
    }),
  );
  loadedFeatures = companyFeaturesFrom(row?.companyFeatures);
  loadedThinkingLevel = ThinkingLevelSchema.safeParse(row?.companyThinkingLevel).data ?? null;
  loadedTools = companyToolsWithDefaults(row?.companyTools);
  if (!row?.defaultModelProvider || !row.defaultModelId || !row.deploymentModelCredentialCipher) {
    loadedModel = null;
    return;
  }
  try {
    const key = await secrets.load(
      row.deploymentModelCredentialCipher,
      COMPANY_MODEL_SECRET_RECORD,
    );
    loadedModel = { provider: row.defaultModelProvider, model: row.defaultModelId, key };
  } catch (error) {
    // Keep the last key that worked: a store that cannot be read now is not a removed key.
    getLogger().error("company model key could not be read", error);
  }
}

/** Loads the policy now and keeps it fresh; returns the stop function. */
export async function watchCompanyPolicy(
  prisma: PrismaClient,
  secrets: Pick<SecretStore, "load">,
): Promise<() => void> {
  await refreshCompanyPolicy(prisma, secrets).catch((error) =>
    getLogger().error("company policy could not be read", error),
  );
  const timer = setInterval(() => {
    void refreshCompanyPolicy(prisma, secrets).catch((error) =>
      getLogger().error("company policy could not be read", error),
    );
  }, REFRESH_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** The deployment key a run may use: the company model's, else the one from the environment. */
export function liveDeploymentModelKey(environmentKey: string | undefined): string | undefined {
  return loadedModel?.key ?? environmentKey;
}

export function liveDeploymentModelConfigured(environmentConfigured: boolean | undefined): boolean {
  return Boolean(loadedModel) || Boolean(environmentConfigured);
}
