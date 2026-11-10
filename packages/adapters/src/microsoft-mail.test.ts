import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ConnectorEvent } from "@rakazo/adapter-kit";
import { connectorToolRequiresApproval } from "@rakazo/core";
import { describe, expect, it } from "vitest";
import { computerFileName } from "./microsoft-connector.js";
import type { MailGraph } from "./microsoft-mail.js";
import {
  assertMailRead,
  bodyText,
  MAIL_BODY_CHARS,
  messageFilter,
  OUTLOOK_SCOPES,
  OUTLOOK_TOOL_NAMES,
  outlookTools,
  readOnlyMail,
  runMailTool,
  searchPhrase,
} from "./microsoft-mail.js";

function fakeGraph(responses: Record<string, unknown>, bytes = "attachment bytes") {
  const calls: Array<{ path: string; headers?: Record<string, string> }> = [];
  const graph: MailGraph = {
    async json<T>(path: string, headers?: Record<string, string>) {
      calls.push({ path, headers });
      const key = Object.keys(responses).find((prefix) => path.startsWith(prefix));
      if (!key) throw new Error(`Outlook could not find that email, folder or attachment.`);
      return responses[key] as T;
    },
    async bytes(path: string) {
      calls.push({ path });
      return new TextEncoder().encode(bytes);
    },
    fileName: computerFileName,
  };
  return { graph, calls };
}

async function run(graph: MailGraph, tool: string, args: Record<string, unknown>) {
  const events: ConnectorEvent[] = [];
  for await (const event of runMailTool(graph, tool, args)) events.push(event);
  return events;
}

describe("Outlook permissions and tools", () => {
  it("asks for the consented mail permission and never for sending or other mailboxes", () => {
    expect(OUTLOOK_SCOPES.split(" ")).toEqual([
      "openid",
      "profile",
      "offline_access",
      "User.Read",
      "Mail.ReadWrite",
    ]);
    expect(OUTLOOK_SCOPES).not.toMatch(/Send|Files|Sites|Shared|MailboxSettings|\.All/i);
  });

  it("allows only mailbox listings and reads", () => {
    for (const path of [
      "/me/mailFolders?$top=100",
      "/me/mailFolders/inbox/childFolders",
      "/me/mailFolders/inbox/messages?$top=20",
      "/me/messages?$search=%22budget%22",
      "/me/messages/AAMk%3D",
      "/me/messages/AAMk/attachments?$top=50",
      "/me/messages/AAMk/attachments/att-1",
      "/me/messages/AAMk/attachments/att-1/$value",
    ]) {
      expect(() => assertMailRead(path), path).not.toThrow();
    }
    for (const path of [
      "/me/sendMail",
      "/me/messages/AAMk/send",
      "/me/messages/AAMk/move",
      "/me/messages/AAMk/copy",
      "/me/messages/AAMk/reply",
      "/me/messages/AAMk/replyAll",
      "/me/messages/AAMk/forward",
      "/me/messages/AAMk/createReply",
      "/me/messages/AAMk/createForward",
      "/me/messages/AAMk/permanentDelete",
      "/me/mailFolders/inbox/messages/delta",
      "/me/mailFolders/inbox/move",
      "/me/mailFolders/inbox/messageRules",
      "/me/messages/AAMk/attachments/createUploadSession",
      "/me/messages/AAMk/attachments/microsoft.graph.createUploadSession",
      "/me/messages/delta",
      "/me/messages/AAMk/attachments/%2E%2E",
      "/me/messages/../sendMail",
      "/me/messages/./x/send",
      "/me/mailboxSettings",
      "/me/drive/root",
      "/users/someone@ocsc.ie/messages",
      "",
    ]) {
      expect(() => assertMailRead(path), path).toThrow(/read-only/);
    }
  });

  it("refuses any request a tool would make outside the read paths, and unknown tools", async () => {
    const calls: string[] = [];
    const graph: MailGraph = {
      async json<T>(path: string) {
        calls.push(path);
        return {} as T;
      },
      async bytes(path: string) {
        calls.push(path);
        return new Uint8Array();
      },
      fileName: computerFileName,
    };
    expect(() => readOnlyMail(graph).json("/me/messages/AAMk/send")).toThrow(/read-only/);
    expect(() => readOnlyMail(graph).bytes("/me/sendMail", 10)).toThrow(/read-only/);
    expect(await run(graph, "outlook_send_message", { message_id: "AAMk" })).toEqual([
      { type: "error", message: "unknown tool outlook_send_message" },
    ]);
    expect(calls).toEqual([]);
  });

  it("has no code that writes to a mailbox", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./microsoft-mail.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/\b(POST|PATCH|PUT|DELETE)\b|method\s*:/);
    expect(source).not.toMatch(
      /sendMail|createReply|createForward|permanentDelete|\/move\b|\/copy\b/,
    );
  });

  it("offers only tools the approval rules see as reads", () => {
    const tools = outlookTools((toolName) => ({ connectorId: "microsoft", toolName }));
    expect(tools.map((tool) => tool.name)).toEqual([
      "outlook_list_folders",
      "outlook_list_messages",
      "outlook_search",
      "outlook_read_message",
      "outlook_read_attachment",
    ]);
    expect(tools.map((tool) => tool.name)).toEqual(OUTLOOK_TOOL_NAMES);
    for (const tool of tools) {
      expect(tool.readOnly).toBe(true);
      expect(connectorToolRequiresApproval(tool.name, tool.readOnly)).toBe(false);
    }
  });
});

