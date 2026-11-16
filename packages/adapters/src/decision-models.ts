import type { ModelCatalogEntry } from "@rakazo/contracts";

/** Protocol/pricing belongs to the adapter catalog, never approval policy. */
const models = [
  { provider: "openrouter", id: "typesafe/jev-1.14", label: "Jev 1.14", inputUsdPerMillion: 0.042 },
];
/** Not approval choices: each assists a chat checker on its own provider, behind a deployment flag. */
const assistModels = [{ provider: "openai", id: "gpt-6-luna", inputUsdPerMillion: 0.1 }] as const;
export function decisionModel(provider: string, id: string) {
  return models.find((model) => model.provider === provider && model.id === id);
}
export function decisionPricing(provider: string, id: string) {
  return (
    decisionModel(provider, id) ??
    assistModels.find((model) => model.provider === provider && model.id === id)
  );
}
export function decisionAssistModel(checkerProvider: string) {
  return assistModels.find((model) => model.provider === checkerProvider);
}
export function decisionModelCatalog(): ModelCatalogEntry[] {
  return models.map((model) => ({
    provider: model.provider,
    providerName: "OpenRouter",
    id: model.id,
    label: model.label,
    protocol: "decisions",
    billing: "Uses your API key",
    auth: "api-key",
  }));
}
