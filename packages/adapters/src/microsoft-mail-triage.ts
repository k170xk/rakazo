import type { ConnectorTool } from "@rakazo/adapter-kit";
import type { MailGraph, MailMessage, Recipient } from "./microsoft-mail.js";
import { address, count, isoDate, PRIVATE, READ_ONLY, UNTRUSTED } from "./microsoft-mail.js";

/** Outlook serves at most four requests at once per mailbox; more are throttled. */
export const MAILBOX_CONCURRENCY = 4;
const PAGE = 100;
const FOLDER_MAX_DEFAULT = 300;
const FOLDER_MAX = 1_000;
const DAYS_DEFAULT = 14;
const DAYS_MAX = 90;
const WAITING_DAYS_DEFAULT = 3;
const PREVIEW_CHARS = 160;
const PEOPLE_SHOWN = 5;
const ATTACHMENTS_SHOWN = 8;
const DAY_MS = 86_400_000;

const STATUSES = ["needs_reply", "awaiting_reply", "fyi", "replied"] as const;
type Status = (typeof STATUSES)[number];
const SHOWN: Record<Status, number> = {
  needs_reply: 60,
  awaiting_reply: 40,
  fyi: 30,
  replied: 30,
};

/** Mail not waiting on the person: their own, unsent, binned, junk or Outlook's housekeeping. */
const SKIPPED_FOLDERS = [
  "sentitems",
  "drafts",
  "outbox",
  "deleteditems",
  "junkemail",
  "conversationhistory",
  "syncissues",
  "conflicts",
  "localfailures",
  "serverfailures",
];
const FOLDER_NAMES_LOOKED_UP = 40;

const FIELDS =
  "id,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,hasAttachments,isRead,importance,flag,inferenceClassification,conversationId,parentFolderId,bodyPreview";
const EXPAND_ATTACHMENTS = encodeURIComponent("attachments($select=name,isInline)");
const AUTOMATED =
  /(^|[._-])(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|alerts?|bounce)([._-]|@)/i;

export function triageTool(): Omit<ConnectorTool, "route"> {
  return {
    name: "outlook_find_followups",
    description: `In one call, compare the mail the person received in every folder (Inbox and all other folders and sub-folders, including those Outlook rules file mail into; not Junk, Deleted Items, Drafts or Outbox) with their Sent Items over recent days and group the mail into conversations, each with a status: needs_reply (they wrote last, to the person), awaiting_reply (the person wrote last at least waiting_days ago with no answer), fyi (copied only, automated or in Outlook's Other tab) or replied. Each shows the folder when it is not the Inbox, the people, dates, days waiting, unread count, Outlook flags and due dates, attachment names and the latest preview, with the latest message_id to read in full (outlook_read_messages reads up to 10 at once). Use this first for follow-ups, outstanding actions or what needs attention; it suits routines. The status comes from email alone: something handled by phone, Teams or in person can still show as needing a reply, so present it as likely rather than certain. ${READ_ONLY} ${PRIVATE} ${UNTRUSTED}`,
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: `How many days back to look; ${DAYS_DEFAULT} by default, up to ${DAYS_MAX}`,
        },
        since: { type: "string", description: "Look from this date instead (ISO 8601)" },
        waiting_days: {
          type: "number",
          description: `Days without an answer before the person's own email counts as awaiting_reply; ${WAITING_DAYS_DEFAULT} by default`,
        },
        status: {
          type: "array",
          items: { type: "string", enum: [...STATUSES] },
          description: "Only these statuses; all by default",
        },
        max_messages: {
          type: "number",
          description: `Most emails read from each of received mail and Sent Items; ${FOLDER_MAX_DEFAULT} by default, up to ${FOLDER_MAX}`,
        },
      },
    },
    readOnly: true,
  };
}

/** Runs fn over items with at most `limit` running at once, keeping their order. */
export async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

interface Collected {
  messages: MailMessage[];
  truncated: boolean;
  attachmentNames: boolean;
}

interface Folders {
  inbox?: string;
  skipped: Set<string>;
}

/**
 * The ids of the Inbox and of the folders whose mail is skipped, or null when Sent Items cannot
 * be found, since without it the person's own mail would read as received.
 */
