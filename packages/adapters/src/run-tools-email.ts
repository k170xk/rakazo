import type { EmailDraftAttachment } from "@rakazo/contracts";
import { EMAIL_DRAFT_LIMITS } from "@rakazo/contracts";
import { companyFeatureOpenForRun } from "./company-policy.js";
import { isOwnersPrivateChat } from "./connection-context.js";
import {
  attachmentProblem,
  createEmailDraft,
  emailAddresses,
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
  /** Only makes a card. Sending is the person's own press of Send, which no run can reach. */
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
    const replyTo =
      typeof args.reply_to_message_id === "string" ? args.reply_to_message_id.trim() : "";
    const mode = replyTo ? (args.reply_all === true ? "reply_all" : "reply") : "new";
    const to = emailAddresses(args.to);
    const cc = emailAddresses(args.cc);
    const bcc = emailAddresses(args.bcc);
    const invalid = [...to.invalid, ...cc.invalid, ...bcc.invalid];
    if (invalid.length > 0) {
      return call.finish({ error: `These are not email addresses: ${invalid.join(", ")}.` });
    }
    if (mode === "new" && to.valid.length === 0) {
      return call.finish({ error: "Give at least one recipient in to." });
    }
    const subject = String(args.subject ?? "")
      .trim()
      .slice(0, EMAIL_DRAFT_LIMITS.subject);
    if (mode === "new" && !subject) return call.finish({ error: "Give the email a subject." });
    const body = String(args.body ?? "").slice(0, 50_000);
    if (!body.trim()) return call.finish({ error: "Write the body of the email." });

    const wanted = Array.isArray(args.attachments) ? args.attachments.map(String) : [];
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

    const draft = await createEmailDraft(deps.prisma, owner, {
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
        bodyHtml: emailTextToHtml(body),
        attachments,
        replyTo: null,
      },
    });
    await publishMessage(deps, run, "bot", [{ kind: "email_draft", draftId: draft.id }]);
    return call.finish({
      ok: true,
      draft_id: draft.id,
      note: "The draft card is in the chat. It is not sent: only the person can send it, by checking it and pressing Send. Never say it was sent. Do not repeat the email in your reply.",
    });
  },
};
