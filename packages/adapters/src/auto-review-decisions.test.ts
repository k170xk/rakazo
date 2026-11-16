import type {
  AdapterContext,
  AutoReviewProvider,
  AutoReviewRequest,
  AutoReviewResult,
  DecisionAnswer,
} from "@rakazo/adapter-kit";
import type { TestSink } from "@rakazo/logging";
import { createLogger, createTestSink, installLogger } from "@rakazo/logging";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  autoReviewDecisionsMode,
  DecisionAssistedAutoReview,
  decisionAssistFor,
} from "./auto-review-decisions.js";

const request: AutoReviewRequest = {
  toolName: "web_fetch",
  connectorKind: "builtin",
  args: { url: "https://example.com/private-fake" },
  userTask: "fake owner words",
  botDescription: "fake bot",
  matchingRules: [],
};
const context: AdapterContext = {
  operationId: "auto-review:run",
  traceId: "auto-review:run",
  spaceId: "space",
  userId: "user",
  runId: "run",
  signal: new AbortController().signal,
};
const descriptor = {
  id: "llm",
  contractVersion: "1",
  adapterVersion: "0.1.0",
  capabilities: { offline: false, keyless: false },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function checkerReturning(result: Promise<AutoReviewResult>) {
  const review = vi.fn((_request: AutoReviewRequest, _context: AdapterContext) => result);
  return { review, provider: { describe: () => descriptor, review } as AutoReviewProvider };
}

function assistAnswering(result: Promise<AutoReviewResult>, answer?: DecisionAnswer) {
  return (onAnswer: (answer: DecisionAnswer | undefined) => void): AutoReviewProvider => ({
    describe: () => ({ ...descriptor, id: "openai" }),
    review: async () => {
      const value = await result;
      onAnswer(answer);
      return value;
    },
  });
}

const checkerAsk: AutoReviewResult = { decision: "ask", model: "openai/gpt-6-astra", reason: "x" };
const checkerPass: AutoReviewResult = { decision: "pass", model: "openai/gpt-6-astra" };
const assistPass: AutoReviewResult = { decision: "pass", model: "openai/gpt-6-luna" };
const sure: DecisionAnswer = { type: "choice", choice: "pass", confidence: 0.97 };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let sink: TestSink;
beforeEach(() => {
  sink = createTestSink();
  installLogger(createLogger({ service: "test", sinks: [sink] }));
});
afterEach(() => {
  installLogger(createLogger({ service: "test", level: "off", sinks: [] }));
});

describe("autoReviewDecisionsMode", () => {
  it.each([
    [undefined, "off"],
    ["", "off"],
    ["true", "off"],
    ["ON", "on"],
    [" shadow ", "shadow"],
  ])("reads %j as %s", (value, mode) => {
    expect(autoReviewDecisionsMode({ RAKAZO_AUTO_REVIEW_DECISIONS: value })).toBe(mode);
  });
});

describe("decisionAssistFor", () => {
  it("assists only a plain key on the provider's own endpoint", () => {
    expect(decisionAssistFor("openai", { apiKey: "fake-key", headers: {} })).toMatchObject({
      provider: "openai",
      id: "gpt-6-luna",
    });
    for (const key of [
      { apiKey: " " },
      { apiKey: "fake-key", oauth: {} },
      { apiKey: "fake-key", baseUrl: "https://gateway.example" },
      { apiKey: "fake-key", gatewayId: "gateway" },
      { apiKey: "fake-key", headers: { "x-fake": "1" } },
    ])
      expect(decisionAssistFor("openai", key)).toBeUndefined();
    expect(decisionAssistFor("anthropic", { apiKey: "fake-key" })).toBeUndefined();
  });
});

describe("shadow mode", () => {
  it("returns the checker's own result from the unchanged call and logs both verdicts", async () => {
    const { review, provider } = checkerReturning(Promise.resolve(checkerAsk));
    const reviewer = new DecisionAssistedAutoReview({
      mode: "shadow",
      checker: provider,
      checkerModel: "openai/gpt-6-astra",
      assist: assistAnswering(Promise.resolve(assistPass), sure),
    });
    await expect(reviewer.review(request, context)).resolves.toBe(checkerAsk);
    expect(review).toHaveBeenCalledWith(request, context);
    expect(review.mock.calls[0]![1]).toBe(context);
    await flush();
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      message: "auto review decision assist",
      mode: "shadow",
      tool: "web_fetch",
      checker_model: "openai/gpt-6-astra",
      checker_decision: "ask",
      assist_model: "openai/gpt-6-luna",
      assist_decision: "pass",
      assist_choice: "pass",
      assist_confidence: 0.97,
      assist_used: false,
    });
    expect(JSON.stringify(sink.events)).not.toMatch(/private-fake|fake owner words|fake bot/);
  });

  it("never waits for the decision model", async () => {
    const { provider } = checkerReturning(Promise.resolve(checkerPass));
    const reviewer = new DecisionAssistedAutoReview({
      mode: "shadow",
      checker: provider,
      checkerModel: "openai/gpt-6-astra",
      assist: assistAnswering(new Promise<AutoReviewResult>(() => undefined)),
    });
    await expect(reviewer.review(request, context)).resolves.toBe(checkerPass);
  });

  it("rethrows the checker's error and survives a decision model that cannot be built", async () => {
    const failure = new Error("checker failed");
    const { provider } = checkerReturning(Promise.reject(failure));
    const reviewer = new DecisionAssistedAutoReview({
      mode: "shadow",
      checker: provider,
      checkerModel: "openai/gpt-6-astra",
      assist: () => {
        throw new Error("no key");
      },
    });
    await expect(reviewer.review(request, context)).rejects.toBe(failure);
    await flush();
    expect(sink.events[0]).toMatchObject({
      checker_decision: "threw",
      assist_decision: "threw",
    });
  });
});

