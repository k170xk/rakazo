import type { EmailDraftAttachment, EmailDraftMode } from "@rakazo/contracts";
import {
  EMAIL_DRAFT_LIMITS,
  EmailAddressSchema,
  EmailDraftAttachmentSchema,
} from "@rakazo/contracts";
import type { Prisma, PrismaClient } from "@rakazo/db";
import { runAsTenant } from "@rakazo/db";
import * as z from "zod";
import { sanitizeEmailBody } from "./email-html.js";

export type EmailDraftOwner = { spaceId: string; userId: string };

/** What a draft row keeps encrypted in `content`. */
export const StoredEmailDraftSchema = z.object({
  to: z.array(z.string()),
  cc: z.array(z.string()),
  bcc: z.array(z.string()),
  subject: z.string(),
  bodyHtml: z.string(),
  attachments: z.array(EmailDraftAttachmentSchema),
  /** Filled from Outlook the first time the card loads, for a reply. */
  replyTo: z
    .object({ subject: z.string(), from: z.string(), receivedAt: z.string().nullable() })
    .nullable()
    .optional(),
});
export type StoredEmailDraft = z.infer<typeof StoredEmailDraftSchema>;

export function storedEmailDraft(content: unknown): StoredEmailDraft {
  const parsed = StoredEmailDraftSchema.safeParse(content);
  return parsed.success
    ? parsed.data
    : { to: [], cc: [], bcc: [], subject: "", bodyHtml: "", attachments: [], replyTo: null };
}

/** Splits addresses into valid ones (lowercased, once each) and the rest, to report back. */
export function emailAddresses(value: unknown): { valid: string[]; invalid: string[] } {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;]/) : [];
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const item of items) {
    const raw = String(item ?? "")
      .replace(/^.*<([^>]+)>\s*$/, "$1")
      .trim();
    if (!raw) continue;
    const parsed = EmailAddressSchema.safeParse(raw);
    if (!parsed.success) invalid.push(raw);
    else if (!valid.includes(parsed.data)) valid.push(parsed.data);
  }
  return { valid, invalid };
}

/**
 * Files shown in this chat, by the person or their assistants, newest first. They are the
 * person's own artifacts, so nothing from another person's chat can be attached.
 */
export async function threadChatFiles(
  prisma: PrismaClient,
  owner: EmailDraftOwner,
  threadId: string,
): Promise<EmailDraftAttachment[]> {
  return runAsTenant(owner, async () => {
    const shown = await prisma.$queryRaw<Array<{ artifactId: string }>>`
      SELECT b->>'artifactId' AS "artifactId"
      FROM messages m
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(m.blocks) = 'array' THEN m.blocks ELSE '[]'::jsonb END
      ) AS b
      WHERE m."threadId" = ${threadId}
        AND b->>'kind' IN ('file', 'image')
        AND b->>'artifactId' IS NOT NULL
      GROUP BY 1
      ORDER BY max(m.seq) DESC
      LIMIT 200`;
    if (shown.length === 0) return [];
    const rows = await prisma.artifact.findMany({
      where: {
        id: { in: shown.map((row) => row.artifactId) },
        spaceId: owner.spaceId,
        userId: owner.userId,
      },
      select: { id: true, name: true, mimeType: true, size: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return shown.flatMap(({ artifactId }) => {
      const row = byId.get(artifactId);
      return row
        ? [{ artifactId: row.id, name: row.name, mimeType: row.mimeType, size: row.size }]
        : [];
    });
  });
}

/** The chosen files must fit in one Outlook email. */
export function attachmentProblem(files: readonly EmailDraftAttachment[]): string | null {
  if (files.length > EMAIL_DRAFT_LIMITS.attachments) {
    return `An email can carry at most ${EMAIL_DRAFT_LIMITS.attachments} attachments.`;
  }
  const large = files.find((file) => file.size > EMAIL_DRAFT_LIMITS.attachmentBytes);
  if (large) return `${large.name} is larger than 3 MB, so it cannot be attached here.`;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > EMAIL_DRAFT_LIMITS.totalAttachmentBytes) {
    return "Together the attachments are larger than 20 MB.";
  }
  return null;
}

export async function createEmailDraft(
  prisma: PrismaClient,
  owner: EmailDraftOwner,
  input: {
    threadId: string;
    botId: string;
    runId: string;
    mode: EmailDraftMode;
    replyToMessageId: string | null;
    content: StoredEmailDraft;
  },
): Promise<{ id: string }> {
  const content: StoredEmailDraft = {
    ...input.content,
    bodyHtml: sanitizeEmailBody(input.content.bodyHtml),
  };
  return runAsTenant(owner, () =>
    prisma.emailDraft.create({
      data: {
        spaceId: owner.spaceId,
        userId: owner.userId,
        threadId: input.threadId,
        botId: input.botId,
        runId: input.runId,
        mode: input.mode,
        replyToMessageId: input.replyToMessageId,
        content: content as Prisma.InputJsonValue,
      },
      select: { id: true },
    }),
  );
}
