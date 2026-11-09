import { describe, expect, it } from "vitest";
import { shortModelName } from "./short-model-name";

describe("shortModelName", () => {
  it("keeps the GPT version and drops codenames", () => {
    expect(shortModelName("gpt-6")).toBe("GPT-6");
    expect(shortModelName("gpt-6.1")).toBe("GPT-6.1");
    expect(shortModelName("gpt-6-luna")).toBe("GPT-6");
    expect(shortModelName("openai/gpt-5.6-luna")).toBe("GPT-5.6");
    expect(shortModelName("gpt-4o")).toBe("GPT-4o");
    expect(shortModelName("gpt-4o-mini")).toBe("GPT-4o mini");
  });

  it("shortens other families and leaves an unknown id readable", () => {
    expect(shortModelName("claude-sonnet-4-5")).toBe("Sonnet 4.5");
    expect(shortModelName("gemini-2.5-pro")).toBe("Gemini 2.5");
    expect(shortModelName("o3-mini")).toBe("O3 mini");
    expect(shortModelName(null)).toBe("");
  });
});
