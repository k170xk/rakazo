import { beforeEach, describe, expect, it, vi } from "vitest";

const model = vi.hoisted(() => ({
  current: { provider: "openai", model: "gpt-test", key: "sk-test" } as
    | { provider: string; model: string; key?: string }
    | undefined,
}));
vi.mock("@rakazo/adapters", () => ({ companyModel: () => model.current }));

const { AppAskError, askForApp, resetAppAsks } = await import("./app-ask.js");

function reply(text: string) {
  return vi.fn(async (_url: string, _init?: RequestInit) =>
    Response.json({
      output: [{ type: "message", content: [{ type: "output_text", text }] }],
    }),
  );
}

describe("askForApp", () => {
  beforeEach(() => {
    resetAppAsks();
    model.current = { provider: "openai", model: "gpt-test", key: "sk-test" };
  });

  it("answers on the company model without storing the exchange", async () => {
    const fetchImpl = reply(" Two jobs are late. ");
    const answer = await askForApp(
      { userId: "u1", prompt: "Summarise", json: false },
      fetchImpl as never,
    );
    expect(answer).toBe("Two jobs are late.");
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    expect(body).toMatchObject({ model: "gpt-test", input: "Summarise", store: false });
    expect(body.text).toBeUndefined();
  });

  it("asks for and parses JSON when the app wants it", async () => {
    const fetchImpl = reply('{"late":2}');
    expect(
      await askForApp({ userId: "u1", prompt: "Count", json: true }, fetchImpl as never),
    ).toEqual({ late: 2 });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body));
    expect(body.text).toEqual({ format: { type: "json_object" } });
    await expect(
      askForApp({ userId: "u1", prompt: "Count", json: true }, reply("not json") as never),
    ).rejects.toBeInstanceOf(AppAskError);
  });

  it("refuses when the company model is not OpenAI or has no key", async () => {
    model.current = { provider: "anthropic", model: "x", key: "k" };
    await expect(
      askForApp({ userId: "u1", prompt: "Hi", json: false }, reply("x") as never),
    ).rejects.toThrow(/not set up/);
    model.current = { provider: "openai", model: "x" };
    await expect(
      askForApp({ userId: "u1", prompt: "Hi", json: false }, reply("x") as never),
    ).rejects.toThrow(/not set up/);
  });

  it("limits each person to 60 asks an hour", async () => {
    const fetchImpl = reply("ok");
    for (let i = 0; i < 60; i++)
      await askForApp({ userId: "busy", prompt: "Hi", json: false }, fetchImpl as never);
    await expect(
      askForApp({ userId: "busy", prompt: "Hi", json: false }, fetchImpl as never),
    ).rejects.toThrow(/Too many/);
    expect(
      await askForApp({ userId: "other", prompt: "Hi", json: false }, fetchImpl as never),
    ).toBe("ok");
  });

  it("reports a failed call plainly", async () => {
    const failing = vi.fn(async () => new Response("nope", { status: 500 }));
    await expect(
      askForApp({ userId: "u1", prompt: "Hi", json: false }, failing as never),
    ).rejects.toThrow(/couldn't answer/);
  });
});
