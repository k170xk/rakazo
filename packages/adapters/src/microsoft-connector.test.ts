import type { AdapterContext, ConnectorEvent, SecretStore } from "@rakazo/adapter-kit";
import { connectorToolRequiresApproval } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import type { DriveItem } from "./microsoft-connector.js";
import {
  computerFileName,
  drivePath,
  isMicrosoftEnabled,
  MICROSOFT_SCOPES,
  MicrosoftConnector,
  savedFolders,
  withinFolders,
} from "./microsoft-connector.js";
import { safeConnectorFilePath } from "./run-tools-integrations.js";

const CONFIG = {
  clientId: "fake-client",
  clientSecret: "fake-client-secret",
  tenantId: "fake-tenant",
  webOrigin: "https://computer.example",
  identitySecret: "fake-identity",
};

const context: AdapterContext = {
  operationId: "microsoft-test",
  traceId: "microsoft-test",
  spaceId: "space-1",
  userId: "user-1",
  signal: new AbortController().signal,
  connectedConnections: [
    {
      id: "conn-1",
      connectorId: "microsoft",
      externalId: "sharepoint",
      displayName: "SharePoint",
      providerRef: "state-1",
    },
  ],
};

function item(name: string, parentPath: string, extra: Partial<DriveItem> = {}): DriveItem {
  return {
    id: `id-${name}`,
    name,
    parentReference: { driveId: "drive-a", path: parentPath },
    ...extra,
  };
}

describe("SharePoint folder scope", () => {
  const projects = { driveId: "drive-a", path: "/projects" };

  it("allows the folder itself and anything below it", () => {
    expect(withinFolders(item("Projects", "/drives/drive-a/root:"), [projects])).toBe(true);
    expect(withinFolders(item("plan.pdf", "/drives/drive-a/root:/Projects/2026"), [projects])).toBe(
      true,
    );
  });

  it("refuses siblings that share a name prefix, other folders and other libraries", () => {
    expect(withinFolders(item("ProjectsOld", "/drives/drive-a/root:"), [projects])).toBe(false);
    expect(withinFolders(item("hr.docx", "/drives/drive-a/root:/HR"), [projects])).toBe(false);
    expect(
      withinFolders(
        {
          ...item("plan.pdf", "/drives/drive-b/root:/Projects"),
          parentReference: { driveId: "drive-b", path: "/drives/drive-b/root:/Projects" },
        },
        [projects],
      ),
    ).toBe(false);
  });

  it("treats a whole library as its root and reads encoded paths", () => {
    const library = { driveId: "drive-a", path: "" };
    expect(withinFolders(item("a.docx", "/drives/drive-a/root:/Any%20Folder"), [library])).toBe(
      true,
    );
    expect(drivePath(item("a.docx", "/drive/root:/Any%20Folder"))).toBe("/any folder/a.docx");
    expect(drivePath({ id: "r", name: "root", root: {} })).toBe("");
  });

  it("refuses an item whose place SharePoint did not report", () => {
    expect(
      withinFolders({ id: "x", name: "x", parentReference: { driveId: "drive-a" } }, [projects]),
    ).toBe(false);
  });

  it("reads only well-formed saved folders", () => {
    expect(
      savedFolders({
        folders: [
          { driveId: "d", itemId: "i", name: "N", location: "L", webUrl: null },
          { driveId: 1 },
        ],
      }),
    ).toEqual([{ driveId: "d", itemId: "i", name: "N", location: "L", webUrl: null }]);
    expect(savedFolders(null)).toEqual([]);
  });
});

describe("file names and paths", () => {
  it("keeps a read file inside its folder on the computer", () => {
    expect(computerFileName("../Q3 report.docx")).toBe("__Q3 report.docx");
    expect(computerFileName("a/b\\c.pdf")).toBe("a_b_c.pdf");
    expect(computerFileName("")).toBe("file");
    expect(safeConnectorFilePath("sharepoint/report.docx")).toBe("sharepoint/report.docx");
    expect(safeConnectorFilePath("../etc/passwd")).toBeUndefined();
    expect(safeConnectorFilePath("/etc/passwd")).toBeUndefined();
    expect(safeConnectorFilePath("report.docx")).toBeUndefined();
    expect(safeConnectorFilePath("sharepoint/a\\b")).toBeUndefined();
  });
});

