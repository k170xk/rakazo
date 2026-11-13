import type { EmailDraftMode } from "@rakazo/contracts";
import { combineSignals } from "./connector-safety.js";
import { composeEmailHtml } from "./email-html.js";

const GRAPH = "https://graph.microsoft.com/v1.0";
const REQUEST_TIMEOUT_MS = 30_000;

/** Mail.Send is asked for only when its person presses Send; assistants' tokens never carry it. */
export const OUTLOOK_SEND_SCOPES =
  "openid profile offline_access User.Read Mail.ReadWrite Mail.Send";

/**
 * Another app's tool that would send Outlook mail straight away, such as a Composio Outlook
 * send, reply or forward. Runs never get these: Outlook mail leaves only from a draft card.
 */
export function sendsOutlookMail(toolName: string): boolean {
  const name = toolName.toUpperCase();
  if (!name.includes("OUTLOOK")) return false;
  return /SEND|FORWARD/.test(name) || (name.includes("REPLY") && !name.includes("DRAFT"));
}

export interface OutgoingEmail {
  mode: EmailDraftMode;
  replyToMessageId?: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyHtml: string;
  signatureHtml: string | null;
  attachments: Array<{ name: string; mimeType: string; bytes: Uint8Array }>;
}

/**
 * Outlook refused or failed before sending, so nothing went out and the person may try again.
 * Anything thrown after the send request started is not this error: the email may have gone.
 */
export class OutlookNotSentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutlookNotSentError";
  }
}

function recipients(addresses: string[]) {
  return addresses.map((address) => ({ emailAddress: { address } }));
}

function graphMessage(status: number, text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    if (parsed.error?.message) return `Outlook refused it: ${parsed.error.message}`;
  } catch {}
  if (status === 401 || status === 403) {
    return "Outlook refused to send for this account. Reconnect Outlook and try again.";
  }
  if (status === 404) return "Outlook could not find the email this replies to.";
  return `Outlook refused it (HTTP ${status}).`;
}

/**
 * Sends one email as the signed-in person: a new message, or a reply in the original's
 * conversation with Outlook's quoted history, with the person's signature and attachments.
 */
export async function sendOutlookEmail(
  email: OutgoingEmail,
  token: string,
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<void> {
  const http = options.fetch ?? globalThis.fetch;
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await http(`${GRAPH}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: combineSignals(options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)),
    });
    const text = await response.text().catch(() => "");
    if (!response.ok) throw new OutlookNotSentError(graphMessage(response.status, text));
    return (text ? JSON.parse(text) : {}) as T;
  };
  const notSent = async <T>(step: () => Promise<T>): Promise<T> => {
    try {
      return await step();
    } catch (error) {
      if (error instanceof OutlookNotSentError) throw error;
      throw new OutlookNotSentError("Outlook could not be reached, so nothing was sent.");
    }
  };

  let draftId: string;
  if (email.mode === "new") {
    const created = await notSent(() =>
      call<{ id: string }>("POST", "/me/messages", {
        subject: email.subject,
        body: {
          contentType: "HTML",
          content: composeEmailHtml({
            bodyHtml: email.bodyHtml,
            signatureHtml: email.signatureHtml,
          }),
        },
        toRecipients: recipients(email.to),
        ccRecipients: recipients(email.cc),
        bccRecipients: recipients(email.bcc),
      }),
    );
    draftId = created.id;
  } else {
    if (!email.replyToMessageId) throw new OutlookNotSentError("This reply has no original email.");
    const original = encodeURIComponent(email.replyToMessageId);
    const action = email.mode === "reply_all" ? "createReplyAll" : "createReply";
    const reply = await notSent(() =>
      call<{ id: string; body?: { content?: string } }>(
        "POST",
        `/me/messages/${original}/${action}`,
        {},
      ),
    );
    draftId = reply.id;
    await discardOnFailure(call, draftId, () =>
      call("PATCH", `/me/messages/${encodeURIComponent(draftId)}`, {
        subject: email.subject,
        body: {
          contentType: "HTML",
          content: composeEmailHtml({
            bodyHtml: email.bodyHtml,
            signatureHtml: email.signatureHtml,
            quotedHtml: reply.body?.content ?? "",
          }),
        },
        toRecipients: recipients(email.to),
        ccRecipients: recipients(email.cc),
        bccRecipients: recipients(email.bcc),
      }),
    );
  }
  const draft = encodeURIComponent(draftId);
  for (const attachment of email.attachments) {
    await discardOnFailure(call, draftId, () =>
      call("POST", `/me/messages/${draft}/attachments`, {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: attachment.name,
        contentType: attachment.mimeType,
        contentBytes: Buffer.from(attachment.bytes).toString("base64"),
      }),
    );
  }
  try {
    await call("POST", `/me/messages/${draft}/send`);
  } catch (error) {
    // A refusal means it stayed a draft; a lost answer may mean it went, so that is not retried.
    if (error instanceof OutlookNotSentError) {
      await call("DELETE", `/me/messages/${draft}`).catch(() => undefined);
    }
    throw error;
  }
}

/** A failed step leaves no half-built draft in the person's Drafts folder. */
async function discardOnFailure(
  call: <T>(method: string, path: string, body?: unknown) => Promise<T>,
  draftId: string,
  step: () => Promise<unknown>,
): Promise<void> {
  try {
    await step();
  } catch (error) {
    await call("DELETE", `/me/messages/${encodeURIComponent(draftId)}`).catch(() => undefined);
    throw error instanceof OutlookNotSentError
      ? error
      : new OutlookNotSentError("Outlook could not be reached, so nothing was sent.");
  }
}