async function mailboxFolders(graph: MailGraph): Promise<Folders | null> {
  const ids = await mapLimited(["inbox", ...SKIPPED_FOLDERS], MAILBOX_CONCURRENCY, (name) =>
    graph.json<{ id?: string }>(`/me/mailFolders/${name}?$select=id`).then(
      (folder) => folder.id,
      () => undefined,
    ),
  );
  if (!ids[1]) return null;
  // Deleting a folder moves it, with its mail, under Deleted Items.
  const binned = ids[4]
    ? await graph
        .json<{ value?: Array<{ id?: string }> }>(
          `/me/mailFolders/deleteditems/childFolders?$top=100&$select=id`,
        )
        .then(
          (listed) => listed.value ?? [],
          () => [],
        )
    : [];
  return {
    inbox: ids[0],
    skipped: new Set(
      [...ids.slice(1), ...binned.map((folder) => folder.id)].filter((id): id is string =>
        Boolean(id),
      ),
    ),
  };
}

async function collect(
  graph: MailGraph,
  messagesPath: string,
  field: "receivedDateTime" | "sentDateTime",
  since: string,
  max: number,
): Promise<Collected> {
  const query = (skip: number, expand: boolean) =>
    `${messagesPath}?$top=${Math.min(PAGE, max - skip)}${skip ? `&$skip=${skip}` : ""}&$filter=${encodeURIComponent(`${field} ge ${since}`)}&$orderby=${encodeURIComponent(`${field} desc`)}&$select=${FIELDS}${expand ? `&$expand=${EXPAND_ATTACHMENTS}` : ""}`;
  let expand = true;
  const messages: MailMessage[] = [];
  for (let skip = 0; skip < max; skip += PAGE) {
    let page: { value?: MailMessage[] };
    try {
      page = await graph.json(query(skip, expand));
    } catch (error) {
      // Attachment names are a bonus; the listing still works without them.
      if (!expand || skip > 0) throw error;
      expand = false;
      page = await graph.json(query(skip, expand));
    }
    const value = page.value ?? [];
    messages.push(...value);
    if (value.length < Math.min(PAGE, max - skip)) {
      return { messages, truncated: false, attachmentNames: expand };
    }
  }
  return { messages, truncated: true, attachmentNames: expand };
}

function email(recipient: Recipient | undefined): string {
  return recipient?.emailAddress?.address?.toLowerCase() ?? "";
}

function daysSince(iso: string | undefined, now: number): number | undefined {
  if (!iso) return undefined;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? undefined : Math.max(0, Math.floor((now - time) / DAY_MS));
}

interface Thread {
  key: string;
  received: MailMessage[];
  sent: MailMessage[];
}

function latest(messages: MailMessage[], field: "receivedDateTime" | "sentDateTime") {
  return messages.reduce<MailMessage | undefined>(
    (best, message) => ((message[field] ?? "") > (best?.[field] ?? "") ? message : best),
    undefined,
  );
}

interface ThreadSummary {
  [field: string]: unknown;
  flagged?: boolean;
  last_received?: string;
  last_sent?: string;
  days_waiting?: number;
}

