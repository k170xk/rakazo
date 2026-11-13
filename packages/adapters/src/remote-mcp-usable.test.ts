import { afterEach, describe, expect, it } from "vitest";
import type { McpProbe } from "./remote-mcp-usable.js";
import {
  protectedResourceMetadataUrl,
  remoteMcpConnectorUsable,
  resetRemoteMcpUsableCache,
} from "./remote-mcp-usable.js";

afterEach(() => resetRemoteMcpUsableCache());

function json(value: unknown, status = 200): Awaited<ReturnType<McpProbe>> {
  return {
    status,
    headers: new Headers(),
    body: new TextEncoder().encode(JSON.stringify(value)),
  };
}

describe("remoteMcpConnectorUsable", () => {
  it("builds the protected-resource address beside the MCP path", () => {
    expect(protectedResourceMetadataUrl("https://gmail.example/mcp/v1")).toBe(
      "https://gmail.example/.well-known/oauth-protected-resource/mcp/v1",
    );
  });

  it("keeps a server that answers without a sign-in", async () => {
    const probe: McpProbe = async (url) =>
      url.includes("well-known") ? json({}, 404) : json({ result: {} });
    await expect(remoteMcpConnectorUsable("https://open.example.com/mcp", probe)).resolves.toBe(
      true,
    );
  });

  it("drops a server that refuses the connection and never asks for a sign-in", async () => {
    const probe: McpProbe = async (url) => json({}, url.includes("well-known") ? 404 : 403);
    await expect(remoteMcpConnectorUsable("https://locked.example.com/mcp", probe)).resolves.toBe(
      false,
    );
  });

  it("keeps a server whose sign-in can register this app", async () => {
    const probe: McpProbe = async (url) => {
      if (url.includes("oauth-protected-resource"))
        return json({ authorization_servers: ["https://auth.example.com"] });
      if (url.includes("oauth-authorization-server"))
        return json({ registration_endpoint: "https://auth.example.com/register" });
      return json({}, 404);
    };
    await expect(remoteMcpConnectorUsable("https://api.example.com/mcp", probe)).resolves.toBe(
      true,
    );
  });

  it("drops a server that only accepts a client the vendor registers", async () => {
    const probe: McpProbe = async (url) => {
      if (url.includes("oauth-protected-resource"))
        return json({ authorization_servers: ["https://accounts.example.com"] });
      return json({ authorization_endpoint: "https://accounts.example.com/o/oauth2/auth" });
    };
    await expect(remoteMcpConnectorUsable("https://gmail.example.com/mcp/v1", probe)).resolves.toBe(
      false,
    );
  });

  it("keeps a server when the check cannot finish", async () => {
    const probe: McpProbe = async () => {
      throw new Error("timeout");
    };
    await expect(remoteMcpConnectorUsable("https://slow.example.com/mcp", probe)).resolves.toBe(
      null,
    );
  });

  it("does not probe addresses that only exist in tests", async () => {
    const probe: McpProbe = async () => {
      throw new Error("should not be called");
    };
    await expect(remoteMcpConnectorUsable("https://tools.example.test/mcp", probe)).resolves.toBe(
      null,
    );
  });
});
