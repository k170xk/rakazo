import * as z from "zod";
import { Id } from "./ids.js";

/** Limits on an Outlook draft. Graph takes attachments up to 3 MB in a single request. */
export const EMAIL_DRAFT_LIMITS = {
  recipients: 50,
  subject: 255,
  bodyHtml: 200_000,
  signatureHtml: 100_000,
  attachments: 10,
  attachmentBytes: 3 * 1024 * 1024,
  totalAttachmentBytes: 20 * 1024 * 1024,
} as const;

export const EmailAddressSchema = z.email().trim().toLowerCase().max(254);

export const EmailDraftModeSchema = z.enum(["new", "reply", "reply_all"]);
export type EmailDraftMode = z.infer<typeof EmailDraftModeSchema>;

export const EmailDraftStatusSchema = z.enum(["draft", "sending", "sent", "discarded", "failed"]);
export type EmailDraftStatus = z.infer<typeof EmailDraftStatusSchema>;

export const EmailDraftAttachmentSchema = z.object({
  artifactId: Id,
  name: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
});
export type EmailDraftAttachment = z.infer<typeof EmailDraftAttachmentSchema>;

const Recipients = z.array(EmailAddressSchema).max(EMAIL_DRAFT_LIMITS.recipients);

/** What the person may change on a draft before sending it. */
export const EmailDraftEditSchema = z.object({
  id: Id,
  /** The version the person was editing; an edit to an older one is refused. */
  version: z.number().int().positive(),
  to: Recipients,
  cc: Recipients,
  bcc: Recipients,
  subject: z.string().max(EMAIL_DRAFT_LIMITS.subject),
  bodyHtml: z.string().max(EMAIL_DRAFT_LIMITS.bodyHtml),
  attachmentIds: z.array(Id).max(EMAIL_DRAFT_LIMITS.attachments),
});
export type EmailDraftEdit = z.infer<typeof EmailDraftEditSchema>;

export const EmailDraftSchema = z.object({
  id: Id,
  threadId: Id,
  mode: EmailDraftModeSchema,
  status: EmailDraftStatusSchema,
  version: z.number().int().positive(),
  /** The Outlook address it is sent from; null while Outlook is not connected. */
  from: z.string().nullable(),
  /** The message a reply answers, as Outlook has it. */
  replyTo: z
    .object({ subject: z.string(), from: z.string(), receivedAt: z.string().nullable() })
    .nullable(),
  to: z.array(z.string()),
  cc: z.array(z.string()),
  bcc: z.array(z.string()),
  subject: z.string(),
  bodyHtml: z.string(),
  /** The person's saved signature, added under the body when it is sent. */
  signatureHtml: z.string().nullable(),
  attachments: z.array(EmailDraftAttachmentSchema),
  /** Why Send is unavailable right now, such as Outlook needing to be reconnected. */
  cannotSend: z.string().nullable(),
  error: z.string().nullable(),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EmailDraft = z.infer<typeof EmailDraftSchema>;

export const EmailSignatureSchema = z.object({
  html: z.string().max(EMAIL_DRAFT_LIMITS.signatureHtml).nullable(),
});
export type EmailSignature = z.infer<typeof EmailSignatureSchema>;
