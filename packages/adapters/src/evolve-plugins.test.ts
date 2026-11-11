import { createHmac } from "node:crypto";
import { DEFAULT_COMPANY_FEATURES } from "@rakazo/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmulatorCloudAgentProvider } from "./cloud-agent-emulator.js";
import { cloudAgentsEnabled, createCloudAgentConnection } from "./cloud-agent-factory.js";
import { setCompanyPolicy } from "./company-policy.js";
import {
  callEvolveTranscribe,
  createEvolvePluginsConnection,
  EVOLVE_TRANSCRIBE_AUDIENCE,
  EvolvePluginsError,
  fetchPluginBranch,
  signEvolvePluginsToken,
  verifyAppDataToken,
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

  it("posts audio to Evolve Whisper as the staff member", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://evolve.test/functions/v1/transcribe-audio");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      const auth = headers.get("authorization") ?? "";
      const token = auth.replace(/^Bearer\s+/i, "");
      const claims = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
      expect(claims.aud).toBe(EVOLVE_TRANSCRIBE_AUDIENCE);
      expect(claims.sub).toBe("keith@ocsc.co.uk");
      expect(JSON.parse(String(init?.body))).toEqual({
        audioBase64: "YQ==",
        mimeType: "audio/webm",
      });
      return new Response(JSON.stringify({ text: "hello world" }), { status: 200 });
    });
    const text = await callEvolveTranscribe(
      { url: "https://evolve.test/functions/v1/plugin-builder", secret: SECRET },
      "Keith@OCSC.co.uk",
      { audioBase64: "YQ==", mimeType: "audio/webm" },
      { fetch: fetchImpl as typeof fetch },
    );
    expect(text).toEqual({ text: "hello world" });
    expect(fetchImpl).toHaveBeenCalledOnce();
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

describe("Evolve app-data tokens", () => {
  const now = 1_800_000_000;
  const sign = (claims: Record<string, unknown>, secret = SECRET, alg = "HS256") => {
    const head = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
    return `${head}.${body}.${signature}`;
  };
  const good = {
    iss: "evolve",
    aud: "ocsc-intelligence-app-data",
    sub: " Keith@OCSC.ie ",
    slug: "job-tracker",
    iat: now,
    exp: now + 60,
  };

  it("names the person and plugin of a token Evolve signed", () => {
    expect(verifyAppDataToken(SECRET, sign(good), now)).toEqual({
      email: "keith@ocsc.ie",
      slug: "job-tracker",
    });
  });

  it("refuses tokens this server signs, other secrets, and stale or long-lived tokens", () => {
    expect(
      verifyAppDataToken(SECRET, signEvolvePluginsToken(SECRET, "keith@ocsc.ie", now), now),
    ).toBeNull();
    for (const token of [
      sign(good, "x".repeat(40)),
      sign(good, SECRET, "none"),
      sign({ ...good, iss: "ocsc-intelligence" }),
      sign({ ...good, aud: "evolve-plugins" }),
      sign({ ...good, exp: now }),
      sign({ ...good, exp: now + 600 }),
      sign({ ...good, slug: "../other" }),
      sign({ ...good, sub: "nobody" }),
      `${sign(good).slice(0, -2)}xx`,
      "not-a-token",
    ])
      expect(verifyAppDataToken(SECRET, token, now)).toBeNull();
  });
});
