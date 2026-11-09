import { describe, expect, it } from "vitest";
import { contextStrategyFromEnv } from "./types.js";

describe("contextStrategyFromEnv", () => {
  it("reads a known strategy and otherwise leaves the choice to the runtime", () => {
    expect(contextStrategyFromEnv({ AGENT_CONTEXT_STRATEGY: " Snapshots " })).toBe("snapshots");
    expect(contextStrategyFromEnv({ AGENT_CONTEXT_STRATEGY: "cache-aware" })).toBe("cache-aware");
    expect(contextStrategyFromEnv({ AGENT_CONTEXT_STRATEGY: "everything" })).toBeUndefined();
    expect(contextStrategyFromEnv({ AGENT_CONTEXT_STRATEGY: "" })).toBeUndefined();
    expect(contextStrategyFromEnv({})).toBeUndefined();
  });
});
