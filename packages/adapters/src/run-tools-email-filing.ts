import { companyFeatureOpenForRun } from "./company-policy.js";
import { isOwnersPrivateChat } from "./connection-context.js";
import type {
  CandidateMessage,
  FolderNode,
  StoredFilingItem,
  StoredFilingTarget,
} from "./email-filing.js";
import {
  candidateFrom,
  companyEmailFilingPolicy,
  confidenceCap,
  conversationFolderMap,
  createFilingBatch,
  describeSender,
  evidenceFor,
  fileableFolders,
  filingIncludesSentItems,
  filingThreshold,
  folderForJob,
  jobKeyOf,
  listMailFolders,
  loadFilingProfile,
  pendingFilingMessageIds,
  projectFolderName,
  resolveEvolveJob,
  textJobReferences,
  wellKnownFolderIds,
} from "./email-filing.js";
import type { MicrosoftConnector } from "./microsoft-connector.js";
import type { MailGraph, MailMessage } from "./microsoft-mail.js";
import { mailId, OUTLOOK_PROVIDER, PRIVATE, UNTRUSTED } from "./microsoft-mail.js";
import { MAILBOX_CONCURRENCY, mapLimited } from "./microsoft-mail-triage.js";
import type { RunContext } from "./run-context.js";
import { publishMessage } from "./run-messages.js";
import type { ToolCall, ToolHandlers } from "./run-tool-gate.js";
import { personEmail } from "./run-tools-evolve-plugins.js";

export const FILING_CANDIDATES_TOOL = "outlook_filing_candidates";
export const PROPOSE_FILING_TOOL = "outlook_propose_filing";
export const FILING_TOOL_NAMES: ReadonlySet<string> = new Set([
  FILING_CANDIDATES_TOOL,
  PROPOSE_FILING_TOOL,
]);

const UNAVAILABLE = "Filing Outlook email is not available here.";
const MESSAGE_FIELDS =
  "id,subject,from,receivedDateTime,sentDateTime,hasAttachments,bodyPreview,conversationId,parentFolderId,webLink";
const EXPAND_ATTACHMENTS = encodeURIComponent("attachments($select=name,isInline)");
const DAYS_DEFAULT = 7;
const DAYS_MAX = 30;
const PREVIEW = 240;

type Ready = {
  graph: MailGraph;
  owner: { spaceId: string; userId: string };
  policy: ReturnType<typeof companyEmailFilingPolicy>;
  profile: Awaited<ReturnType<typeof loadFilingProfile>>;
};

/** Every check the selection made, made again: the tool, the person's chat, the switch, Outlook. */
async function readyToFile(ctx: RunContext, call: ToolCall): Promise<Ready | { error: string }> {
  const { deps, run, bot, thread } = ctx;
  const owner = { spaceId: run.spaceId, userId: run.userId };
  const outlookConnected = ctx.context.connectedConnections?.some(
    (connection) =>
      connection.connectorId === "microsoft" && connection.externalId === OUTLOOK_PROVIDER,
  );
  if (
    !ctx.tools.offered.some((tool) => tool.name === call.name) ||
    !outlookConnected ||
    !isOwnersPrivateChat({ run, bot, thread, peerBotUserId: ctx.source?.peerBotUserId }) ||
    !(await companyFeatureOpenForRun(deps.prisma, "outlookFiling", run.userId))
  ) {
    return { error: UNAVAILABLE };
  }
  const profile = await loadFilingProfile(deps.prisma, owner);
  if (!profile.settings.enabled) {
    return { error: "The person turned email filing off in Settings → Email." };
  }
  const microsoft = deps.connectors?.managed("microsoft") as
    | Pick<MicrosoftConnector, "outlookReader">
    | undefined;
  const graph =
    typeof microsoft?.outlookReader === "function"
      ? await microsoft.outlookReader(owner, ctx.context.signal)
      : null;
  if (!graph) return { error: "Outlook is not connected. Ask the person to reconnect it." };
  ctx.state.privateAppsRead = true;
  return { graph, owner, policy: companyEmailFilingPolicy(), profile };
}

function excludedSender(fromAddress: string | null, excluded: readonly string[]): boolean {
  if (!fromAddress) return false;
  const domain = `@${fromAddress.split("@")[1] ?? ""}`;
  return excluded.includes(fromAddress) || excluded.includes(domain);
}

