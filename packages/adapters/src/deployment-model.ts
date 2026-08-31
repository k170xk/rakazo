/**
 * The deployment-wide model default: which provider a run falls back to when no user
 * credential applies, and the key for that provider.
 *
 * Vendor env names and model ids live here, in the adapter layer, not in core.
 * A stored owner key (encrypted on DeploymentSettings) wins over env.
 */
export const DEPLOYMENT_MODEL_SECRET_ID = "deployment-model";

export function resolveDeploymentModel(env: NodeJS.ProcessEnv = process.env) {
  const provider = env.PI_DEFAULT_PROVIDER?.trim() || "openrouter";
  // A row per provider that ships a deployment key. A third one adds a row here, not a
  // branch at each call site — and an unknown provider gets no key rather than another
  // vendor's, which a ternary on one provider would not give.
  const keys: Record<string, string | undefined> = {
    openrouter: env.OPENROUTER_API_KEY,
    anthropic: env.ANTHROPIC_API_KEY,
    openai: env.OPENAI_API_KEY,
  };
  const models: Record<string, string> = {
    openrouter: "deepseek/deepseek-v4-flash-0731",
    anthropic: "claude-sonnet-5",
    openai: "gpt-4.1",
  };
  return {
    provider,
    model: env.PI_DEFAULT_MODEL?.trim() || models[provider] || models.openrouter!,
    key: keys[provider],
  };
}

export function decryptDeploymentModelKey(
  store: { load: (ciphertext: string, recordId: string) => string } | null | undefined,
  cipher: string | null | undefined,
): string | undefined {
  if (!store || !cipher) return undefined;
  try {
    const key = store.load(cipher, DEPLOYMENT_MODEL_SECRET_ID).trim();
    return key || undefined;
  } catch {
    return undefined;
  }
}

export function resolveEffectiveDeploymentModel(input: {
  storedProvider?: string | null;
  storedModel?: string | null;
  storedKey?: string | null;
  envKey?: string | null;
  env?: NodeJS.ProcessEnv;
}) {
  const fromEnv = resolveDeploymentModel(input.env);
  const storedProvider = input.storedProvider?.trim() || undefined;
  const storedModel = input.storedModel?.trim() || undefined;
  const storedKey = input.storedKey?.trim() || undefined;
  const envKey = ("envKey" in input ? input.envKey : fromEnv.key)?.trim() || undefined;
  const provider = storedProvider || fromEnv.provider;
  const model = storedModel || fromEnv.model;
  const key = storedKey || (provider === fromEnv.provider ? envKey : undefined);
  return { provider, model, key };
}
