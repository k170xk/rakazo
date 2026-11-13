import { ORPCError } from "@orpc/server";
import { createAdapterContext } from "@rakazo/adapter-kit";
import type { StoredEmailDraft } from "@rakazo/adapters";
import {
  attachmentProblem,
  OutlookNotSentError,
  sanitizeEmailBody,
  sanitizeEmailSignature,
  sendOutlookEmail,
  storedEmailDraft,
  threadChatFiles,
} from "@rakazo/adapters";
import type {
  Actor,
  EmailDraft,
  EmailDraftAttachment,
  EmailDraftMode,
  EmailDraftStatus,
} from "@rakazo/contracts";
import { EMAIL_DRAFT_LIMITS } from "@rakazo/contracts";
import type { Prisma } from "@rakazo/db";
import { IsolationError, runAsSystem, runAsTenant } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { companyFeatureOnFor, requireCompanyFeature } from "../company-admin.js";
import type { RouterContext } from "./context.js";

type DraftRow = {
  id: string;
  spaceId: string;
  userId: string;
  threadId: string;
  botId: string | null;
  mode: string;
  replyToMessageId: string | null;
  content: Prisma.JsonValue;
  status: string;
  version: number;
  error: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const MAYBE_SENT =
  "Outlook stopped answering while sending, so this email may have gone. Check Sent Items in Outlook before sending it again.";

const STUCK_SENDING_MS = 5 * 60_000;

const own = (actor: Actor) => ({ spaceId: actor.spaceId, userId: actor.userId });

function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `RE: ${subject.trim()}`;
}

