import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { AgentRunRequest, AgentRuntimeEvent } from "@rakazo/adapter-kit";
import { beforeEach, expect, it, vi } from "vitest";

const providerState = vi.hoisted(() => ({
  models: new Map<string, Record<string, unknown>>(),
  stream: vi.fn(),
}));

vi.mock("@earendil-works/pi-ai/providers/all", () => ({
  builtinModels: () => ({
    getModel: (provider: string, id: string) => providerState.models.get(`${provider}/${id}`),
    streamSimple: (...args: unknown[]) => providerState.stream(...args),
  }),
}));

vi.mock("./pi-local-provider.js", () => ({ registerLocalProvider: (models: unknown) => models }));
vi.mock("./pi-openai-compatible-provider.js", () => ({
  OPENAI_COMPATIBLE_PROVIDER_ID: "openai-compatible",
  registerOpenAiCompatibleCatalog: (models: unknown) => models,
  registerOpenAiCompatibleRuntime: (models: unknown) => models,
}));

import { PiAgentRuntime, unsentDocumentsPrompt } from "./pi-runtime.js";

const primary: Model<"openai-completions"> = {
  provider: "provider-a",
  id: "primary",
  name: "primary",
  api: "openai-completions",
  baseUrl: "https://models.invalid/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_768,
  maxTokens: 4_096,
};

function message(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: primary.api,
    provider: primary.provider,
    model: primary.id,
    usage: {
      input: 4,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 6,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

type ToolCall = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;

function call(name: string, args: ToolCall["arguments"]) {
  const toolCall: ToolCall = { type: "toolCall", id: `call-${name}`, name, arguments: args };
  const response = message([toolCall], "toolUse");
  const result = new AssistantMessageEventStream();
  result.push({ type: "start", partial: { ...response, content: [], stopReason: "stop" } });
  result.push({ type: "toolcall_start", contentIndex: 0, partial: { ...response, content: [] } });
  result.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: response });
  result.push({ type: "done", reason: "toolUse", message: response });
  result.end(response);
  return result;
}

function reply(text: string) {
  const response = message([{ type: "text", text }], "stop");
  const result = new AssistantMessageEventStream();
  result.push({ type: "start", partial: { ...response, content: [], stopReason: "stop" } });
  result.push({ type: "text_delta", contentIndex: 0, delta: text, partial: response });
  result.push({ type: "done", reason: "stop", message: response });
  result.end(response);
  return result;
}

const tool = (name: string) => ({
  name,
  description: name,
  inputSchema: { type: "object", properties: {} },
  readOnly: false,
});
const withAttach = [tool("ocsc"), tool("attach_file")];

/** A run whose ocsc call makes the report and whose attach_file call sends it. */
function documentRun(tools = withAttach) {
  const documents = { made: [] as string[], attached: false };
  const names: string[] = [];
  const executeTool = vi.fn(async (name: string) => {
    names.push(name);
    if (name === "ocsc") documents.made.push("outputs/Report.docx");
    if (name === "attach_file") documents.attached = true;
    return { ok: true };
  });
  const input = {
    botId: "bot",
    threadId: "thread",
    runId: "run",
    prompt: "Edit my report",
    instructions: "Use tools when useful.",
    history: [],
    tools,
    model: { provider: primary.provider, id: primary.id, apiKey: "fake-key" },
    executeTool,
    unsentDocuments: () => (documents.attached ? [] : documents.made),
  } as unknown as AgentRunRequest;
  return { input, names, documents };
}

async function run(input: AgentRunRequest) {
  const events: AgentRuntimeEvent[] = [];
  for await (const event of new PiAgentRuntime().run(input, {
    operationId: "operation",
    traceId: "trace",
    spaceId: "space",
    userId: "user",
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }
  return events;
}

/** The last user message the model was sent on its n-th request. */
function lastUserText(request: number): string {
  const context = providerState.stream.mock.calls[request]?.[1] as {
    messages: Array<{ role: string; content: unknown }>;
  };
  const user = context.messages.filter((entry) => entry.role === "user").at(-1);
  return typeof user?.content === "string" ? user.content : JSON.stringify(user?.content);
}

beforeEach(() => {
  providerState.models.clear();
  providerState.models.set(`${primary.provider}/${primary.id}`, primary as never);
  providerState.stream.mockReset();
});

it("reminds a reply that forgot to attach the document it made, once", async () => {
  const { input, names } = documentRun();
  providerState.stream
    .mockImplementationOnce(() => call("ocsc", { program: "word", args: ["edit"] }))
    .mockImplementationOnce(() => reply("I've updated the report."))
    .mockImplementationOnce(() => call("attach_file", { path: "outputs/Report.docx" }))
    .mockImplementation(() => reply("It is attached."));
  const events = await run(input);

  expect(names).toEqual(["ocsc", "attach_file"]);
  expect(providerState.stream).toHaveBeenCalledTimes(4);
  expect(lastUserText(2)).toContain(unsentDocumentsPrompt(["outputs/Report.docx"]));
  expect(events.at(-1)?.type).toBe("done");
});

it("does not remind twice when the bot still sends nothing", async () => {
  const { input, names } = documentRun();
  providerState.stream
    .mockImplementationOnce(() => call("ocsc", { program: "word", args: ["edit"] }))
    .mockImplementation(() => reply("I've updated the report."));
  await run(input);

  expect(names).toEqual(["ocsc"]);
  expect(providerState.stream).toHaveBeenCalledTimes(3);
});

it("leaves a reply alone when the document was already attached", async () => {
  const { input } = documentRun();
  providerState.stream
    .mockImplementationOnce(() => call("ocsc", { program: "word", args: ["edit"] }))
    .mockImplementationOnce(() => call("attach_file", { path: "outputs/Report.docx" }))
    .mockImplementation(() => reply("Here is the report."));
  await run(input);

  expect(providerState.stream).toHaveBeenCalledTimes(3);
});

it("does not remind a bot that has no attach_file tool", async () => {
  const { input } = documentRun([tool("ocsc")]);
  providerState.stream
    .mockImplementationOnce(() => call("ocsc", { program: "word", args: ["edit"] }))
    .mockImplementation(() => reply("I've updated the report."));
  await run(input);

  expect(providerState.stream).toHaveBeenCalledTimes(2);
});
