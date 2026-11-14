import * as z from "zod";
import { Id } from "./ids.js";

export const EMAIL_FILING_LIMITS = {
  /** The most emails one proposal card holds. */
  batchItems: 100,
  reason: 300,
  folderName: 120,
  preview: 240,
  rules: 300,
  excludedSenders: 200,
  excludedFolders: 50,
  outlookId: 512,
} as const;

/** How long a filing card stays usable; afterwards it is removed. */
export const EMAIL_FILING_BATCH_DAYS = 14;

const OutlookId = z
  .string()
  .trim()
  .min(1)
  .max(EMAIL_FILING_LIMITS.outlookId)
  .regex(/^[^\s'"\\]+$/, "That is not an Outlook id.");

/** Company-wide filing rules an admin sets beside the Outlook email filing switch. */
export const EmailFilingPolicySchema = z.object({
  /** The lowest confidence anyone may file at; people may raise their own bar but not lower it. */
  minConfidence: z.number().int().min(50).max(99),
  /** A missing Evolve project folder may be created, always under the person's parent folder. */
  allowFolderCreation: z.boolean(),
  /** Created once under Inbox when a person has not chosen their own parent folder. */
  defaultParentFolder: z
    .string()
    .trim()
    .min(1)
    .max(EMAIL_FILING_LIMITS.folderName)
    .regex(/^[^\\/]+$/, "Use a single folder name."),
  /** off: Inbox only. optional: each person may add Sent Items. on: always Inbox and Sent Items. */
  sentItems: z.enum(["off", "optional", "on"]),
  maxPerBatch: z.number().int().min(5).max(EMAIL_FILING_LIMITS.batchItems),
  /** Filing always waits for the person's press of File; an auto-file mode would be a later value. */
  autonomy: z.literal("off"),
});
export type EmailFilingPolicy = z.infer<typeof EmailFilingPolicySchema>;

export const DEFAULT_EMAIL_FILING_POLICY: EmailFilingPolicy = {
  minConfidence: 90,
  allowFolderCreation: true,
  defaultParentFolder: "Projects",
  sentItems: "optional",
  maxPerBatch: 50,
  autonomy: "off",
};

export function emailFilingPolicyFrom(stored: unknown): EmailFilingPolicy {
  const parsed = EmailFilingPolicySchema.partial().safeParse(stored);
  return { ...DEFAULT_EMAIL_FILING_POLICY, ...(parsed.success ? parsed.data : {}) };
}

/** A sender address, or a whole domain written as @example.com. */
export const EmailFilingSenderSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^([^\s@]+@[^\s@]+\.[^\s@]+|@[^\s@]+\.[^\s@]+)$/, "Use an address or @domain.");

/** Each person's own filing choices, kept in their settings. */
export const EmailFilingSettingsSchema = z.object({
  /** Assistants may look through their mail and propose filing, in chat and in routines. */
  enabled: z.boolean(),
  /** Their bar for Ready; never below the company minimum. */
  confidence: z.number().int().min(50).max(100),
  /** The folder new project folders go in; null means Inbox › the company default. */
  parentFolderId: OutlookId.nullable(),
  parentFolderPath: z.string().max(400).nullable(),
  /** Used only while the company setting is optional. */
  includeSentItems: z.boolean(),
  excludedFolderIds: z.array(OutlookId).max(EMAIL_FILING_LIMITS.excludedFolders),
  excludedSenders: z.array(EmailFilingSenderSchema).max(EMAIL_FILING_LIMITS.excludedSenders),
});
export type EmailFilingSettings = z.infer<typeof EmailFilingSettingsSchema>;

export const DEFAULT_EMAIL_FILING_SETTINGS: EmailFilingSettings = {
  enabled: true,
  confidence: 90,
  parentFolderId: null,
  parentFolderPath: null,
  includeSentItems: false,
  excludedFolderIds: [],
  excludedSenders: [],
};

export const EmailFilingRuleKindSchema = z.enum(["sender", "domain", "conversation"]);
export type EmailFilingRuleKind = z.infer<typeof EmailFilingRuleKindSchema>;

/** Learned when the person files an email somewhere other than the proposal. */
export const EmailFilingRuleSchema = z.object({
  id: Id,
  kind: EmailFilingRuleKindSchema,
  /** The address, @domain, or a conversation shown by its subject. */
  label: z.string(),
  folderId: z.string(),
  folderPath: z.string(),
  createdAt: z.string(),
});
export type EmailFilingRule = z.infer<typeof EmailFilingRuleSchema>;

export const EmailFilingProfileSchema = z.object({
  settings: EmailFilingSettingsSchema,
  rules: z.array(EmailFilingRuleSchema),
  policy: EmailFilingPolicySchema,
  outlookConnected: z.boolean(),
});
export type EmailFilingProfile = z.infer<typeof EmailFilingProfileSchema>;

export const EmailFilingTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("folder"), folderId: z.string(), path: z.string() }),
  /** An Evolve project with no folder yet; File creates it under the parent folder first. */
  z.object({
    kind: z.literal("project"),
    jobNumber: z.string(),
    title: z.string(),
    folderName: z.string(),
    parentPath: z.string(),
  }),
]);
export type EmailFilingTarget = z.infer<typeof EmailFilingTargetSchema>;

