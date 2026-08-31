import { describe, expect, it } from "vitest";
import { deriveMcpSlug, parseMcpEnvLines } from "./mcp.js";

describe("deriveMcpSlug", () => {
  it("slugifies a display name", () => {
    expect(deriveMcpSlug("OpenAI Image")).toBe("openai-image");
  });
});

describe("parseMcpEnvLines", () => {
  it("parses KEY=value lines and ignores blanks and comments", () => {
    expect(
      parseMcpEnvLines("OPENAI_API_KEY=sk-test\n\n# note\nGPT_IMAGE_2_OUTPUT_DIR=/tmp/out"),
    ).toEqual({
      env: {
        OPENAI_API_KEY: "sk-test",
        GPT_IMAGE_2_OUTPUT_DIR: "/tmp/out",
      },
    });
  });

  it("rejects lowercase or malformed keys", () => {
    expect(parseMcpEnvLines("openai_api_key=x").error).toMatch(/Invalid environment variable name/);
    expect(parseMcpEnvLines("NOVALUE").error).toMatch(/Invalid environment line/);
  });
});
