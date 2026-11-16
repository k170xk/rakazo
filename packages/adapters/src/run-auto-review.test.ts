import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmAutoReviewProvider } from "./auto-review.js";
import { DecisionAssistedAutoReview } from "./auto-review-decisions.js";
import { DecisionAutoReviewProvider } from "./decision-auto-review.js";
import type { ExecutorDeps } from "./executor-deps.js";
import { autoReviewCheckerProvider } from "./run-auto-review.js";

const key = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@rakazo/db", () => ({ recordUsage: vi.fn() }));
vi.mock("./model-selection.js", () => ({
  findConnectedModelCredential: vi.fn(async () => null),
  hasHostedModelCredits: vi.fn(async () => false),
}));
vi.mock("./run-model.js", () => ({ resolveModelKey: vi.fn(async () => key.value) }));

const deps = { prisma: {}, secretStore: {}, runtime: {} } as unknown as ExecutorDeps;
const scope = { runId: "run", spaceId: "space", userId: "user", botId: "bot", threadId: "thread" };
const provider = (checker: { provider: string; model: string }) =>
  autoReviewCheckerProvider(
    deps,
    scope,
    { memberChecker: false, registerSecrets: () => undefined },
    checker,
  );
const openAi = { provider: "openai", model: "gpt-6-astra" };

afterEach(() => {
  vi.unstubAllEnvs();
  key.value = {};
});

describe("autoReviewCheckerProvider decision assist", () => {
  it("leaves the chat checker unwrapped while the flag is off", async () => {
    key.value = { apiKey: "fake-key" };
    vi.stubEnv("RAKAZO_AUTO_REVIEW_DECISIONS", "");
    expect(await provider(openAi)).toBeInstanceOf(LlmAutoReviewProvider);
  });

  it.each(["shadow", "on"])("wraps an eligible checker in %s mode", async (mode) => {
    key.value = { apiKey: "fake-key" };
    vi.stubEnv("RAKAZO_AUTO_REVIEW_DECISIONS", mode);
    expect(await provider(openAi)).toBeInstanceOf(DecisionAssistedAutoReview);
  });

  it("leaves other providers, subscription sign-ins and catalog decision models alone", async () => {
    vi.stubEnv("RAKAZO_AUTO_REVIEW_DECISIONS", "on");
    key.value = { apiKey: "fake-key" };
    expect(await provider({ provider: "anthropic", model: "fake" })).toBeInstanceOf(
      LlmAutoReviewProvider,
    );
    expect(await provider({ provider: "openrouter", model: "typesafe/jev-1.14" })).toBeInstanceOf(
      DecisionAutoReviewProvider,
    );
    key.value = { oauth: { access: "fake" } };
    expect(await provider(openAi)).toBeInstanceOf(LlmAutoReviewProvider);
  });
});
