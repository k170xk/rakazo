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
  /** Outlook's draft message id and web link once created in the person's Drafts folder. */
  outlookMessageId: z.string().nullable().optional(),
  outlookWebLink: z.string().nullable().optional(),
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
): Promise<{ id: string; version: number }> {
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
      select: { id: true, version: true },
    }),
  );
}

/**
 * Updates an uncreated draft in the same chat when the person asks the assistant to revise it.
 * Returns null if the draft was already created in Outlook, discarded or belongs elsewhere.
 */
export async function reviseEmailDraft(
  prisma: PrismaClient,
  owner: EmailDraftOwner,
  input: {
    draftId: string;
    threadId: string;
    patch: {
      mode?: EmailDraftMode;
      replyToMessageId?: string | null;
      to?: string[];
      cc?: string[];
      bcc?: string[];
      subject?: string;
      bodyHtml?: string;
      attachments?: EmailDraftAttachment[];
    };
  },
): Promise<{ id: string; version: number } | null> {
  return runAsTenant(owner, async () => {
    const existing = await prisma.emailDraft.findFirst({
      where: {
        id: input.draftId,
        spaceId: owner.spaceId,
        userId: owner.userId,
        threadId: input.threadId,
        status: "draft",
      },
    });
    if (!existing) return null;
    const current = storedEmailDraft(existing.content);
    const modeChanged =
      (input.patch.mode && input.patch.mode !== existing.mode) ||
      (input.patch.replyToMessageId !== undefined &&
        input.patch.replyToMessageId !== existing.replyToMessageId);
    const nextContent: StoredEmailDraft = {
      ...current,
      ...(input.patch.to !== undefined ? { to: input.patch.to } : {}),
      ...(input.patch.cc !== undefined ? { cc: input.patch.cc } : {}),
      ...(input.patch.bcc !== undefined ? { bcc: input.patch.bcc } : {}),
      ...(input.patch.subject !== undefined ? { subject: input.patch.subject } : {}),
      ...(input.patch.bodyHtml !== undefined
        ? { bodyHtml: sanitizeEmailBody(input.patch.bodyHtml) }
        : {}),
      ...(input.patch.attachments !== undefined ? { attachments: input.patch.attachments } : {}),
      ...(modeChanged ? { replyTo: null } : {}),
    };
    const nextVersion = existing.version + 1;
    const { count } = await prisma.emailDraft.updateMany({
      where: {
        id: existing.id,
        userId: owner.userId,
        status: "draft",
        version: existing.version,
      },
      data: {
        ...(input.patch.mode ? { mode: input.patch.mode } : {}),
        ...(input.patch.replyToMessageId !== undefined
          ? { replyToMessageId: input.patch.replyToMessageId }
          : {}),
        content: nextContent as Prisma.InputJsonValue,
        version: nextVersion,
        error: null,
      },
    });
    return count === 1 ? { id: existing.id, version: nextVersion } : null;
  });
}