describe("MicrosoftConnector", () => {
  it("needs every setting", () => {
    expect(isMicrosoftEnabled({ ...CONFIG, clientSecret: "" })).toBe(false);
  });

  it("offers only tools the approval rules see as reads", async () => {
    const connector = new MicrosoftConnector(
      CONFIG,
      {
        connection: {
          findMany: vi.fn(async () => [
            {
              id: "conn-1",
              status: "connected",
              secretId: "s",
              providerRef: "state-1",
              metadata: {},
            },
          ]),
        },
      } as unknown as PrismaClient,
      {} as SecretStore,
    );
    const tools = await connector.discoverTools(context);
    expect(tools.map((tool) => tool.name)).toEqual([
      "sharepoint_list_folders",
      "sharepoint_search",
      "sharepoint_list",
      "sharepoint_read_file",
    ]);
    for (const tool of tools) {
      expect(tool.readOnly).toBe(true);
      expect(connectorToolRequiresApproval(tool.name, tool.readOnly)).toBe(false);
    }
  });

  it("asks Microsoft only for read permissions, with PKCE", async () => {
    const connector = new MicrosoftConnector(CONFIG, {} as PrismaClient, {} as SecretStore);
    const started = await connector.begin(
      { provider: "sharepoint", redirectUrl: "ignored" },
      context,
    );
    const url = new URL(started.authorizationUrl!);
    expect(url.origin).toBe("https://login.microsoftonline.com");
    expect(url.pathname).toBe("/fake-tenant/oauth2/v2.0/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://computer.example/api/v1/connections/microsoft/callback",
    );
    expect(url.searchParams.get("state")).toBe(started.state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe(MICROSOFT_SCOPES);
    expect(MICROSOFT_SCOPES).not.toMatch(/Write|Manage|FullControl/i);
  });

  function connectorWithSharePoint(items: Record<string, DriveItem>) {
    const row = {
      id: "conn-1",
      spaceId: "space-1",
      userId: "user-1",
      status: "connected",
      secretId: "secret-1",
      providerRef: "state-1",
      metadata: {
        folders: [
          {
            driveId: "drive-a",
            itemId: "id-Projects",
            name: "Projects",
            location: "",
            webUrl: null,
          },
        ],
      },
    };
    const prisma = {
      connection: { findMany: vi.fn(async () => [row]), updateMany: vi.fn() },
      secret: { findFirst: vi.fn(async () => ({ id: "secret-1", ciphertext: "cipher" })) },
    } as unknown as PrismaClient;
    const secrets = {
      load: vi.fn(async () => JSON.stringify({ refreshToken: "fake-refresh" })),
    } as unknown as SecretStore;
    const requests: string[] = [];
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      requests.push(url.pathname);
      if (url.hostname === "login.microsoftonline.com") {
        return Response.json({ access_token: "fake-access", expires_in: 3_600 });
      }
      const contentMatch = url.pathname.match(/\/items\/([^/]+)\/content$/);
      if (contentMatch) return new Response(new TextEncoder().encode("file bytes"));
      const itemMatch = url.pathname.match(/\/items\/([^/]+)$/);
      const found = itemMatch ? items[decodeURIComponent(itemMatch[1]!)] : undefined;
      return found
        ? Response.json(found)
        : Response.json({ error: { message: "nope" } }, { status: 404 });
    }) as unknown as typeof globalThis.fetch;
    return { connector: new MicrosoftConnector(CONFIG, prisma, secrets, { fetch }), requests };
  }

  async function run(connector: MicrosoftConnector, tool: string, args: Record<string, unknown>) {
    const events: ConnectorEvent[] = [];
    for await (const event of connector.execute(
      {
        tool,
        args,
        executionId: "e1",
        route: { connectorId: "microsoft", toolName: tool, connectionId: "conn-1" },
      },
      context,
    ))
      events.push(event);
    return events;
  }

  const folder = item("Projects", "/drives/drive-a/root:", { folder: {} });
  const inside = item("plan.pdf", "/drives/drive-a/root:/Projects", { size: 10, file: {} });
  const outside = item("salaries.xlsx", "/drives/drive-a/root:/HR", { size: 10, file: {} });

  it("copies a file from a chosen folder onto the computer", async () => {
    const { connector } = connectorWithSharePoint({
      "id-Projects": folder,
      "id-plan.pdf": inside,
    });
    const events = await run(connector, "sharepoint_read_file", {
      drive_id: "drive-a",
      item_id: "id-plan.pdf",
    });
    expect(events[0]).toMatchObject({ type: "file", path: "sharepoint/plan.pdf" });
    expect(new TextDecoder().decode((events[0] as { content: Uint8Array }).content)).toBe(
      "file bytes",
    );
    expect(events[1]).toMatchObject({
      type: "result",
      data: { ok: true, path: "sharepoint/plan.pdf" },
    });
  });

  it("refuses a file outside the chosen folders without downloading it", async () => {
    const { connector, requests } = connectorWithSharePoint({
      "id-Projects": folder,
      "id-salaries.xlsx": outside,
    });
    const events = await run(connector, "sharepoint_read_file", {
      drive_id: "drive-a",
      item_id: "id-salaries.xlsx",
    });
    expect(events).toEqual([
      { type: "error", message: "That item is outside the SharePoint folders the person chose." },
    ]);
    expect(requests.some((path) => path.endsWith("/content"))).toBe(false);
  });

  function outlookConnector() {
    const row = {
      id: "conn-mail",
      spaceId: "space-1",
      userId: "user-1",
      provider: "outlook",
      status: "connected",
      secretId: "secret-mail",
      providerRef: "state-mail",
      metadata: {},
    };
    const findMany = vi.fn(async (query: { where: { provider: unknown } }) =>
      query.where.provider === "sharepoint" ? [] : [row],
    );
    const prisma = {
      connection: { findMany, updateMany: vi.fn() },
      secret: { findFirst: vi.fn(async () => ({ id: "secret-mail", ciphertext: "cipher" })) },
    } as unknown as PrismaClient;
    const secrets = {
      load: vi.fn(async () => JSON.stringify({ refreshToken: "fake-refresh" })),
    } as unknown as SecretStore;
    const requests: Array<{
      url: URL;
      method?: string;
      body?: string;
      headers: Record<string, string>;
    }> = [];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      requests.push({
        url,
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : init?.body?.toString(),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      });
      if (url.hostname === "login.microsoftonline.com") {
        return Response.json({ access_token: "fake-mail-access", expires_in: 3_600 });
      }
      return Response.json({
        value: [{ id: "inbox-id", displayName: "Inbox", unreadItemCount: 2 }],
      });
    }) as unknown as typeof globalThis.fetch;
    return {
      connector: new MicrosoftConnector(CONFIG, prisma, secrets, { fetch }),
      requests,
      findMany,
    };
  }

  const mailContext: AdapterContext = {
    ...context,
    connectedConnections: [
      {
        id: "conn-mail",
        connectorId: "microsoft",
        externalId: "outlook",
        displayName: "Outlook",
        providerRef: "state-mail",
      },
    ],
  };

  async function runMail(
    connector: MicrosoftConnector,
    tool: string,
    on: AdapterContext,
    connectionId = "conn-mail",
    args: Record<string, unknown> = {},
  ) {
    const events: ConnectorEvent[] = [];
    for await (const event of connector.execute(
      {
        tool,
        args,
        executionId: "e-mail",
        route: { connectorId: "microsoft", toolName: tool, connectionId },
      },
      on,
    ))
      events.push(event);
    return events;
  }

  it("lists both Microsoft apps, each with its own sign-in", async () => {
    const connector = new MicrosoftConnector(
      CONFIG,
      { connection: { findMany: vi.fn(async () => []) } } as unknown as PrismaClient,
      {} as SecretStore,
    );
    expect((await connector.catalog(context)).map((item) => item.slug)).toEqual([
      "sharepoint",
      "outlook",
    ]);
    expect((await connector.catalog(context, "email")).map((item) => item.slug)).toEqual([
      "outlook",
    ]);
    const started = await connector.begin({ provider: "outlook", redirectUrl: "ignored" }, context);
    expect(new URL(started.authorizationUrl!).searchParams.get("scope")).toBe(
      "openid profile offline_access User.Read Mail.ReadWrite",
    );
  });

  it("offers mail tools for an Outlook connection and reads with its own token and scope", async () => {
    const { connector, requests } = outlookConnector();
    expect((await connector.discoverTools(mailContext)).map((tool) => tool.name)).toEqual([
      "outlook_list_folders",
      "outlook_list_messages",
      "outlook_search",
      "outlook_read_message",
      "outlook_read_attachment",
    ]);
    const events = await runMail(connector, "outlook_list_folders", mailContext);
    expect(events).toEqual([
      {
        type: "result",
        data: { folders: [{ folder_id: "inbox-id", name: "Inbox", unread: 2, total: undefined }] },
      },
    ]);
    const token = requests.find((request) => request.url.hostname === "login.microsoftonline.com");
    expect(new URLSearchParams(token!.body).get("scope")).toBe(
      "openid profile offline_access User.Read Mail.ReadWrite",
    );
    expect(requests.at(-1)!.url.pathname).toBe("/v1.0/me/mailFolders");
  });

  it("refuses mail when this run was not given the Outlook connection", async () => {
    const { connector, requests } = outlookConnector();
    // A run without the Outlook connection, here one given only SharePoint.
    const events = await runMail(connector, "outlook_list_folders", context);
    expect(events).toEqual([
      {
        type: "error",
        message: "Outlook is only available in the person's own chat with their own assistant.",
      },
    ]);
    // A SharePoint connection cannot be used to reach mail, nor Outlook for files.
    expect((await runMail(connector, "outlook_search", context, "conn-1"))[0]?.type).toBe("error");
    expect((await runMail(connector, "sharepoint_list_folders", mailContext))[0]?.type).toBe(
      "error",
    );
    expect(requests).toEqual([]);
  });

  it("reads mail only with bodiless GETs to mailbox read paths, though the token can write", async () => {
    const { connector, requests } = outlookConnector();
    const calls: Array<[string, Record<string, unknown>]> = [
      ["outlook_list_folders", { parent_folder_id: "inbox" }],
      ["outlook_list_messages", { unread_only: true, from: "anne@example.com" }],
      ["outlook_list_messages", { conversation_id: "conv-1" }],
      ["outlook_search", { query: "budget", folder_id: "inbox" }],
      ["outlook_read_message", { message_id: "AAMk" }],
      ["outlook_read_attachment", { message_id: "AAMk", attachment_id: "att-1" }],
    ];
    for (const [tool, args] of calls) {
      const events = await runMail(connector, tool, mailContext, "conn-mail", args);
      expect(
        events.some((event) => event.type === "error"),
        tool,
      ).toBe(false);
    }
    const graph = requests.filter((request) => request.url.hostname === "graph.microsoft.com");
    expect(graph.length).toBeGreaterThanOrEqual(calls.length);
    for (const request of graph) {
      expect(request.method).toBe("GET");
      expect(request.body).toBeUndefined();
      expect(request.url.pathname).toMatch(/^\/v1\.0\/me\/(mailFolders|messages)(\/|$)/);
      for (const header of Object.keys(request.headers)) {
        expect(["authorization", "accept", "prefer"]).toContain(header);
      }
    }
  });

  it("refuses any Outlook tool that is not one of its reads, before signing in", async () => {
    const { connector, requests } = outlookConnector();
    for (const tool of ["outlook_send_message", "outlook_delete_message", "outlook_move"]) {
      expect(
        await runMail(connector, tool, mailContext, "conn-mail", { message_id: "AAMk" }),
      ).toEqual([
        { type: "error", message: "Outlook is read-only here: that request was refused." },
      ]);
    }
    expect(requests).toEqual([]);
  });

  it("finishes a sign-in even when earlier attempts were abandoned, closing them", async () => {
    type Row = {
      id: string;
      spaceId: string;
      userId: string;
      connectorId: string;
      provider: string;
      status: string;
      secretId: string | null;
      providerRef: string;
      metadata: Record<string, unknown>;
    };
    const base = { spaceId: "space-1", userId: "user-1", connectorId: "microsoft", metadata: {} };
    const rows: Row[] = [
      {
        ...base,
        id: "old-1",
        provider: "outlook",
        status: "pending",
        secretId: null,
        providerRef: "s-old-1",
      },
      {
        ...base,
        id: "old-2",
        provider: "outlook",
        status: "pending",
        secretId: "sec-old",
        providerRef: "s-old-2",
      },
      {
        ...base,
        id: "new",
        provider: "outlook",
        status: "pending",
        secretId: null,
        providerRef: "s-new",
      },
      {
        ...base,
        id: "sp",
        provider: "sharepoint",
        status: "pending",
        secretId: null,
        providerRef: "s-sp",
      },
      {
        ...base,
        id: "other",
        userId: "user-2",
        provider: "outlook",
        status: "pending",
        secretId: null,
        providerRef: "s-other",
      },
    ];
    const deletedSecrets: unknown[] = [];
    const matches = (row: Row, where: Record<string, unknown>) =>
      Object.entries(where).every(([key, wanted]) => {
        const value = row[key as keyof Row];
        if (wanted && typeof wanted === "object") {
          const condition = wanted as { in?: unknown[]; not?: unknown };
          if (condition.in) return condition.in.includes(value);
          if ("not" in condition) return value !== condition.not;
        }
        return value === wanted;
      });
    const connection = {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        structuredClone(rows.find((row) => matches(row, where)) ?? null),
      ),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        structuredClone(rows.filter((row) => matches(row, where))),
      ),
      updateMany: vi.fn(
        async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
          const hit = rows.filter((row) => matches(row, where));
          for (const row of hit) Object.assign(row, data);
          return { count: hit.length };
        },
      ),
    };
    const secret = {
      create: vi.fn(async () => ({})),
      deleteMany: vi.fn(async ({ where }: { where: unknown }) => {
        deletedSecrets.push(where);
        return { count: 1 };
      }),
    };
    const prisma = {
      connection,
      secret,
      $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({ connection, secret }),
    } as unknown as PrismaClient;
    const secrets = {
      put: vi.fn(async () => ({ id: "sec-new", ciphertext: "cipher" })),
    } as unknown as SecretStore;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.hostname === "login.microsoftonline.com") {
        return Response.json({ access_token: "a", refresh_token: "r", expires_in: 3_600 });
      }
      return Response.json({ displayName: "Anne", mail: "anne@example.com" });
    }) as unknown as typeof globalThis.fetch;
    const connector = new MicrosoftConnector(CONFIG, prisma, secrets, { fetch });

    expect(await connector.connectionReady(context, "outlook")).toBe(false);
    expect(await connector.finishSignIn("user-1", { state: "s-new", code: "code" })).toBe(true);

    expect(rows.find((row) => row.id === "new")).toMatchObject({
      status: "pending",
      secretId: "sec-new",
    });
    expect(rows.find((row) => row.id === "old-1")).toMatchObject({
      status: "revoked",
      secretId: null,
    });
    expect(rows.find((row) => row.id === "old-2")).toMatchObject({
      status: "revoked",
      secretId: null,
    });
    expect(deletedSecrets).toContainEqual({ id: { in: ["sec-old"] }, userId: "user-1" });
    // Another app's attempt and another person's are left alone.
    expect(rows.find((row) => row.id === "sp")?.status).toBe("pending");
    expect(rows.find((row) => row.id === "other")?.status).toBe("pending");
    expect(await connector.connectionReady(context, "outlook")).toBe(true);
  });

  it("refuses a connection this run was not given", async () => {
    const { connector } = connectorWithSharePoint({});
    const events: ConnectorEvent[] = [];
    for await (const event of connector.execute(
      {
        tool: "sharepoint_list_folders",
        args: {},
        executionId: "e2",
        route: {
          connectorId: "microsoft",
          toolName: "sharepoint_list_folders",
          connectionId: "other",
        },
      },
      context,
    ))
      events.push(event);
    expect(events[0]?.type).toBe("error");
  });
});
