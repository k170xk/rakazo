import type { ConnectorEvent } from "@rakazo/adapter-kit";
import { describe, expect, it } from "vitest";
import { computerFileName } from "./microsoft-connector.js";
import type { MailGraph, MailMessage } from "./microsoft-mail.js";
import { assertMailRead, runMailTool } from "./microsoft-mail.js";
import { mapLimited } from "./microsoft-mail-triage.js";

const ME = "me@ocsc.example";
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const person = (address: string, name?: string) => ({ emailAddress: { address, name } });

function mailbox(
  inbox: MailMessage[],
  sent: MailMessage[],
  options: { refuseExpand?: boolean } = {},
) {
  const paths: string[] = [];
  const graph: MailGraph = {
    mailbox: ME,
    async json<T>(path: string) {
      paths.push(path);
      assertMailRead(path);
      if (options.refuseExpand && path.includes("$expand")) throw new Error("HTTP 400");
      const skip = Number(/\$skip=(\d+)/.exec(path)?.[1] ?? 0);
      const top = Number(/\$top=(\d+)/.exec(path)?.[1] ?? 100);
      const source = path.includes("/sentitems/") ? sent : inbox;
      const page = source.slice(skip, skip + top);
      return {
        value: path.includes("$expand")
          ? page
          : page.map(({ attachments: _attachments, ...message }) => message),
      } as T;
    },
    async bytes() {
      return new Uint8Array();
    },
    fileName: computerFileName,
  };
  return { graph, paths };
}

async function run(graph: MailGraph, tool: string, args: Record<string, unknown>) {
  const events: ConnectorEvent[] = [];
  for await (const event of runMailTool(graph, tool, args)) events.push(event);
  return events;
}

type Triage = {
  counts: Record<string, number>;
  conversations: Record<string, Array<Record<string, unknown>>>;
  notes: string[];
  compared: { inbox: number; sent: number };
};