/** Each person's Outlook drafts: only they read, edit and send them, from their own card. */
export function emailDraftsRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;

  const load = async (actor: Actor, id: string): Promise<DraftRow> => {
    const row = await runAsTenant(own(actor), () =>
      deps.prisma.emailDraft.findFirst({
        where: { id, spaceId: actor.spaceId, userId: actor.userId },
      }),
    );
    if (!row) throw new IsolationError();
    return row;
  };

  const save = (
    actor: Actor,
    row: DraftRow,
    data: {
      content?: StoredEmailDraft;
      status?: EmailDraftStatus;
      error?: string | null;
      sentAt?: Date;
      bump?: boolean;
    },
    expect: { status: EmailDraftStatus; version?: number },
  ) =>
    runAsTenant(own(actor), async () => {
      const { count } = await deps.prisma.emailDraft.updateMany({
        where: {
          id: row.id,
          userId: actor.userId,
          status: expect.status,
          ...(expect.version ? { version: expect.version } : {}),
        },
        data: {
          ...(data.content ? { content: data.content as Prisma.InputJsonValue } : {}),
          ...(data.status ? { status: data.status } : {}),
          ...(data.error !== undefined ? { error: data.error } : {}),
          ...(data.sentAt ? { sentAt: data.sentAt } : {}),
          ...(data.bump ? { version: { increment: 1 } } : {}),
        },
      });
      return count === 1;
    });

  const signatureOf = async (actor: Actor): Promise<string | null> => {
    const user = await runAsSystem("read a person's email signature", () =>
      deps.prisma.user.findUnique({
        where: { id: actor.userId },
        select: { emailSignature: true },
      }),
    );
    return user?.emailSignature?.trim() ? user.emailSignature : null;
  };

  const present = async (actor: Actor, row: DraftRow): Promise<EmailDraft> => {
    const content = storedEmailDraft(row.content);
    // A send cut off by a restart never finishes, so after a while it shows as possibly sent.
    const stuck =
      row.status === "sending" && Date.now() - row.updatedAt.getTime() > STUCK_SENDING_MS;
    const status = stuck ? "failed" : (row.status as EmailDraftStatus);
    const from = deps.microsoft
      ? await deps.microsoft.outlookAccount(own(actor)).catch(() => null)
      : null;
    let cannotSend: string | null = null;
    if (status === "draft") {
      if (!(await companyFeatureOnFor(deps, actor, "outlookSend"))) {
        cannotSend = "Sending Outlook email is not turned on for you.";
      } else if (!deps.microsoft || from === null) {
        cannotSend = "Connect Outlook in Plugins to send this email.";
      } else if (content.to.length + content.cc.length + content.bcc.length === 0) {
        cannotSend = "Add at least one recipient.";
      }
    }
    return {
      id: row.id,
      threadId: row.threadId,
      mode: row.mode as EmailDraftMode,
      status,
      version: row.version,
      from: from || null,
      replyTo: content.replyTo ?? null,
      to: content.to,
      cc: content.cc,
      bcc: content.bcc,
      subject: content.subject,
      bodyHtml: content.bodyHtml,
      signatureHtml: await signatureOf(actor),
      attachments: content.attachments,
      cannotSend,
      error: stuck ? MAYBE_SENT : row.error,
      sentAt: row.sentAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  };

  /** A reply's card first shows who it answers and, unless the assistant chose, who receives it. */
  const fillReply = async (actor: Actor, row: DraftRow): Promise<DraftRow> => {
    const content = storedEmailDraft(row.content);
    if (row.status !== "draft" || row.mode === "new" || content.replyTo || !row.replyToMessageId) {
      return row;
    }
    if (!deps.microsoft) return row;
    const original = await deps.microsoft
      .outlookMessageSummary(own(actor), row.replyToMessageId)
      .catch((error: unknown) => {
        getLogger().warn("email draft reply lookup failed", { error: String(error) });
        return null;
      });
    if (!original) return row;
    const me = (
      (await deps.microsoft.outlookAccount(own(actor)).catch(() => null)) ?? ""
    ).toLowerCase();
    const others = (list: Array<string | null>) =>
      list.filter((address): address is string => Boolean(address) && address !== me);
    const next: StoredEmailDraft = {
      ...content,
      replyTo: { subject: original.subject, from: original.from, receivedAt: original.receivedAt },
    };
    if (content.to.length + content.cc.length === 0) {
      next.to = others([original.fromAddress]);
      if (row.mode === "reply_all") {
        next.to = [...new Set([...next.to, ...others(original.to)])];
        next.cc = others(original.cc).filter((address) => !next.to.includes(address));
      }
    }
    if (!content.subject.trim()) next.subject = replySubject(original.subject);
    if (!(await save(actor, row, { content: next }, { status: "draft", version: row.version }))) {
      return load(actor, row.id);
    }
    return { ...row, content: next as Prisma.JsonValue };
  };

  const chosenFiles = async (
    actor: Actor,
    row: DraftRow,
    ids: string[],
  ): Promise<EmailDraftAttachment[]> => {
    if (ids.length === 0) return [];
    const files = await threadChatFiles(deps.prisma, own(actor), row.threadId);
    const chosen = [...new Set(ids)].map((id) => {
      const file = files.find((entry) => entry.artifactId === id);
      if (!file)
        throw new ORPCError("BAD_REQUEST", { message: "Attach only files from this chat." });
      return file;
    });
    const problem = attachmentProblem(chosen);
    if (problem) throw new ORPCError("BAD_REQUEST", { message: problem });
    return chosen;
  };

  const readBytes = async (actor: Actor, row: DraftRow, files: EmailDraftAttachment[]) => {
    const artifacts = await runAsTenant(own(actor), () =>
      deps.prisma.artifact.findMany({
        where: {
          id: { in: files.map((file) => file.artifactId) },
          spaceId: actor.spaceId,
          userId: actor.userId,
        },
        select: { id: true, botId: true, storageKey: true, name: true, mimeType: true },
      }),
    );
    return Promise.all(
      files.map(async (file) => {
        const artifact = artifacts.find((entry) => entry.id === file.artifactId);
        if (!artifact)
          throw new OutlookNotSentError(
            `${file.name} is no longer available. Remove it and try again.`,
          );
        const bytes = await deps.artifacts.get(
          artifact.storageKey,
          createAdapterContext(
            actor,
            artifact.botId ?? row.botId ?? artifact.id,
            `email-attachment:${artifact.id}`,
          ),
        );
        return { name: artifact.name, mimeType: artifact.mimeType, bytes: new Uint8Array(bytes) };
      }),
    );
  };

  return {
    emailDrafts: {
      get: authed.emailDrafts.get.handler(async ({ context, input }) => {
        const row = await fillReply(context.actor, await load(context.actor, input.id));
        return present(context.actor, row);
      }),

      update: authed.emailDrafts.update.handler(async ({ context, input }) => {
        await requireCompanyFeature(deps, context.actor, "outlookSend");
        const row = await load(context.actor, input.id);
        if (row.status !== "draft") {
          throw new ORPCError("CONFLICT", { message: "This email is no longer a draft." });
        }
        const current = storedEmailDraft(row.content);
        const next: StoredEmailDraft = {
          ...current,
          to: input.to,
          cc: input.cc,
          bcc: input.bcc,
          subject: input.subject.trim(),
          bodyHtml: sanitizeEmailBody(input.bodyHtml),
          attachments: await chosenFiles(context.actor, row, input.attachmentIds),
        };
        const saved = await save(
          context.actor,
          row,
          { content: next, bump: true, error: null },
          { status: "draft", version: input.version },
        );
        if (!saved) {
          throw new ORPCError("CONFLICT", {
            message: "This draft changed elsewhere. Reload it and try again.",
          });
        }
        return present(context.actor, await load(context.actor, row.id));
      }),

      /**
       * The only way an email leaves: its person presses Send on their own card. No assistant
       * or run can call this, and access is checked again here every time.
       */
      send: authed.emailDrafts.send.handler(async ({ context, input }) => {
        const { actor } = context;
        await requireCompanyFeature(deps, actor, "outlookSend");
        const microsoft = deps.microsoft;
        if (!microsoft)
          throw new ORPCError("BAD_REQUEST", { message: "Outlook is not set up here." });
        const row = await load(actor, input.id);
        const content = storedEmailDraft(row.content);
        if (content.to.length + content.cc.length + content.bcc.length === 0) {
          throw new ORPCError("BAD_REQUEST", { message: "Add at least one recipient." });
        }
        if (
          !(await save(
            actor,
            row,
            { status: "sending", error: null },
            { status: "draft", version: input.version },
          ))
        ) {
          throw new ORPCError("CONFLICT", {
            message:
              "This draft has already been sent, discarded or changed. Reload it to see the latest.",
          });
        }
        const backToDraft = async (message: string) => {
          await save(actor, row, { status: "draft", error: message }, { status: "sending" });
          return present(actor, await load(actor, row.id));
        };
        const grant = await microsoft.outlookSendToken(own(actor)).catch(() => null);
        if (!grant)
          return backToDraft("Outlook could not be reached. Nothing was sent; try again.");
        if ("reconnect" in grant) return backToDraft(grant.reconnect);
        try {
          await sendOutlookEmail(
            {
              mode: row.mode as EmailDraftMode,
              replyToMessageId: row.replyToMessageId,
              to: content.to,
              cc: content.cc,
              bcc: content.bcc,
              subject: content.subject,
              bodyHtml: content.bodyHtml,
              signatureHtml: await signatureOf(actor),
              attachments: await readBytes(actor, row, content.attachments),
            },
            grant.token,
          );
        } catch (error) {
          if (error instanceof OutlookNotSentError)
            return backToDraft(`${error.message} Nothing was sent.`);
          getLogger().error("outlook send outcome unknown", {
            error: String(error),
            draftId: row.id,
          });
          await save(actor, row, { status: "failed", error: MAYBE_SENT }, { status: "sending" });
          return present(actor, await load(actor, row.id));
        }
        await save(
          actor,
          row,
          { status: "sent", sentAt: new Date(), error: null },
          { status: "sending" },
        );
        return present(actor, await load(actor, row.id));
      }),

      discard: authed.emailDrafts.discard.handler(async ({ context, input }) => {
        const row = await load(context.actor, input.id);
        if (row.status === "draft") {
          await save(context.actor, row, { status: "discarded" }, { status: "draft" });
        }
        return present(context.actor, await load(context.actor, row.id));
      }),

      files: authed.emailDrafts.files.handler(async ({ context, input }) => {
        await requireCompanyFeature(deps, context.actor, "outlookSend");
        const row = await load(context.actor, input.id);
        return threadChatFiles(deps.prisma, own(context.actor), row.threadId);
      }),

      signature: {
        get: authed.emailDrafts.signature.get.handler(async ({ context }) => {
          await requireCompanyFeature(deps, context.actor, "outlookSend");
          return { html: await signatureOf(context.actor) };
        }),
        set: authed.emailDrafts.signature.set.handler(async ({ context, input }) => {
          await requireCompanyFeature(deps, context.actor, "outlookSend");
          const html = input.html?.trim() ? sanitizeEmailSignature(input.html).trim() : "";
          if (html.length > EMAIL_DRAFT_LIMITS.signatureHtml) {
            throw new ORPCError("BAD_REQUEST", {
              message: "This signature is too large. Use smaller or linked images.",
            });
          }
          await runAsSystem("save a person's email signature", () =>
            deps.prisma.user.update({
              where: { id: context.actor.userId },
              data: { emailSignature: html || null },
            }),
          );
          return { html: html || null };
        }),
      },
    },
  };
}
