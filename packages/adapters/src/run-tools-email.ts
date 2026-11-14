import type { EmailDraftAttachment } from "@rakazo/contracts";
import { EMAIL_DRAFT_LIMITS } from "@rakazo/contracts";
import { companyFeatureOpenForRun } from "./company-policy.js";
import { isOwnersPrivateChat } from "./connection-context.js";
import {
  attachmentProblem,
  createEmailDraft,
  emailAddresses,
  reviseEmailDraft,
  threadChatFiles,
} from "./email-drafts.js";
import { emailTextToHtml } from "./email-html.js";
import { OUTLOOK_PROVIDER } from "./microsoft-mail.js";
import { publishMessage } from "./run-messages.js";
import type { ToolHandlers } from "./run-tool-gate.js";
import { artifactIdFromAttachmentPath } from "./thread-artifacts.js";

export const OUTLOOK_DRAFT_TOOL = "outlook_draft_email";
const UNAVAILABLE = "Drafting Outlook email is not available here.";

export const emailTools: ToolHandlers = {
  /** Only makes or updates a card. Writing to Outlook is the person's own press of Create draft. */
  async outlook_draft_email(ctx, call) {
    const { deps, run, bot, thread } = ctx;
    const owner = { spaceId: run.spaceId, userId: run.userId };
    const outlookConnected = ctx.context.connectedConnections?.some(
      (connection) =>
        connection.connectorId === "microsoft" && connection.externalId === OUTLOOK_PROVIDER,
    );
    if (
      !ctx.tools.offered.some((tool) => tool.name === OUTLOOK_DRAFT_TOOL) ||
      !outlookConnected ||
      !isOwnersPrivateChat({ run, bot, thread, peerBotUserId: ctx.source?.peerBotUserId }) ||
      !(await companyFeatureOpenForRun(deps.prisma, "outlookSend", run.userId))
    ) {
      return call.finish({ error: UNAVAILABLE });
    }
    const { args } = call;
    const draftId = typeof args.draft_id === "string" ? args.draft_id.trim() : "";
    const hasReplyTo = typeof args.reply_to_message_id === "string";
    const replyTo = hasReplyTo ? String(args.reply_to_message_id).trim() : "";
    const mode = replyTo ? (args.reply_all === true ? "reply_all" : "reply") : "new";
    const to = emailAddresses(args.to);
    const cc = emailAddresses(args.cc);
    const bcc = emailAddresses(args.bcc);
    const invalid = [...to.invalid, ...cc.invalid, ...bcc.invalid];
    if (invalid.length > 0) {
      return call.finish({ error: `These are not email addresses: ${invalid.join(", ")}.` });
    }
    const hasSubject = typeof args.subject === "string" && args.subject.trim().length > 0;
    const subject = String(args.subject ?? "")
      .trim()
      .slice(0, EMAIL_DRAFT_LIMITS.subject);
    if (!draftId && mode === "new" && !subject) {
      return call.finish({ error: "Give the email a subject." });
    }
    const body = String(args.body ?? "").slice(0, 50_000);
    if (!body.trim()) return call.finish({ error: "Write the body of the email." });

    const hasAttachments = Array.isArray(args.attachments);
    const wanted = hasAttachments ? (args.attachments as unknown[]).map(String) : [];
    const files = wanted.length ? await threadChatFiles(deps.prisma, owner, thread.id) : [];
    const attachments: EmailDraftAttachment[] = [];
    for (const ref of wanted) {
      const id = artifactIdFromAttachmentPath(ref) ?? ref.trim();
      const file =
        files.find((entry) => entry.artifactId === id) ??
        files.find((entry) => entry.name.toLowerCase() === ref.trim().toLowerCase());
      if (!file) {
        return call.finish({
          error: `${ref} is not a file in this chat. Attach files shown in this conversation, by path or exact name.`,
        });
      }
      if (!attachments.some((entry) => entry.artifactId === file.artifactId))
        attachments.push(file);
    }
    const problem = attachmentProblem(attachments);
    if (problem) return call.finish({ error: problem });

    const bodyHtml = emailTextToHtml(body);
    const revised = draftId
      ? await reviseEmailDraft(deps.prisma, owner, {
          draftId,
          threadId: thread.id,
          patch: {
            ...(hasReplyTo ? { mode, replyToMessageId: replyTo || null } : {}),
            ...(args.to !== undefined ? { to: to.valid } : {}),
            ...(args.cc !== undefined ? { cc: cc.valid } : {}),
            ...(args.bcc !== undefined ? { bcc: bcc.valid } : {}),
            ...(hasSubject ? { subject } : {}),
            bodyHtml,
            ...(hasAttachments ? { attachments } : {}),
          },
        })
      : null;

    if (!revised && mode === "new" && !subject) {
      return call.finish({ error: "Give the email a subject." });
    }

    const draft =
      revised ??
      (await createEmailDraft(deps.prisma, owner, {
        threadId: thread.id,
        botId: bot.id,
        runId: run.id,
        mode,
        replyToMessageId: replyTo || null,
        content: {
          to: to.valid,
          cc: cc.valid,
          bcc: bcc.valid,
          subject,
          bodyHtml,
          attachments,
          replyTo: null,
        },
      }));
    await publishMessage(deps, run, "bot", [
      { kind: "email_draft", draftId: draft.id, version: draft.version },
    ]);
    return call.finish({
      ok: true,
      draft_id: draft.id,
      version: draft.version,
      note: "The draft card is in the chat. Nothing is in Outlook yet: only the person can save it to their Outlook Drafts folder by checking the card and pressing Create draft, then send it from Outlook. Never say it was sent or already saved to Outlook. Do not repeat the email in your reply.",
    });
  },
};