async function listFolderMail(
  graph: MailGraph,
  folder: "inbox" | "sentitems",
  since: string,
  max: number,
): Promise<MailMessage[]> {
  const field = folder === "inbox" ? "receivedDateTime" : "sentDateTime";
  const path = (expand: boolean) =>
    `/me/mailFolders/${folder}/messages?$top=${max}&$filter=${encodeURIComponent(`${field} ge ${since}`)}&$orderby=${encodeURIComponent(`${field} desc`)}&$select=${MESSAGE_FIELDS}${expand ? `&$expand=${EXPAND_ATTACHMENTS}` : ""}`;
  const listed = await graph
    .json<{ value?: MailMessage[] }>(path(true))
    .catch(() => graph.json<{ value?: MailMessage[] }>(path(false)));
  return listed.value ?? [];
}

const pathOf = (folders: readonly FolderNode[], id: string) =>
  folders.find((folder) => folder.id === id)?.path ?? "";

export const emailFilingTools: ToolHandlers = {
  /** Reads only: mail still in Inbox (and Sent Items when allowed), the folders and the evidence. */
  async outlook_filing_candidates(ctx, call) {
    const ready = await readyToFile(ctx, call);
    if ("error" in ready) return call.finish(ready);
    const { graph, owner, policy, profile } = ready;
    const { settings } = profile;
    const days = Math.min(
      Math.max(Math.floor(Number(call.args.days) || DAYS_DEFAULT), 1),
      DAYS_MAX,
    );
    const max = Math.min(
      Math.max(Math.floor(Number(call.args.max_messages) || policy.maxPerBatch), 1),
      policy.maxPerBatch,
    );
    const includeSent =
      filingIncludesSentItems(policy, settings) &&
      (policy.sentItems === "on" || call.args.include_sent !== false);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    const [folders, known, inbox, sent, pending] = await Promise.all([
      listMailFolders(graph),
      wellKnownFolderIds(graph),
      listFolderMail(graph, "inbox", since, max),
      includeSent ? listFolderMail(graph, "sentitems", since, max) : Promise.resolve([]),
      pendingFilingMessageIds(ctx.deps.prisma, owner),
    ]);
    const targets = fileableFolders(folders, known, settings);
    const messages = [
      ...inbox.map((message) => ({ message, source: "inbox" as const })),
      ...sent.map((message) => ({ message, source: "sentitems" as const })),
    ]
      .filter(({ message }) => !pending.has(message.id))
      .filter(
        ({ message }) =>
          !excludedSender(
            message.from?.emailAddress?.address?.toLowerCase() ?? null,
            settings.excludedSenders,
          ),
      )
      .slice(0, max);
    const skip = new Set(
      [
        known.inbox,
        known.sentitems,
        known.drafts,
        known.deleteditems,
        known.junkemail,
        known.outbox,
      ].filter((id): id is string => Boolean(id)),
    );
    const conversations = await conversationFolderMap(
      graph,
      messages.flatMap(({ message }) => (message.conversationId ? [message.conversationId] : [])),
      skip,
    );
    const parentPath =
      settings.parentFolderPath ??
      `${pathOf(folders, known.inbox ?? "") || "Inbox"} › ${policy.defaultParentFolder}`;

    const candidates = messages.map(({ message, source }) => {
      const candidate = candidateFrom(message);
      const evidence = evidenceFor(candidate, targets, profile.rules, conversations);
      const foldered = new Set(
        targets.flatMap((folder) => (folder.job ? [folder.job.key, folder.job.parent] : [])),
      );
      const unmatched = textJobReferences(candidate.text).filter(
        (job) => !foldered.has(job.key) && !foldered.has(job.parent),
      );
      return {
        message_id: message.id,
        source,
        subject: message.subject || "(no subject)",
        from: describeSender(message),
        received: message.receivedDateTime ?? message.sentDateTime,
        preview: (message.bodyPreview ?? "").slice(0, PREVIEW),
        attachments: (message.attachments ?? [])
          .filter((file) => !file.isInline)
          .map((file) => file.name)
          .slice(0, 8),
        evidence: evidence.map((entry) => ({
          folder_id: entry.folderId,
          folder: pathOf(targets, entry.folderId),
          kind: entry.kind,
          detail: entry.detail,
        })),
        ...(unmatched.length
          ? { job_references_without_folder: unmatched.map((job) => job.key) }
          : {}),
      };
    });

    return call.finish({
      threshold: filingThreshold(policy, settings),
      new_project_folders: policy.allowFolderCreation
        ? `allowed, created under ${parentPath}`
        : "not allowed by the company",
      folders: targets.map((folder) => ({ folder_id: folder.id, path: folder.path })),
      candidates,
      note: `Decide a folder for each candidate, then call ${PROPOSE_FILING_TOOL} once with all of them (include the ones you are unsure about with no folder). Use folder_id values from this list only. For a job reference with no folder${policy.allowFolderCreation ? ", give evolve_job with the job number so a project folder can be created from Evolve" : ", leave it without a folder"}. Confidence is 0-100 and honest: high only when evidence supports it; the server lowers confidence that its evidence does not support. Nothing is moved: the person files from the card. ${PRIVATE} ${UNTRUSTED}`,
    });
  },

  /** Writes only the person's own card; their press of File is what moves mail. */
  async outlook_propose_filing(ctx, call) {
    const ready = await readyToFile(ctx, call);
    if ("error" in ready) return call.finish(ready);
    const { graph, owner, policy, profile } = ready;
    const { settings } = profile;
    const raw = Array.isArray(call.args.items) ? call.args.items : [];
    if (raw.length === 0) return call.finish({ error: "Give at least one email in items." });

    type Wanted = {
      messageId: string;
      folderId?: string;
      evolveJob?: string;
      confidence: number;
      reason: string;
    };
    const wanted: Wanted[] = [];
    const seen = new Set<string>();
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      let messageId: string | undefined;
      let folderId: string | undefined;
      try {
        messageId = mailId(item.message_id, "message_id");
        folderId = mailId(item.folder_id, "folder_id");
      } catch {
        continue;
      }
      if (!messageId || seen.has(messageId)) continue;
      seen.add(messageId);
      const evolveJob =
        typeof item.evolve_job === "string" && item.evolve_job.trim()
          ? item.evolve_job.trim().slice(0, 40)
          : undefined;
      const confidence = Math.round(Math.min(Math.max(Number(item.confidence) || 0, 0), 100));
      const reason = String(item.reason ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300);
      wanted.push({ messageId, folderId, evolveJob, confidence, reason });
    }
    const limited = wanted.slice(0, policy.maxPerBatch);
    if (limited.length === 0) return call.finish({ error: "None of the items had a message_id." });

    const [folders, known, pending] = await Promise.all([
      listMailFolders(graph),
      wellKnownFolderIds(graph),
      pendingFilingMessageIds(ctx.deps.prisma, owner),
    ]);
    const targets = fileableFolders(folders, known, settings);
    const sources = new Map<string, "inbox" | "sentitems">();
    if (known.inbox) sources.set(known.inbox, "inbox");
    if (known.sentitems && filingIncludesSentItems(policy, settings)) {
      sources.set(known.sentitems, "sentitems");
    }
    const parentId = settings.parentFolderId ?? null;
    const parentPath =
      settings.parentFolderPath ??
      `${pathOf(folders, known.inbox ?? "") || "Inbox"} › ${policy.defaultParentFolder}`;

    const fetched = await mapLimited(limited, MAILBOX_CONCURRENCY, (want) =>
      graph
        .json<MailMessage>(
          `/me/messages/${encodeURIComponent(want.messageId)}?$select=${MESSAGE_FIELDS}&$expand=${EXPAND_ATTACHMENTS}`,
        )
        .catch(() => null),
    );
    const dropped: Array<{ message_id: string; why: string }> = [];
    const found: Array<{ want: Wanted; message: MailMessage; source: "inbox" | "sentitems" }> = [];
    limited.forEach((want, index) => {
      const message = fetched[index];
      const source = message?.parentFolderId ? sources.get(message.parentFolderId) : undefined;
      if (!message) dropped.push({ message_id: want.messageId, why: "not found in the mailbox" });
      else if (!source)
        dropped.push({ message_id: want.messageId, why: "no longer in a folder filing reads" });
      else if (pending.has(message.id))
        dropped.push({ message_id: want.messageId, why: "already waiting on another card" });
      else found.push({ want, message, source });
    });
    if (found.length === 0)
      return call.finish({ error: "None of these emails can be filed.", dropped });

    const skip = new Set(
      [
        known.inbox,
        known.sentitems,
        known.drafts,
        known.deleteditems,
        known.junkemail,
        known.outbox,
      ].filter((id): id is string => Boolean(id)),
    );
    const conversations = await conversationFolderMap(
      graph,
      found.flatMap(({ message }) => (message.conversationId ? [message.conversationId] : [])),
      skip,
    );

    const email = ctx.deps.evolvePlugins ? await personEmail(ctx) : null;
    const projects = new Map<string, Awaited<ReturnType<typeof resolveEvolveJob>>>();
    const resolveProject = async (job: string) => {
      const key = jobKeyOf(job)?.key ?? job;
      if (!projects.has(key)) {
        projects.set(
          key,
          ctx.deps.evolvePlugins && email
            ? await resolveEvolveJob(ctx.deps.evolvePlugins, email, job, {
                signal: ctx.context.signal,
              }).catch(() => null)
            : null,
        );
      }
      return projects.get(key) ?? null;
    };

    const items: StoredFilingItem[] = [];
    let index = 0;
    for (const { want, message, source } of found) {
      const candidate: CandidateMessage = candidateFrom(message);
      const evidence = evidenceFor(candidate, targets, profile.rules, conversations);
      const notes: string[] = [];
      let target: StoredFilingTarget | null = null;
      let folderForCap: string | null = null;
      let projectCap: number | null = null;
      if (want.folderId) {
        const folder = targets.find((entry) => entry.id === want.folderId);
        if (folder) {
          target = { kind: "folder", folderId: folder.id, path: folder.path };
          folderForCap = folder.id;
        } else {
          notes.push("The suggested folder cannot be filed into.");
        }
      } else if (want.evolveJob) {
        const job = jobKeyOf(want.evolveJob);
        const existing = job ? folderForJob(targets, job, parentId) : null;
        if (existing) {
          target = { kind: "folder", folderId: existing.id, path: existing.path };
          folderForCap = existing.id;
        } else if (job) {
          const project = await resolveProject(want.evolveJob);
          if (!project) {
            notes.push(`Evolve has no project ${job.key} that you can see.`);
          } else if (!policy.allowFolderCreation) {
            notes.push(
              `No folder exists for ${project.jobNumber}, and new folders are turned off.`,
            );
          } else {
            target = {
              kind: "project",
              jobNumber: project.jobNumber,
              jobKey: project.job.key,
              title: project.title,
              folderName: projectFolderName(project.jobNumber, project.title),
              parentPath,
            };
            const mentioned = textJobReferences(candidate.text).some(
              (reference) => reference.key === project.job.key,
            );
            projectCap = mentioned && project.match === "exact" ? 95 : 80;
            if (project.match === "parent")
              notes.push(`Matched Evolve's parent job ${project.jobNumber}.`);
          }
        }
      }
      const cap = target
        ? target.kind === "project"
          ? (projectCap ?? 80)
          : confidenceCap(evidence, folderForCap)
        : 0;
      const confidence = Math.min(want.confidence, cap);
      const shown = evidence
        .filter((entry) => !folderForCap || entry.folderId === folderForCap)
        .map((entry) => entry.detail)
        .slice(0, 4);
      items.push({
        id: `i${++index}`,
        messageId: message.id,
        conversationId: message.conversationId ?? null,
        sourceFolderId: message.parentFolderId ?? "",
        source,
        subject: message.subject || "(no subject)",
        from: describeSender(message),
        fromAddress: message.from?.emailAddress?.address?.toLowerCase() ?? null,
        receivedAt: message.receivedDateTime ?? message.sentDateTime ?? null,
        hasAttachments: Boolean(message.hasAttachments),
        preview: (message.bodyPreview ?? "").replace(/\s+/g, " ").trim().slice(0, PREVIEW),
        webLink: message.webLink ?? null,
        target,
        confidence,
        reason: want.reason,
        evidence: [...shown, ...notes],
        chosen: false,
        remember: "none",
        status: "proposed",
        error: null,
        filedFolderId: null,
        filedPath: null,
        movedMessageId: null,
        filedAt: null,
      });
    }

    const threshold = filingThreshold(policy, settings);
    const batch = await createFilingBatch(ctx.deps.prisma, owner, {
      threadId: ctx.thread.id,
      botId: ctx.bot.id,
      runId: ctx.run.id,
      content: { items, threshold, allowFolderCreation: policy.allowFolderCreation },
    });
    await publishMessage(ctx.deps, ctx.run, "bot", [{ kind: "email_filing", batchId: batch.id }]);
    const readyCount = items.filter((item) => item.target && item.confidence >= threshold).length;
    return call.finish({
      ok: true,
      batch_id: batch.id,
      ready: readyCount,
      needs_decision: items.length - readyCount,
      ...(dropped.length ? { dropped } : {}),
      note: "The filing card is in the chat. Nothing has moved: the person checks the folders and presses File. Say in one line how many are ready and how many need their decision; do not list the emails again.",
    });
  },
};