export const EmailFilingItemStatusSchema = z.enum([
  "proposed",
  "filing",
  "filed",
  "skipped",
  "failed",
  "gone",
]);
export type EmailFilingItemStatus = z.infer<typeof EmailFilingItemStatusSchema>;

export const EmailFilingItemSchema = z.object({
  id: z.string(),
  subject: z.string(),
  from: z.string(),
  receivedAt: z.string().nullable(),
  hasAttachments: z.boolean(),
  preview: z.string(),
  /** Outlook on the web for this email, once it is filed too. */
  webLink: z.string().nullable(),
  source: z.enum(["inbox", "sentitems"]),
  target: EmailFilingTargetSchema.nullable(),
  /** 0–100, capped by the evidence the server found. */
  confidence: z.number().int().min(0).max(100),
  reason: z.string(),
  evidence: z.array(z.string()),
  /** At or above the person's bar with a target, so it starts ticked. */
  ready: z.boolean(),
  status: EmailFilingItemStatusSchema,
  error: z.string().nullable(),
  /** Where it went, once filed. */
  filedPath: z.string().nullable(),
  canUndo: z.boolean(),
});
export type EmailFilingItem = z.infer<typeof EmailFilingItemSchema>;

export const EmailFilingBatchSchema = z.object({
  id: Id,
  threadId: Id,
  threshold: z.number().int(),
  allowFolderCreation: z.boolean(),
  items: z.array(EmailFilingItemSchema),
  /** Why File is unavailable for this person right now, or null. */
  cannotFile: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type EmailFilingBatch = z.infer<typeof EmailFilingBatchSchema>;

export const EmailFilingFolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  depth: z.number().int().nonnegative(),
});
export type EmailFilingFolder = z.infer<typeof EmailFilingFolderSchema>;

export const EmailFilingProjectSchema = z.object({
  jobNumber: z.string(),
  title: z.string(),
  client: z.string(),
  /** A folder already filed under this job, when one exists. */
  folderId: z.string().nullable(),
  folderPath: z.string().nullable(),
});
export type EmailFilingProject = z.infer<typeof EmailFilingProjectSchema>;

export const EmailFilingRetargetSchema = z.object({
  id: Id,
  itemId: z.string().min(1).max(40),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("folder"), folderId: OutlookId }),
    z.object({ kind: z.literal("project"), jobNumber: z.string().trim().min(1).max(40) }),
  ]),
  /** Also remember this choice for the sender, their domain or this conversation. */
  remember: z.enum(["none", "sender", "domain", "conversation"]),
});
export type EmailFilingRetarget = z.infer<typeof EmailFilingRetargetSchema>;

export const EmailFilingItemsInput = z.object({
  id: Id,
  itemIds: z.array(z.string().min(1).max(40)).min(1).max(EMAIL_FILING_LIMITS.batchItems),
});
