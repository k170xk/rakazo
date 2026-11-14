import { describe, expect, it } from "vitest";
import type { OutgoingEmail } from "./microsoft-mail-send.js";
import {
  createOutlookDraft,
  OutlookNotSentError,
  sendOutlookEmail,
  sendsOutlookMail,
} from "./microsoft-mail-send.js";

type Call = { method: string; path: string; body: unknown };

function graph(responses: Record<string, (call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetch = (async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace("https://graph.microsoft.com/v1.0", "");
    const method = init?.method ?? "GET";
    const call = { method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const key = Object.keys(responses).find((pattern) => `${method} ${path}`.startsWith(pattern));
    return key ? responses[key]!(call) : new Response("", { status: 204 });
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const email = (patch: Partial<OutgoingEmail> = {}): OutgoingEmail => ({
  mode: "new",
  to: ["client@example.com"],
  cc: [],
  bcc: [],
  subject: "Drawings",
  bodyHtml: "<p>Please find attached.</p>",
  signatureHtml: "<p>Keith</p>",
  attachments: [],
  ...patch,
});

describe("createOutlookDraft", () => {
  it("creates a draft in Outlook with the signature and attachments without calling send", async () => {
    const { calls, fetch } = graph({
      "POST /me/messages/m1/attachments": () => json({}, 201),
      "POST /me/messages": () =>
        json({ id: "m1", webLink: "https://outlook.office.com/mail/drafts/id/m1" }, 201),
    });
    const created = await createOutlookDraft(
      email({
        attachments: [
          { name: "a.pdf", mimeType: "application/pdf", bytes: new Uint8Array([1, 2]) },
        ],
      }),
      "token",
      { fetch },
    );
    expect(created).toEqual({
      id: "m1",
      webLink: "https://outlook.office.com/mail/drafts/id/m1",
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /me/messages",
      "POST /me/messages/m1/attachments",
    ]);
    expect(calls.some((call) => call.path.endsWith("/send"))).toBe(false);
    const body = calls[0]!.body as { body: { content: string }; toRecipients: unknown };
    expect(body.body.content).toContain("Please find attached.");
    expect(body.body.content).toContain("<p>Keith</p>");
    expect(body.toRecipients).toEqual([{ emailAddress: { address: "client@example.com" } }]);
  });

  it("creates a reply draft in the original conversation keeping Outlook's quoted history", async () => {
    const { calls, fetch } = graph({
      "POST /me/messages/orig/createReplyAll": () =>
        json({
          id: "r1",
          webLink: "https://outlook.office.com/mail/drafts/id/r1",
          body: { content: "<html><body><div>Earlier email</div></body></html>" },
        }),
      "PATCH /me/messages/r1": () => json({}),
    });
    const created = await createOutlookDraft(
      email({ mode: "reply_all", replyToMessageId: "orig" }),
      "token",
      { fetch },
    );
    expect(created).toEqual({
      id: "r1",
      webLink: "https://outlook.office.com/mail/drafts/id/r1",
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /me/messages/orig/createReplyAll",
      "PATCH /me/messages/r1",
    ]);
    expect(calls.some((call) => call.path.endsWith("/send"))).toBe(false);
    const content = (calls[1]!.body as { body: { content: string } }).body.content;
    expect(content.indexOf("Please find attached.")).toBeLessThan(content.indexOf("Earlier email"));
  });

  it("deletes a half-built draft when an attachment fails", async () => {
    const { calls, fetch } = graph({
      "POST /me/messages/m1/attachments": () => json({ error: { message: "Too large" } }, 413),
      "POST /me/messages": () => json({ id: "m1" }, 201),
    });
    await expect(
      createOutlookDraft(
        email({
          attachments: [{ name: "big.zip", mimeType: "application/zip", bytes: new Uint8Array(1) }],
        }),
        "token",
        { fetch },
      ),
    ).rejects.toBeInstanceOf(OutlookNotSentError);
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "/me/messages/m1" });
  });
});

describe("sendOutlookEmail", () => {
  it("creates the message with the signature, attaches files, then sends it", async () => {
    const { calls, fetch } = graph({
      "POST /me/messages/m1/attachments": () => json({}, 201),
      "POST /me/messages/m1/send": () => new Response("", { status: 202 }),
      "POST /me/messages": () => json({ id: "m1" }, 201),
    });
    await sendOutlookEmail(
      email({
        attachments: [
          { name: "a.pdf", mimeType: "application/pdf", bytes: new Uint8Array([1, 2]) },
        ],
      }),
      "token",
      { fetch },
    );
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /me/messages",
      "POST /me/messages/m1/attachments",
      "POST /me/messages/m1/send",
    ]);
    const created = calls[0]!.body as { body: { content: string }; toRecipients: unknown };
    expect(created.body.content).toContain("Please find attached.");
    expect(created.body.content).toContain("<p>Keith</p>");
    expect(created.toRecipients).toEqual([{ emailAddress: { address: "client@example.com" } }]);
    expect((calls[1]!.body as { contentBytes: string }).contentBytes).toBe("AQI=");
  });

  it("replies in the original's conversation, keeping Outlook's quoted history", async () => {
    const { calls, fetch } = graph({
      "POST /me/messages/orig/createReplyAll": () =>
        json({ id: "r1", body: { content: "<html><body><div>Earlier email</div></body></html>" } }),
      "PATCH /me/messages/r1": () => json({}),
      "POST /me/messages/r1/send": () => new Response("", { status: 202 }),
    });
    await sendOutlookEmail(email({ mode: "reply_all", replyToMessageId: "orig" }), "token", {
      fetch,
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /me/messages/orig/createReplyAll",
      "PATCH /me/messages/r1",
      "POST /me/messages/r1/send",
    ]);
    const content = (calls[1]!.body as { body: { content: string } }).body.content;
    expect(content.indexOf("Please find attached.")).toBeLessThan(content.indexOf("Earlier email"));
  });

  it("deletes the half-built draft and reports nothing sent when a step before sending fails", async () => {
    const { calls, fetch } = graph({
      "POST /me/messages/m1/attachments": () => json({ error: { message: "Too large" } }, 413),
      "POST /me/messages": () => json({ id: "m1" }, 201),
    });
    const sending = sendOutlookEmail(
      email({
        attachments: [{ name: "big.zip", mimeType: "application/zip", bytes: new Uint8Array(1) }],
      }),
      "token",
      { fetch },
    );
    await expect(sending).rejects.toBeInstanceOf(OutlookNotSentError);
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "/me/messages/m1" });
    expect(calls.some((call) => call.path.endsWith("/send"))).toBe(false);
  });

  it("does not call a lost answer to send 'not sent', so it is never retried", async () => {
    const { calls, fetch } = graph({
      "POST /me/messages/m1/send": () => {
        throw new TypeError("socket hang up");
      },
      "POST /me/messages": () => json({ id: "m1" }, 201),
    });
    const sending = sendOutlookEmail(email(), "token", { fetch });
    await expect(sending).rejects.toThrow("socket hang up");
    await expect(sending).rejects.not.toBeInstanceOf(OutlookNotSentError);
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  });
});

describe("sendsOutlookMail", () => {
  it("catches other apps' Outlook send, reply and forward tools but not drafts or reads", () => {
    expect(sendsOutlookMail("OUTLOOK_OUTLOOK_SEND_EMAIL")).toBe(true);
    expect(sendsOutlookMail("OUTLOOK_SEND_DRAFT")).toBe(true);
    expect(sendsOutlookMail("OUTLOOK_OUTLOOK_REPLY_EMAIL")).toBe(true);
    expect(sendsOutlookMail("outlook_forward_message")).toBe(true);
    expect(sendsOutlookMail("OUTLOOK_CREATE_DRAFT_REPLY")).toBe(false);
    expect(sendsOutlookMail("outlook_search_messages")).toBe(false);
    expect(sendsOutlookMail("outlook_draft_email")).toBe(false);
    expect(sendsOutlookMail("GMAIL_SEND_EMAIL")).toBe(false);
  });
});
