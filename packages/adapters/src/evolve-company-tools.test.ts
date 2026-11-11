import type { AdapterContext, ConnectorEvent } from "@rakazo/adapter-kit";
import { DEFAULT_COMPANY_FEATURES, DEFAULT_COMPANY_TOOLS } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_AGENT_SKILLS, enabledBuiltinAgentSkills } from "./builtin-skills.js";
import { setCompanyPolicy } from "./company-policy.js";
import { createConnectorStack } from "./composio-connector.js";
import {
  EVOLVE_COMPANY_CONNECTOR_ID,
  EvolveCompanyTools,
  evolveToolsNote,
} from "./evolve-company-tools.js";
import { OCSC_SKILLS } from "./ocsc-skills.js";

/** Evolve's evolve-computer-mcp tools; a skill naming any other would send bots looking for it. */
const KNOWN_EVOLVE_TOOLS = [
  "search_project_datasheets",
  "get_project_details",
  "add_project_deadline",
  "update_project_deadline",
  "add_work_package",
  "update_work_package",
  "delete_work_package",
  "find_work_packages",
  "search_people_profiles",
  "generate_image",
  "edit_image",
  "create_infographics",
  "search_stock_media",
  "generate_voiceover",
  "create_chart",
  "web_search",
  "search_document_library",
];

const SECRET = "s".repeat(40);
const connection = { url: "https://evolve.test/functions/v1/", secret: SECRET };
const prisma = {
  user: { findUnique: vi.fn(async () => ({ email: "Keith@ocsc.ie" })) },
} as unknown as PrismaClient;
const context = {
  operationId: "op",
  traceId: "trace",
  spaceId: "space",
  userId: "user",
  botId: "bot",
  signal: new AbortController().signal,
} as AdapterContext;

const listed = {
  tools: [
    { name: "generate_voiceover", description: "Voice", inputSchema: { type: "object" } },
    { name: "search_stock_media", description: "Stock", inputSchema: { type: "object" } },
  ],
};

function evolve(handler: (body: { method: string; params: Record<string, unknown> }) => Response) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
    handler(JSON.parse(String(init?.body))),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: 1, result });

function claimsOf(init: unknown) {
  const token = (init as { headers: Record<string, string> }).headers.authorization!.slice(7);
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
}