describe("Outlook queries", () => {
  it("puts the date first in any filter so Outlook can sort by it", () => {
    expect(messageFilter({})).toBeUndefined();
    expect(messageFilter({ unread_only: true, from: "Anne@Example.com" })).toBe(
      "receivedDateTime ge 1900-01-01T00:00:00.000Z and isRead eq false and from/emailAddress/address eq 'anne@example.com'",
    );
    expect(
      messageFilter({ since: "2026-11-01", before: "2026-11-08", has_attachments: true }),
    ).toBe(
      "receivedDateTime ge 2026-11-01T00:00:00.000Z and receivedDateTime lt 2026-11-08T00:00:00.000Z and hasAttachments eq true",
    );
  });

  it("refuses values that could change the query", () => {
    expect(() => messageFilter({ from: "x' or 1 eq 1" })).toThrow(/email address/);
    expect(() => messageFilter({ since: "last week" })).toThrow(/date/);
    expect(searchPhrase('budget "Q3" \\ report')).toBe('"budget  Q3    report"');
    expect(() => searchPhrase("  ")).toThrow(/words/);
  });

  it("turns an HTML body into text", () => {
    expect(
      bodyText({
        contentType: "html",
        content: "<style>p{}</style><p>Hi&nbsp;Anne</p><p>See &lt;attached&gt; &amp; reply</p>",
      }),
    ).toBe("Hi Anne\nSee <attached> & reply");
    expect(bodyText({ contentType: "text", content: "  plain  " })).toBe("plain");
  });
});