function describeThread(
  thread: Thread,
  mailbox: string | undefined,
  waitingDays: number,
  now: number,
  folders: Folders | null,
): { status: Status; data: ThreadSummary } {
  const lastIn = latest(thread.received, "receivedDateTime");
  const filedIn =
    folders && lastIn?.parentFolderId !== folders.inbox ? lastIn?.parentFolderId : undefined;
  const lastOut = latest(thread.sent, "sentDateTime");
  const inAt = lastIn?.receivedDateTime ?? "";
  const outAt = lastOut?.sentDateTime ?? "";
  const theyWroteLast = Boolean(lastIn) && inAt > outAt;
  let status: Status;
  if (theyWroteLast && lastIn) {
    const direct =
      !mailbox || (lastIn.toRecipients ?? []).some((recipient) => email(recipient) === mailbox);
    const automated =
      AUTOMATED.test(email(lastIn.from)) || lastIn.inferenceClassification === "other";
    status = direct && !automated ? "needs_reply" : "fyi";
  } else {
    status = (daysSince(outAt, now) ?? 0) >= waitingDays ? "awaiting_reply" : "replied";
  }
  const newest = theyWroteLast ? lastIn : (lastOut ?? lastIn);
  const people = new Set<string>();
  for (const message of thread.received) {
    const from = address(message.from);
    if (from && email(message.from) !== mailbox) people.add(from);
  }
  for (const message of thread.sent) {
    for (const recipient of message.toRecipients ?? []) {
      const to = address(recipient);
      if (to && email(recipient) !== mailbox) people.add(to);
    }
  }
  const attachments = new Set<string>();
  for (const message of [...thread.received, ...thread.sent]) {
    for (const attachment of message.attachments ?? []) {
      if (!attachment.isInline && attachment.name) attachments.add(attachment.name);
    }
  }
  const hasAttachments = [...thread.received, ...thread.sent].some((m) => m.hasAttachments);
  const flags = thread.received.map((message) => message.flag).filter(Boolean);
  const open = flags.find((flag) => flag?.flagStatus === "flagged");
  const preview = newest?.bodyPreview ?? "";
  return {
    status,
    data: {
      conversation_id: thread.key,
      subject: newest?.subject || "(no subject)",
      status,
      ...(filedIn ? { folder_id: filedIn } : {}),
      with: [...people].slice(0, PEOPLE_SHOWN),
      ...(lastIn ? { last_received: inAt } : {}),
      ...(lastOut ? { last_sent: outAt } : {}),
      days_waiting: daysSince(theyWroteLast ? inAt : outAt, now),
      ...(thread.received.some((message) => message.isRead === false)
        ? { unread: thread.received.filter((message) => message.isRead === false).length }
        : {}),
      ...(open
        ? {
            flagged: true,
            ...(open.dueDateTime?.dateTime ? { flag_due: open.dueDateTime.dateTime } : {}),
          }
        : flags.some((flag) => flag?.flagStatus === "complete")
          ? { flag_completed: true }
          : {}),
      ...(thread.received.some((message) => message.importance === "high")
        ? { importance: "high" }
        : {}),
      ...(attachments.size > 0
        ? { attachments: [...attachments].slice(0, ATTACHMENTS_SHOWN) }
        : hasAttachments
          ? { has_attachments: true }
          : {}),
      messages: thread.received.length + thread.sent.length,
      latest_message_id: newest?.id,
      latest_from: theyWroteLast ? address(lastIn?.from) : "you",
      preview: preview.length > PREVIEW_CHARS ? `${preview.slice(0, PREVIEW_CHARS)}…` : preview,
    },
  };
}

