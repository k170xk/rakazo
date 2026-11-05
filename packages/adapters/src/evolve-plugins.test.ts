import { createHmac } from "node:crypto";
import { DEFAULT_COMPANY_FEATURES } from "@rakazo/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmulatorCloudAgentProvider } from "./cloud-agent-emulator.js";
import { cloudAgentsEnabled, createCloudAgentConnection } from "./cloud-agent-factory.js";
import { setCompanyPolicy } from "./company-policy.js";
import {
  createEvolvePluginsConnection,
  EvolvePluginsError,
  fetchPluginBranch,
  signEvolvePluginsToken,
} from "./evolve-plugins.js";
import { selectBuiltinToolsForRun } from "./run-tool-selection.js";

const SECRET = "s".repeat(40);

afterEach(() => {
  setCompanyPolicy({ features: null });
});

describe("Evolve plugins connection", () => {
  it("stays off unless the URL is https and the secret is long", () => {
    expect(createEvolvePluginsConnection({})).toBeNull();
    expect(
      createEvolvePluginsConnection({
        EVOLVE_PLUGINS_URL: "http://evolve.test/fn",
        EVOLVE_PLUGINS_SECRET: SECRET,
      }),
    ).toBeNull();
    expect(
      createEvolvePluginsConnection({
        EVOLVE_PLUGINS_URL: "https://evolve.test/fn",
        EVOLVE_PLUGINS_SECRET: "short",
      }),
    ).toBeNull();
    expect(
      createEvolvePluginsConnection({
        EVOLVE_PLUGINS_URL: "https://evolve.test/fn",
        EVOLVE_PLUGINS_SECRET: SECRET,
        EVOLVE_PLUGINS_REPO: "ocsc/evolve-plugins",
        EVOLVE_PLUGINS_GITHUB_TOKEN: "ghs_test",
      }),
    ).toEqual({
      url: "https://evolve.test/fn",
      secret: SECRET,
      repo: { owner: "ocsc", name: "evolve-plugins", token: "ghs_test" },
    });
  });

  it("signs a short HS256 token for the person's email", () => {
    const token = signEvolvePluginsToken(SECRET, " Keith@OCSC.co.uk ", 1_000);
    const [header, claims, signature] = token.split(".");
    expect(createHmac("sha256", SECRET).update(`${header}.${claims}`).digest("base64url")).toBe(
      signature,
    );
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
      alg: "HS256",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toEqual({
      aud: "evolve-plugins",
      iss: "ocsc-intelligence",
      sub: "keith@ocsc.co.uk",
      iat: 1_000,
      exp: 1_120,
    });
  });
});

describe("plugin branch import", () => {
  const repo = { owner: "ocsc", name: "plugins", token: "t" };
  const github = (tree: Array<{ path: string; type?: string }>) =>
    vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (path.includes("/branches/"))
        return json({ commit: { commit: { tree: { sha: "root" } } } });
      if (path.includes("/git/trees/")) {
        return json({
          tree: tree.map((entry) => ({ type: "blob", sha: entry.path, size: 10, ...entry })),
        });
      }
      const sha = decodeURIComponent(path.split("/git/blobs/")[1]!);
      return json({
        content: Buffer.from(`content of ${sha}`).toString("base64"),
        encoding: "base64",
      });
    }) as unknown as typeof fetch;

  it("copies only the plugin's own text files", async () => {
    const files = await fetchPluginBranch(repo, "cursor/helper", "helper", {
      fetch: github([
        { path: "helper/evolve-plugin.json" },
        { path: "helper/src/App.tsx" },
        { path: "helper/node_modules/x/index.js" },
        { path: "helper/.env" },
        { path: "helper/dist/assets/index.js" },
        { path: "helper/logo.png" },
        { path: "other/src/App.tsx" },
      ]),
    });
    expect(Object.keys(files).sort()).toEqual(["evolve-plugin.json", "src/App.tsx"]);
    expect(files["src/App.tsx"]).toBe("content of helper/src/App.tsx");
  });

  it("refuses bad branch names and folders without a manifest", async () => {
    await expect(
      fetchPluginBranch(repo, "../main", "helper", { fetch: github([]) }),
    ).rejects.toThrow(EvolvePluginsError);
    await expect(
      fetchPluginBranch(repo, "cursor/helper", "helper", {
        fetch: github([{ path: "helper/src/App.tsx" }]),
      }),
    ).rejects.toThrow(/evolve-plugin.json/);
  });
});

describe("plugin tool selection", () => {
  const select = (overrides: Partial<Parameters<typeof selectBuiltinToolsForRun>[0]> = {}) =>
    selectBuiltinToolsForRun({
      graphicalToolsAllowed: false,
      groupId: null,
      trigger: "user",
      semanticMemoryEnabled: false,
      messagingChannelRun: false,
      followUpFromUser: true,
      evolvePluginsEnabled: true,
      ...overrides,
    })
      .map((tool) => tool.name)
      .filter((name) => name.startsWith("evolve_plugin_"));

  it("offers the plugin tools only in the person's own direct chat with the switch on", () => {
    expect(select()).toEqual([
      "evolve_plugin_status",
      "evolve_plugin_scopes",
      "evolve_plugin_submit",
    ]);
    expect(select({ pluginBranchImportEnabled: true })).toContain("evolve_plugin_import_branch");
    expect(select({ evolvePluginsEnabled: false })).toEqual([]);
    expect(select({ messagingChannelRun: true })).toEqual([]);
    expect(select({ trigger: "routine", followUpFromUser: false })).toEqual([]);
    expect(select({ computersEnabled: false })).toEqual([
      "evolve_plugin_status",
      "evolve_plugin_scopes",
    ]);
  });
});

describe("Cursor agents company switch", () => {
  const cursor = createCloudAgentConnection({
    CLOUD_AGENT_PROVIDER: "cursor",
    CURSOR_API_KEY: "key",
  });

  it("runs Cursor agents in every space only while the switch is on", () => {
    expect(cursor).not.toBeNull();
    expect(cloudAgentsEnabled(cursor, "space-1")).toBe(false);
    setCompanyPolicy({ features: { ...DEFAULT_COMPANY_FEATURES, cursorAgents: true } });
    expect(cloudAgentsEnabled(cursor, "space-1")).toBe(true);
  });

  it("keeps the configured space working with the switch off", () => {
    const bound = createCloudAgentConnection({
      CLOUD_AGENT_PROVIDER: "cursor",
      CURSOR_API_KEY: "key",
      CLOUD_AGENT_SPACE_ID: "space-1",
      CLOUD_AGENT_MONTHLY_LAUNCHES: "25",
    });
    expect(bound?.monthlyLaunchLimit).toBe(25);
    expect(cloudAgentsEnabled(bound, "space-1")).toBe(true);
    expect(cloudAgentsEnabled(bound, "space-2")).toBe(false);
  });

  it("leaves the offline emulator available everywhere", () => {
    const emulator = { provider: new EmulatorCloudAgentProvider(), key: "emulator" };
    expect(cloudAgentsEnabled(emulator, "any")).toBe(true);
  });
});