describe("on mode", () => {
  it("lets a confident pass that arrives first stand and stops the checker", async () => {
    const checking = deferred<AutoReviewResult>();
    const { review, provider } = checkerReturning(checking.promise);
    const reviewer = new DecisionAssistedAutoReview({
      mode: "on",
      checker: provider,
      checkerModel: "openai/gpt-6-astra",
      assist: assistAnswering(Promise.resolve(assistPass), sure),
    });
    await expect(reviewer.review(request, context)).resolves.toBe(assistPass);
    const checkerSignal = review.mock.calls[0]![1].signal;
    expect(checkerSignal.aborted).toBe(true);
    expect(context.signal.aborted).toBe(false);
    checking.reject(new Error("aborted"));
    await flush();
    expect(sink.events[0]).toMatchObject({ mode: "on", assist_used: true });
  });

  it.each([
    ["an ask", { decision: "ask", model: "openai/gpt-6-luna" }, sure],
    ["a pass below the confidence floor", assistPass, { ...sure, confidence: 0.89 }],
    ["a pass without confidence", assistPass, { type: "choice", choice: "pass" }],
    ["an error", { decision: "error", model: "openai/gpt-6-luna" }, undefined],
  ] as const)("waits for the checker after %s", async (_label, assistResult, answer) => {
    const checking = deferred<AutoReviewResult>();
    const { review, provider } = checkerReturning(checking.promise);
    const reviewer = new DecisionAssistedAutoReview({
      mode: "on",
      checker: provider,
      checkerModel: "openai/gpt-6-astra",
      assist: assistAnswering(Promise.resolve(assistResult as AutoReviewResult), answer),
    });
    const reviewing = reviewer.review(request, context);
    await flush();
    checking.resolve(checkerAsk);
    await expect(reviewing).resolves.toBe(checkerAsk);
    expect(review.mock.calls[0]![1].signal.aborted).toBe(false);
  });

  it("returns the checker's verdict when it answers first, even if a pass follows", async () => {
    const assisting = deferred<AutoReviewResult>();
    const { provider } = checkerReturning(Promise.resolve(checkerAsk));
    const reviewer = new DecisionAssistedAutoReview({
      mode: "on",
      checker: provider,
      checkerModel: "openai/gpt-6-astra",
      assist: assistAnswering(assisting.promise, sure),
    });
    await expect(reviewer.review(request, context)).resolves.toBe(checkerAsk);
    assisting.resolve(assistPass);
    await flush();
    expect(sink.events[0]).toMatchObject({ assist_decision: "pass", assist_used: false });
  });

  it("falls back to the checker when the decision model throws, and rethrows its errors", async () => {
    const failure = new Error("checker failed");
    const { provider } = checkerReturning(
      new Promise<AutoReviewResult>((_resolve, reject) => setTimeout(() => reject(failure), 5)),
    );
    const reviewer = new DecisionAssistedAutoReview({
      mode: "on",
      checker: provider,
      checkerModel: "openai/gpt-6-astra",
      assist: assistAnswering(Promise.reject(new Error("timeout"))),
    });
    await expect(reviewer.review(request, context)).rejects.toBe(failure);
  });
});