describe("Outlook tools", () => {
  const message = {
    id: "msg-1",
    subject: "Site visit",
    from: { emailAddress: { name: "Anne", address: "anne@example.com" } },
    toRecipients: [{ emailAddress: { address: "keith@example.com" } }],
    receivedDateTime: "2026-11-09T10:00:00Z",
    isRead: false,
    hasAttachments: true,
    importance: "normal",
    bodyPreview: "Please see the report",
    conversationId: "conv-1",
    parentFolderId: "inbox-id",
  };

  it("lists the Inbox newest first with a short preview", async () => {
    const { graph, calls } = fakeGraph({ "/me/mailFolders/inbox/messages": { value: [message] } });
    const [event] = await run(graph, "outlook_list_messages", { unread_only: true, limit: 5 });
    expect(calls[0]!.path).toContain("$orderby=receivedDateTime%20desc");
    expect(calls[0]!.path).toContain("$top=5");
    expect(event).toMatchObject({
      type: "result",
      data: {
        messages: [
          {
            message_id: "msg-1",
            from: "Anne <anne@example.com>",
            to: ["keith@example.com"],
            unread: true,
            preview: "Please see the report",
          },
        ],
      },
    });
  });

  it("lists a whole thread in order without asking Outlook to sort it", async () => {
    const later = { ...message, id: "msg-2", receivedDateTime: "2026-11-10T10:00:00Z" };
    const { graph, calls } = fakeGraph({ "/me/messages?": { value: [later, message] } });
    const [event] = await run(graph, "outlook_list_messages", { conversation_id: "conv-1" });
    expect(calls[0]!.path).not.toContain("$orderby");
    expect(
      (event as { data: { messages: Array<{ message_id: string }> } }).data.messages.map(
        (entry) => entry.message_id,
      ),
    ).toEqual(["msg-1", "msg-2"]);
  });

  it("searches the whole mailbox or one folder", async () => {
    const { graph, calls } = fakeGraph({
      "/me/messages?": { value: [] },
      "/me/mailFolders/sentitems/messages?": { value: [message] },
    });
    expect((await run(graph, "outlook_search", { query: "budget" }))[0]).toMatchObject({
      data: { results: [], note: "Nothing matched." },
    });
    await run(graph, "outlook_search", { query: "from:anne", folder_id: "SentItems" });
    expect(calls[0]!.path).toContain(`$search=${encodeURIComponent('"budget"')}`);
    expect(calls[1]!.path.startsWith("/me/mailFolders/sentitems/messages?")).toBe(true);
  });

  it("reads a message as text, cut to size, listing real attachments only", async () => {
    const { graph, calls } = fakeGraph({
      "/me/messages/msg-1/attachments": {
        value: [
          { id: "att-1", name: "report.pdf", contentType: "application/pdf", size: 10 },
          { id: "att-2", name: "logo.png", isInline: true },
        ],
      },
      "/me/messages/msg-1": {
        ...message,
        body: { contentType: "text", content: "x".repeat(MAIL_BODY_CHARS + 5) },
      },
    });
    const [event] = await run(graph, "outlook_read_message", { message_id: "msg-1" });
    expect(calls.find((call) => call.path.startsWith("/me/messages/msg-1?"))?.headers).toEqual({
      prefer: 'outlook.body-content-type="text"',
    });
    const data = (event as { data: Record<string, unknown> }).data;
    expect((data.body as string).length).toBe(MAIL_BODY_CHARS);
    expect(data.note).toMatch(/cut/);
    expect(data.attachments).toEqual([
      { attachment_id: "att-1", name: "report.pdf", type: "application/pdf", size: 10 },
    ]);
    expect(data.inline_images).toBe(1);
  });

  it("copies an attachment into the outlook folder on the computer", async () => {
    const { graph, calls } = fakeGraph({
      "/me/messages/msg-1/attachments/att-1": {
        "@odata.type": "#microsoft.graph.fileAttachment",
        id: "att-1",
        name: "../Site report.docx",
        size: 16,
      },
    });
    const events = await run(graph, "outlook_read_attachment", {
      message_id: "msg-1",
      attachment_id: "att-1",
    });
    expect(calls[1]!.path).toBe("/me/messages/msg-1/attachments/att-1/$value");
    expect(events[0]).toMatchObject({ type: "file", path: "outlook/__Site report.docx" });
    expect(events[1]).toMatchObject({ type: "result", data: { ok: true, bytes: 16 } });
  });

  it("saves an attached email as .eml and refuses link-only or oversized attachments", async () => {
    const item = fakeGraph({
      "/me/messages/m/attachments/a": {
        "@odata.type": "#microsoft.graph.itemAttachment",
        id: "a",
        name: "Fwd",
      },
    });
    expect(
      (
        await run(item.graph, "outlook_read_attachment", { message_id: "m", attachment_id: "a" })
      )[0],
    ).toMatchObject({ path: "outlook/Fwd.eml" });
    const link = fakeGraph({
      "/me/messages/m/attachments/a": {
        "@odata.type": "#microsoft.graph.referenceAttachment",
        id: "a",
      },
    });
    await expect(
      run(link.graph, "outlook_read_attachment", { message_id: "m", attachment_id: "a" }),
    ).rejects.toThrow(/only a link/);
    expect(link.calls.some((call) => call.path.endsWith("/$value"))).toBe(false);
    const big = fakeGraph({
      "/me/messages/m/attachments/a": { id: "a", name: "big.zip", size: 60 * 1024 * 1024 },
    });
    await expect(
      run(big.graph, "outlook_read_attachment", { message_id: "m", attachment_id: "a" }),
    ).rejects.toThrow(/50 MB/);
  });

  it("refuses ids that are not Outlook's", async () => {
    const { graph } = fakeGraph({});
    await expect(run(graph, "outlook_read_message", {})).rejects.toThrow(/Give the message_id/);
    await expect(run(graph, "outlook_read_message", { message_id: "a' or 'b" })).rejects.toThrow(
      /not one Outlook gave/,
    );
  });
});