describe("Outlook triage", () => {
  const inbox: MailMessage[] = [
    {
      id: "a2",
      conversationId: "A",
      subject: "RE: Drawings",
      from: person("anne@client.example", "Anne"),
      toRecipients: [person(ME)],
      receivedDateTime: ago(1),
      isRead: false,
      hasAttachments: true,
      attachments: [
        { id: "x", name: "GA.pdf", isInline: false },
        { id: "y", name: "logo.png", isInline: true },
      ],
      flag: { flagStatus: "flagged", dueDateTime: { dateTime: "2026-11-12T00:00:00" } },
      bodyPreview: "Can you confirm the levels by Friday?",
    },
    {
      id: "c1",
      conversationId: "C",
      subject: "Fees",
      from: person("bob@client.example"),
      toRecipients: [person(ME)],
      receivedDateTime: ago(3),
      isRead: true,
    },
    {
      id: "d1",
      conversationId: "D",
      subject: "Minutes",
      from: person("carol@client.example"),
      toRecipients: [person("dave@client.example")],
      ccRecipients: [person(ME)],
      receivedDateTime: ago(2),
    },
    {
      id: "e1",
      conversationId: "E",
      subject: "Your invoice",
      from: person("no-reply@billing.example"),
      toRecipients: [person(ME)],
      receivedDateTime: ago(1),
    },
  ];
  const sent: MailMessage[] = [
    {
      id: "a1",
      conversationId: "A",
      subject: "Drawings",
      toRecipients: [person("anne@client.example", "Anne")],
      sentDateTime: ago(2),
    },
    {
      id: "b1",
      conversationId: "B",
      subject: "Quote",
      toRecipients: [person("erin@client.example")],
      sentDateTime: ago(5),
    },
    {
      id: "c2",
      conversationId: "C",
      subject: "RE: Fees",
      toRecipients: [person("bob@client.example")],
      sentDateTime: ago(1),
    },
  ];

  it("compares Inbox with Sent Items in one call and gives each conversation a status", async () => {
    const { graph, paths } = mailbox(inbox, sent);
    const [event] = await run(graph, "outlook_find_followups", {});
    const data = (event as { data: Triage }).data;
    expect(data.counts).toEqual({ needs_reply: 1, awaiting_reply: 1, fyi: 2, replied: 1 });
    expect(data.compared).toEqual({ inbox: 4, sent: 3 });
    expect(data.conversations.needs_reply![0]).toMatchObject({
      conversation_id: "A",
      latest_message_id: "a2",
      latest_from: "Anne <anne@client.example>",
      with: ["Anne <anne@client.example>"],
      unread: 1,
      flagged: true,
      flag_due: "2026-11-12T00:00:00",
      attachments: ["GA.pdf"],
      days_waiting: 1,
      messages: 2,
    });
    expect(data.conversations.awaiting_reply![0]).toMatchObject({
      conversation_id: "B",
      latest_from: "you",
      days_waiting: 5,
    });
    expect(data.conversations.replied![0]).toMatchObject({ conversation_id: "C" });
    expect(data.conversations.fyi!.map((thread) => thread.conversation_id).sort()).toEqual([
      "D",
      "E",
    ]);
    expect(data.notes[0]).toMatch(/email alone/);
    expect(paths).toHaveLength(2);
    expect(paths.find((path) => path.includes("/inbox/"))).toContain(
      encodeURIComponent("receivedDateTime desc"),
    );
    expect(paths.find((path) => path.includes("/sentitems/"))).toContain(
      encodeURIComponent("sentDateTime desc"),
    );
  });

  it("lists only the statuses asked for and keeps going when Outlook refuses attachment names", async () => {
    const { graph, paths } = mailbox(inbox, sent, { refuseExpand: true });
    const [event] = await run(graph, "outlook_find_followups", {
      status: ["needs_reply"],
      days: 7,
    });
    const data = (event as { data: Triage }).data;
    expect(Object.keys(data.conversations)).toEqual(["needs_reply"]);
    expect(data.conversations.needs_reply![0]).toMatchObject({ has_attachments: true });
    expect(data.notes.join(" ")).toMatch(/Attachment names were unavailable/);
    expect(paths.filter((path) => !path.includes("$expand"))).toHaveLength(2);
  });

  it("pages through a busy folder up to the limit and says when it stopped early", async () => {
    const many = Array.from({ length: 250 }, (_, index) => ({
      ...inbox[1]!,
      id: `m${index}`,
      conversationId: `M${index}`,
    }));
    const { graph, paths } = mailbox(many, []);
    const [event] = await run(graph, "outlook_find_followups", { max_messages: 200 });
    const data = (event as { data: Triage }).data;
    expect(data.compared.inbox).toBe(200);
    expect(paths.filter((path) => path.includes("/inbox/"))).toHaveLength(2);
    expect(data.notes.join(" ")).toMatch(/Only the newest 200/);
  });
});

describe("Reading several emails at once", () => {
  it("reads up to 10 with at most four requests at a time, reporting a bad one on its own", async () => {
    let running = 0;
    let peak = 0;
    const graph: MailGraph = {
      async json<T>(path: string) {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        if (path.startsWith("/me/messages/bad"))
          throw new Error("Outlook could not find that email");
        if (path.includes("/attachments")) return { value: [{ id: "f", name: "a.pdf" }] } as T;
        const id = /\/me\/messages\/([^/?]+)/.exec(path)![1];
        return { id, subject: id, body: { contentType: "text", content: "hello" } } as T;
      },
      async bytes() {
        return new Uint8Array();
      },
      fileName: computerFileName,
    };
    const ids = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "bad", "m1"];
    const [event] = await run(graph, "outlook_read_messages", { message_ids: ids });
    const messages = (event as { data: { messages: Array<Record<string, unknown>> } }).data
      .messages;
    expect(messages).toHaveLength(9);
    expect(messages[0]).toMatchObject({
      message_id: "m1",
      body: "hello",
      attachments: [{ name: "a.pdf" }],
    });
    expect(messages[8]).toEqual({ message_id: "bad", error: "Outlook could not find that email" });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("refuses more than 10 or none", async () => {
    const { graph } = mailbox([], []);
    const eleven = Array.from({ length: 11 }, (_, index) => `m${index}`);
    await expect(run(graph, "outlook_read_messages", { message_ids: eleven })).rejects.toThrow(
      /at most 10/,
    );
    await expect(run(graph, "outlook_read_messages", {})).rejects.toThrow(/up to 10/);
  });

  it("keeps order while limiting how many run at once", async () => {
    expect(await mapLimited([3, 1, 2], 2, async (n) => n * 2)).toEqual([6, 2, 4]);
  });
});