async function collect(events: AsyncIterable<ConnectorEvent>) {
  const out: ConnectorEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

afterEach(() => {
  setCompanyPolicy({ features: null, tools: null });
});

describe("Evolve company tools", () => {
  it("offers Evolve's tools to every bot under the names the skills use", async () => {
    const fetch = evolve(() => reply(listed));
    const tools = new EvolveCompanyTools(prisma, connection, { fetch });
    const names = (await tools.discoverTools(context)).map((tool) => tool.name);
    expect(names).toEqual(["mcp__evolve__generate_voiceover", "mcp__evolve__search_stock_media"]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://evolve.test/functions/v1/evolve-computer-mcp");
    expect(claimsOf(init).aud).toBe("evolve-computer-mcp");
  });

  it("never offers Evolve's picture slides, so decks are made with ocsc-pptx", async () => {
    const slides = { name: "create_presentation_slides", description: "Slides" };
    const fetch = evolve(() => reply({ tools: [...listed.tools, slides] }));
    const tools = new EvolveCompanyTools(prisma, connection, { fetch });
    const names = (await tools.discoverTools(context)).map((tool) => tool.name);
    expect(names).not.toContain("mcp__evolve__create_presentation_slides");
    expect(tools.health().tools.map((tool) => tool.name)).not.toContain(slides.name);
    const call = await collect(
      tools.execute(
        {
          tool: "mcp__evolve__create_presentation_slides",
          args: {},
          executionId: "x",
          route: { connectorId: EVOLVE_COMPANY_CONNECTOR_ID, toolName: slides.name },
        },
        context,
      ),
    );
    expect(JSON.stringify(call)).toMatch(/off|unavailable|not/i);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the last good list when Evolve stops answering", async () => {
    let up = true;
    let now = 0;
    const fetch = evolve(() => (up ? reply(listed) : new Response("{}", { status: 500 })));
    const tools = new EvolveCompanyTools(prisma, connection, { fetch, now: () => now });
    await tools.discoverTools(context);
    up = false;
    now = 11 * 60_000;
    await tools.refresh();
    expect((await tools.discoverTools(context)).map((tool) => tool.name)).toContain(
      "mcp__evolve__generate_voiceover",
    );
    expect(tools.health()).toMatchObject({ status: "unavailable", error: "Evolve answered 500" });
  });

  it("offers a retry tool with the reason when no list was ever read", async () => {
    const fetch = evolve(() => new Response("{}", { status: 401 }));
    const tools = new EvolveCompanyTools(prisma, connection, { fetch });
    const [stub] = await tools.discoverTools(context);
    expect(stub?.name).toBe("mcp__evolve__unavailable");
    expect(stub?.description).toContain("EVOLVE_PLUGINS_SECRET");
  });

  it("calls a tool as the person running the bot", async () => {
    const fetch = evolve((body) =>
      body.method === "tools/list"
        ? reply(listed)
        : reply({ content: [{ type: "text", text: "ok" }], isError: false }),
    );
    const tools = new EvolveCompanyTools(prisma, connection, { fetch });
    const [tool] = await tools.discoverTools(context);
    const events = await collect(
      tools.execute(
        { tool: tool!.name, args: { text: "Hello" }, executionId: "x", route: tool!.route },
        context,
      ),
    );
    expect(events).toEqual([
      { type: "result", data: { content: [{ type: "text", text: "ok" }], isError: false } },
    ]);
    const init = fetch.mock.calls.at(-1)![1] as { body: string };
    expect(claimsOf(init).sub).toBe("keith@ocsc.ie");
    expect(JSON.parse(init.body).params).toEqual({
      name: "generate_voiceover",
      arguments: { text: "Hello" },
    });
  });

  it("drops tools and skills an admin switched off, and the whole set with its switch", async () => {
    const fetch = evolve(() => reply(listed));
    const tools = new EvolveCompanyTools(prisma, connection, { fetch });
    setCompanyPolicy({
      tools: {
        ...DEFAULT_COMPANY_TOOLS,
        disabledTools: ["generate_voiceover"],
        disabledSkills: ["OCSC-Video"],
      },
    });
    expect((await tools.discoverTools(context)).map((tool) => tool.name)).toEqual([
      "mcp__evolve__search_stock_media",
    ]);
    const call = await collect(
      tools.execute(
        {
          tool: "mcp__evolve__generate_voiceover",
          args: {},
          executionId: "x",
          route: { connectorId: EVOLVE_COMPANY_CONNECTOR_ID, toolName: "generate_voiceover" },
        },
        context,
      ),
    );
    expect(call[0]).toMatchObject({ type: "error" });
    expect(enabledBuiltinAgentSkills().map((skill) => skill.name)).not.toContain("ocsc-video");

    setCompanyPolicy({ features: { ...DEFAULT_COMPANY_FEATURES, evolveTools: false } });
    const { connector } = createConnectorStack(undefined, [tools]);
    expect(await connector.discoverTools(context)).toEqual([]);
  });

  it("wins the mcp__evolve__ names over a member's own server of the same name", async () => {
    const fetch = evolve(() => reply(listed));
    const company = new EvolveCompanyTools(prisma, connection, { fetch });
    const personal = {
      describe: () => ({
        id: "mcp",
        contractVersion: "1",
        adapterVersion: "0",
        capabilities: { discover: true, oauth: false, secretsBrokered: false },
      }),
      discoverTools: async () => [
        { name: "mcp__evolve__generate_voiceover", description: "", inputSchema: {} },
      ],
      execute: async function* () {},
    };
    const { connector } = createConnectorStack(undefined, [company, personal]);
    const found = await connector.discoverTools(context);
    expect(found.find((tool) => tool.name === "mcp__evolve__generate_voiceover")?.route).toEqual({
      connectorId: EVOLVE_COMPANY_CONNECTOR_ID,
      toolName: "generate_voiceover",
    });
  });

  it("notes a skill's tools that are switched off", () => {
    expect(evolveToolsNote("no tools here")).toBeNull();
    setCompanyPolicy({
      tools: { ...DEFAULT_COMPANY_TOOLS, disabledTools: ["generate_voiceover"] },
    });
    expect(evolveToolsNote("use mcp__evolve__generate_voiceover")).toContain(
      "turned off by your company: generate_voiceover",
    );
  });

  it("only names Evolve tools that Evolve has", () => {
    for (const skill of BUILTIN_AGENT_SKILLS) {
      for (const [, name] of skill.content.matchAll(/mcp__evolve__([A-Za-z0-9_-]+)/g))
        expect(KNOWN_EVOLVE_TOOLS, `${skill.name} names ${name}`).toContain(name);
    }
    expect(OCSC_SKILLS.length).toBeGreaterThan(0);
  });
});