/** Received mail from every folder against Sent Items over a period, as conversations with a likely status each. */
export async function triageMailbox(graph: MailGraph, args: Record<string, unknown>) {
  const now = Date.now();
  const since =
    isoDate(args.since, "since") ??
    new Date(now - count(args.days, DAYS_DEFAULT, DAYS_MAX) * DAY_MS).toISOString();
  const waitingDays = count(args.waiting_days, WAITING_DAYS_DEFAULT, 60);
  const max = count(args.max_messages, FOLDER_MAX_DEFAULT, FOLDER_MAX);
  const wanted = new Set<Status>(
    Array.isArray(args.status)
      ? args.status.filter((value): value is Status => STATUSES.includes(value as Status))
      : [],
  );
  const mailbox = graph.mailbox?.toLowerCase();
  const [folders, sent] = await Promise.all([
    mailboxFolders(graph),
    collect(graph, "/me/mailFolders/sentitems/messages", "sentDateTime", since, max),
  ]);
  // Every folder's mail includes Sent Items and the skipped folders, so more is read to keep
  // about as much received mail.
  const receivedLimit = folders ? Math.min(max * 2, FOLDER_MAX * 2) : max;
  const collected = await collect(
    graph,
    folders ? "/me/messages" : "/me/mailFolders/inbox/messages",
    "receivedDateTime",
    since,
    receivedLimit,
  );
  const inbox = {
    ...collected,
    messages: folders
      ? collected.messages.filter(
          (message) => !message.parentFolderId || !folders.skipped.has(message.parentFolderId),
        )
      : collected.messages,
  };
  const threads = new Map<string, Thread>();
  const thread = (message: MailMessage) => {
    const key = message.conversationId ?? message.id;
    let found = threads.get(key);
    if (!found) {
      found = { key, received: [], sent: [] };
      threads.set(key, found);
    }
    return found;
  };
  for (const message of inbox.messages) {
    if (mailbox && email(message.from) === mailbox) continue;
    thread(message).received.push(message);
  }
  for (const message of sent.messages) thread(message).sent.push(message);

  const grouped = new Map<Status, ThreadSummary[]>(STATUSES.map((status) => [status, []]));
  for (const entry of threads.values()) {
    const described = describeThread(entry, mailbox, waitingDays, now, folders);
    grouped.get(described.status)!.push(described.data);
  }
  const byNewest = (a: { last_received?: string }, b: { last_received?: string }) =>
    (b.last_received ?? "").localeCompare(a.last_received ?? "");
  grouped
    .get("needs_reply")!
    .sort((a, b) => Number(Boolean(b.flagged)) - Number(Boolean(a.flagged)) || byNewest(a, b));
  grouped.get("awaiting_reply")!.sort((a, b) => (b.days_waiting ?? 0) - (a.days_waiting ?? 0));
  grouped.get("fyi")!.sort(byNewest);
  grouped.get("replied")!.sort((a, b) => (b.last_sent ?? "").localeCompare(a.last_sent ?? ""));

  const counts = Object.fromEntries(
    STATUSES.map((status) => [status, grouped.get(status)!.length]),
  );
  const conversations: Record<string, unknown[]> = {};
  const omitted: Record<string, number> = {};
  for (const status of STATUSES) {
    if (wanted.size > 0 && !wanted.has(status)) continue;
    const list = grouped.get(status)!;
    conversations[status] = list.slice(0, SHOWN[status]);
    if (list.length > SHOWN[status]) omitted[status] = list.length - SHOWN[status];
  }
  const shown = Object.values(conversations).flat() as ThreadSummary[];
  const filed = [
    ...new Set(shown.map((entry) => entry.folder_id).filter((id) => typeof id === "string")),
  ].slice(0, FOLDER_NAMES_LOOKED_UP) as string[];
  const folderNames = new Map(
    await mapLimited(filed, MAILBOX_CONCURRENCY, (id) =>
      graph
        .json<{ displayName?: string }>(
          `/me/mailFolders/${encodeURIComponent(id)}?$select=displayName`,
        )
        .then(
          (folder) => [id, folder.displayName] as const,
          () => [id, undefined] as const,
        ),
    ),
  );
  for (const entry of shown) {
    const name = folderNames.get(entry.folder_id as string);
    if (name) {
      entry.folder = name;
      delete entry.folder_id;
    }
  }
  const notes = [
    "Status is from email alone; work done by phone, Teams or in person is not visible.",
    folders
      ? "Received mail from every folder and sub-folder was read, except Junk, Deleted Items, Drafts and Outbox; folder names a conversation filed outside the Inbox."
      : "Only the Inbox was read, because the mailbox's folders could not be looked up; mail filed into other folders is missing.",
    ...(collected.truncated
      ? [
          `Only the newest ${receivedLimit} received emails were read; use a shorter period or a larger max_messages.`,
        ]
      : []),
    ...(sent.truncated
      ? [
          `Only the newest ${max} sent emails were compared; use a shorter period or a larger max_messages.`,
        ]
      : []),
    ...(Object.keys(omitted).length > 0
      ? ["Some conversations are not listed (see omitted); ask for one status or a shorter period."]
      : []),
    ...(!inbox.attachmentNames || !sent.attachmentNames
      ? ["Attachment names were unavailable; has_attachments marks conversations with files."]
      : []),
  ];
  return {
    since,
    waiting_days: waitingDays,
    compared: {
      received: inbox.messages.length,
      sent: sent.messages.length,
      ...(folders
        ? {
            folders: new Set(inbox.messages.map((message) => message.parentFolderId)).size,
          }
        : {}),
    },
    counts,
    conversations,
    ...(Object.keys(omitted).length > 0 ? { omitted } : {}),
    notes,
  };
}
