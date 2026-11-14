import { randomUUID } from "node:crypto";
import type {
  EmailFilingBatch,
  EmailFilingItemStatus,
  EmailFilingMemory,
  EmailFilingPolicy,
  EmailFilingRule,
  EmailFilingRuleKind,
  EmailFilingSettings,
  EmailFilingTarget,
  EvolveProjectOption,
} from "@rakazo/contracts";
import {
  DEFAULT_EMAIL_FILING_SETTINGS,
  EMAIL_FILING_BATCH_DAYS,
  EMAIL_FILING_LIMITS,
  EmailFilingItemStatusSchema,
  EmailFilingRuleKindSchema,
  EmailFilingSettingsSchema,
  emailFilingPolicyFrom,
} from "@rakazo/contracts";
import type { Prisma, PrismaClient } from "@rakazo/db";
import { runAsTenant } from "@rakazo/db";
import * as z from "zod";
import { companyTools } from "./company-policy.js";
import type { EvolvePluginsConnection } from "./evolve-plugins.js";
import { listEvolveReferenceProjects } from "./evolve-references.js";
import type { MailGraph, MailMessage } from "./microsoft-mail.js";
import { address, odataString } from "./microsoft-mail.js";
import { MAILBOX_CONCURRENCY, mapLimited } from "./microsoft-mail-triage.js";

export type FilingOwner = { spaceId: string; userId: string };

/** The company's filing rules as they stand now. */
export function companyEmailFilingPolicy(): EmailFilingPolicy {
  return emailFilingPolicyFrom(companyTools().emailFiling);
}

/** The bar for Ready: the person's own, never below the company minimum. */
export function filingThreshold(policy: EmailFilingPolicy, settings: EmailFilingSettings): number {
  return Math.max(policy.minConfidence, settings.confidence);
}

export function filingIncludesSentItems(
  policy: EmailFilingPolicy,
  settings: EmailFilingSettings,
): boolean {
  return (
    policy.sentItems === "on" || (policy.sentItems === "optional" && settings.includeSentItems)
  );
}

// ---------------------------------------------------------------------------------------------
// Job numbers

export interface JobKey {
  /** As written but normalised: upper case, `/` and `-` suffixes as `.`, e.g. 1234.01. */
  key: string;
  /** The parent job, e.g. 1234 for 1234.01; equal to key when there is no suffix. */
  parent: string;
}

const JOB_TOKEN = /^([A-Z]{0,3})(\d{3,6})(?:[./-](\d{1,3}))?$/;

/** A job reference such as 1234, 1234.01, 1234/1 or C2045, or null when it is not one. */
export function jobKeyOf(raw: string): JobKey | null {
  const token = raw
    .trim()
    .toUpperCase()
    .replace(/^(JOB|PROJECT|REF)\s*(NO\.?|NUMBER)?\s*[:#]?\s*/, "")
    .replace(/^#/, "");
  const match = JOB_TOKEN.exec(token);
  if (!match) return null;
  const [, prefix = "", digits = "", suffix] = match;
  const parent = `${prefix}${digits}`;
  return { key: suffix ? `${parent}.${suffix.padStart(2, "0")}` : parent, parent };
}

/** The job a folder is named after: the leading job token, as in "1234 - Riverside School". */
export function folderJobKey(name: string): JobKey | null {
  const match = /^\s*([A-Za-z]{0,3}\d{3,6}(?:[./-]\d{1,3})?)(?=$|[\s_\-–:)])/.exec(name);
  return match?.[1] ? jobKeyOf(match[1]) : null;
}

const REFERENCE = /(?<![\w./-])([A-Za-z]{0,3}\d{3,6}(?:[./-]\d{1,3})?)(?![\w/-]|\.\d)/g;
const JOB_WORD = /(job|project|proj|ref|reference|no\.?|number|#)\s*[:#]?\s*$/i;

/**
 * Job references written in an email. A bare 4-digit year or a long number is skipped unless a
 * word such as job, project or ref comes just before it.
 */
export function textJobReferences(text: string): JobKey[] {
  const found = new Map<string, JobKey>();
  for (const match of text.matchAll(REFERENCE)) {
    const raw = match[1] ?? "";
    const job = jobKeyOf(raw);
    if (!job) continue;
    const before = text.slice(Math.max(0, (match.index ?? 0) - 14), match.index ?? 0);
    const labelled = JOB_WORD.test(before);
    const digitsOnly = /^\d+$/.test(job.parent);
    const year = digitsOnly && /^(19|20)\d\d$/.test(job.parent) && job.key === job.parent;
    if ((year || (digitsOnly && job.parent.length > 5)) && !labelled) continue;
    found.set(job.key, job);
  }
  return [...found.values()].slice(0, 12);
}

/** How a reference in an email relates to a folder's job: the same job, or only its parent. */
export function jobMatch(reference: JobKey, folder: JobKey): "exact" | "parent" | null {
  if (reference.key === folder.key) return "exact";
  if (reference.parent === folder.key || reference.key === folder.parent) return "parent";
  return null;
}

/** Outlook folder names cannot hold some characters; this keeps the job number first. */
export function projectFolderName(jobNumber: string, title: string): string {
  const clean = (value: string) =>
    value
      .replace(/[\p{Cc}\\/:*?"<>|]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  const name = clean(title) ? `${clean(jobNumber)} - ${clean(title)}` : clean(jobNumber);
  return name.slice(0, EMAIL_FILING_LIMITS.folderName).trim();
}

// ---------------------------------------------------------------------------------------------
// Folders

export interface FolderNode {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  depth: number;
  job: JobKey | null;
}

const FOLDER_SELECT = "id,displayName,parentFolderId,childFolderCount";
const FOLDER_MAX = 600;
const FOLDER_DEPTH = 6;

/** Every mail folder down to a sensible depth, with its path as Outlook shows it. */
export async function listMailFolders(graph: MailGraph): Promise<FolderNode[]> {
  type Raw = { id: string; displayName?: string; childFolderCount?: number };
  const out: FolderNode[] = [];
  const top = await graph.json<{ value?: Raw[] }>(
    `/me/mailFolders?$top=100&$select=${FOLDER_SELECT}`,
  );
  let level: Array<{ raw: Raw; parent: FolderNode | null }> = (top.value ?? []).map((raw) => ({
    raw,
    parent: null,
  }));
  for (let depth = 0; depth < FOLDER_DEPTH && level.length > 0; depth++) {
    const next: Array<{ raw: Raw; parent: FolderNode | null }> = [];
    const withChildren: FolderNode[] = [];
    for (const { raw, parent } of level) {
      if (out.length >= FOLDER_MAX) break;
      const name = raw.displayName ?? "";
      const node: FolderNode = {
        id: raw.id,
        name,
        path: parent ? `${parent.path} › ${name}` : name,
        parentId: parent?.id ?? null,
        depth,
        job: folderJobKey(name),
      };
      out.push(node);
      if ((raw.childFolderCount ?? 0) > 0) withChildren.push(node);
    }
    const children = await mapLimited(withChildren, MAILBOX_CONCURRENCY, async (parent) => {
      const listed = await graph
        .json<{ value?: Raw[] }>(
          `/me/mailFolders/${encodeURIComponent(parent.id)}/childFolders?$top=250&$select=${FOLDER_SELECT}`,
        )
        .catch(() => ({ value: [] as Raw[] }));
      return (listed.value ?? []).map((raw) => ({ raw, parent }));
    });
    for (const list of children) next.push(...list);
    level = next;
  }
  return out;
}

const WELL_KNOWN = ["inbox", "sentitems", "drafts", "deleteditems", "junkemail", "outbox"] as const;
export type WellKnownFolders = Partial<Record<(typeof WELL_KNOWN)[number], string>>;

export async function wellKnownFolderIds(graph: MailGraph): Promise<WellKnownFolders> {
  const ids = await mapLimited([...WELL_KNOWN], MAILBOX_CONCURRENCY, (name) =>
    graph
      .json<{ id?: string }>(`/me/mailFolders/${name}?$select=id`)
      .then((folder) => folder.id ?? null)
      .catch(() => null),
  );
  const result: WellKnownFolders = {};
  WELL_KNOWN.forEach((name, index) => {
    const id = ids[index];
    if (id) result[name] = id;
  });
  return result;
}

/**
 * Folders mail is never filed into: Inbox itself, Sent Items, Drafts, Outbox, and anything in or
 * under Deleted Items or Junk.
 */
export function blockedFolderIds(folders: FolderNode[], known: WellKnownFolders): Set<string> {
  const blocked = new Set<string>(
    [known.inbox, known.sentitems, known.drafts, known.outbox].filter((id): id is string =>
      Boolean(id),
    ),
  );
  const roots = new Set(
    [known.deleteditems, known.junkemail].filter((id): id is string => Boolean(id)),
  );
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  for (const folder of folders) {
    for (
      let at: FolderNode | undefined = folder;
      at;
      at = at.parentId ? byId.get(at.parentId) : undefined
    ) {
      if (roots.has(at.id)) {
        blocked.add(folder.id);
        break;
      }
    }
  }
  for (const id of roots) blocked.add(id);
  return blocked;
}

/** Folders a person may file into, minus the ones they asked filing never to touch. */
export function fileableFolders(
  folders: FolderNode[],
  known: WellKnownFolders,
  settings: EmailFilingSettings,
): FolderNode[] {
  const blocked = blockedFolderIds(folders, known);
  const excluded = new Set(settings.excludedFolderIds);
  return folders.filter((folder) => !blocked.has(folder.id) && !excluded.has(folder.id));
}

// ---------------------------------------------------------------------------------------------
// Evidence

export type EvidenceKind = "job_exact" | "job_parent" | "rule" | "conversation" | "title";

export interface Evidence {
  folderId: string;
  kind: EvidenceKind;
  detail: string;
}

const STRONG: ReadonlySet<EvidenceKind> = new Set(["job_exact", "rule", "conversation"]);

/** The most confidence a target can carry: high only with evidence the server found itself. */
export function confidenceCap(evidence: readonly Evidence[], folderId: string | null): number {
  const mine = folderId ? evidence.filter((entry) => entry.folderId === folderId) : [];
  if (mine.some((entry) => STRONG.has(entry.kind))) return 100;
  if (mine.length > 0) return 85;
  return 70;
}

export interface CandidateMessage {
  id: string;
  conversationId: string | null;
  subject: string;
  fromAddress: string | null;
  text: string;
}

export function candidateFrom(message: MailMessage): CandidateMessage {
  const attachments = (message.attachments ?? [])
    .filter((file) => !file.isInline)
    .map((file) => file.name ?? "")
    .join(" ");
  return {
    id: message.id,
    conversationId: message.conversationId ?? null,
    subject: message.subject ?? "",
    fromAddress: message.from?.emailAddress?.address?.toLowerCase() ?? null,
    text: `${message.subject ?? ""}\n${message.bodyPreview ?? ""}\n${attachments}`,
  };
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "project",
  "projects",
  "job",
  "jobs",
  "general",
  "admin",
  "folder",
  "misc",
  "other",
  "re",
  "fw",
  "fwd",
]);

function titleWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/^\s*[a-z]{0,3}\d{3,6}([./-]\d{1,3})?/, " ")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
}

/**
 * What points an email at each folder: a job number in it that a folder is named after, a rule the
 * person taught, earlier mail of the same conversation filed there, or the folder's words in the
 * subject.
 */
export function evidenceFor(
  message: CandidateMessage,
  folders: readonly FolderNode[],
  rules: readonly StoredFilingRule[],
  conversationFolders: ReadonlyMap<string, ReadonlySet<string>>,
): Evidence[] {
  const evidence: Evidence[] = [];
  const references = textJobReferences(message.text);
  for (const folder of folders) {
    if (!folder.job) continue;
    for (const reference of references) {
      const match = jobMatch(reference, folder.job);
      if (match === "exact") {
        evidence.push({
          folderId: folder.id,
          kind: "job_exact",
          detail: `Mentions job ${reference.key}`,
        });
      } else if (match === "parent") {
        evidence.push({
          folderId: folder.id,
          kind: "job_parent",
          detail: `Mentions ${reference.key}; this folder is ${folder.job.key} (parent job only)`,
        });
      }
    }
  }
  const domain = message.fromAddress?.split("@")[1];
  for (const rule of rules) {
    const applies =
      (rule.kind === "sender" && rule.value === message.fromAddress) ||
      (rule.kind === "domain" && domain && rule.value === `@${domain}`) ||
      (rule.kind === "conversation" && rule.value === message.conversationId);
    if (applies && folders.some((folder) => folder.id === rule.folderId)) {
      evidence.push({
        folderId: rule.folderId,
        kind: "rule",
        detail: `You filed ${rule.label} here before`,
      });
    }
  }
  for (const folderId of message.conversationId
    ? (conversationFolders.get(message.conversationId) ?? [])
    : []) {
    if (folders.some((folder) => folder.id === folderId)) {
      evidence.push({
        folderId,
        kind: "conversation",
        detail: "Earlier mail in this conversation is filed here",
      });
    }
  }
  const subject = message.subject.toLowerCase();
  for (const folder of folders) {
    const words = titleWords(folder.name);
    if (words.length === 0) continue;
    const hits = words.filter((word) => subject.includes(word));
    if (hits.length >= Math.min(2, words.length)) {
      evidence.push({
        folderId: folder.id,
        kind: "title",
        detail: `Subject shares "${hits.slice(0, 3).join(" ")}" with the folder name`,
      });
    }
  }
  const seen = new Set<string>();
  return evidence.filter((entry) => {
    const key = `${entry.folderId}:${entry.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** For each conversation, the folders (other than the excluded ones) its other emails sit in. */
export async function conversationFolderMap(
  graph: MailGraph,
  conversationIds: readonly string[],
  skipFolderIds: ReadonlySet<string>,
): Promise<Map<string, Set<string>>> {
  const unique = [...new Set(conversationIds)].slice(0, 40);
  const results = await mapLimited(unique, MAILBOX_CONCURRENCY, async (conversationId) => {
    const listed = await graph
      .json<{ value?: Array<{ parentFolderId?: string }> }>(
        `/me/messages?$filter=${encodeURIComponent(`conversationId eq ${odataString(conversationId)}`)}&$top=25&$select=id,parentFolderId`,
      )
      .catch(() => ({ value: [] }));
    const folders = new Set<string>();
    for (const message of listed.value ?? []) {
      if (message.parentFolderId && !skipFolderIds.has(message.parentFolderId)) {
        folders.add(message.parentFolderId);
      }
    }
    return [conversationId, folders] as const;
  });
  return new Map(results);
}

// ---------------------------------------------------------------------------------------------
// Evolve projects

export interface ResolvedProject {
  jobNumber: string;
  job: JobKey;
  title: string;
  client: string;
  match: "exact" | "parent";
}

/** The Evolve project with this job number, read as the person; exact matches win over parents. */
export async function resolveEvolveJob(
  connection: EvolvePluginsConnection,
  email: string,
  raw: string,
  options: { signal?: AbortSignal } = {},
): Promise<ResolvedProject | null> {
  const wanted = jobKeyOf(raw);
  if (!wanted) return null;
  const page = await listEvolveReferenceProjects(
    connection,
    email,
    { search: wanted.parent, page: 0 },
    options,
  );
  let best: ResolvedProject | null = null;
  for (const project of page.projects) {
    const job = project.jobNumber ? jobKeyOf(project.jobNumber) : null;
    if (!job) continue;
    const match = job.key === wanted.key ? "exact" : jobMatch(wanted, job);
    if (!match) continue;
    const resolved = toResolved(project, job, match);
    if (match === "exact") return resolved;
    best ??= resolved;
  }
  return best;
}

function toResolved(
  project: EvolveProjectOption,
  job: JobKey,
  match: "exact" | "parent",
): ResolvedProject {
  return {
    jobNumber: project.jobNumber ?? job.key,
    job,
    title: project.name,
    client: project.client,
    match,
  };
}

/** A folder already named after this job, preferring one under the parent folder. */
export function folderForJob(
  folders: readonly FolderNode[],
  job: JobKey,
  parentId: string | null,
): FolderNode | null {
  const exact = folders.filter((folder) => folder.job?.key === job.key);
  return exact.find((folder) => folder.parentId === parentId) ?? exact[0] ?? null;
}

// ---------------------------------------------------------------------------------------------
// Stored rows

const StoredTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("folder"), folderId: z.string(), path: z.string() }),
  z.object({
    kind: z.literal("project"),
    jobNumber: z.string(),
    jobKey: z.string(),
    title: z.string(),
    folderName: z.string(),
    parentPath: z.string(),
  }),
]);
export type StoredFilingTarget = z.infer<typeof StoredTargetSchema>;

const StoredItemSchema = z.object({
  id: z.string(),
  messageId: z.string(),
  conversationId: z.string().nullable(),
  sourceFolderId: z.string(),
  source: z.enum(["inbox", "sentitems"]),
  subject: z.string(),
  from: z.string(),
  fromAddress: z.string().nullable(),
  receivedAt: z.string().nullable(),
  hasAttachments: z.boolean(),
  preview: z.string(),
  webLink: z.string().nullable(),
  target: StoredTargetSchema.nullable(),
  confidence: z.number(),
  reason: z.string(),
  evidence: z.array(z.string()),
  /** Set when the person picked the target themselves. */
  chosen: z.boolean().default(false),
  remember: z.enum(["none", "sender", "domain", "conversation"]).default("none"),
  status: EmailFilingItemStatusSchema,
  error: z.string().nullable(),
  filedFolderId: z.string().nullable(),
  filedPath: z.string().nullable(),
  movedMessageId: z.string().nullable(),
  filedAt: z.string().nullable(),
});
export type StoredFilingItem = z.infer<typeof StoredItemSchema>;

const StoredBatchSchema = z.object({
  items: z.array(StoredItemSchema),
  threshold: z.number(),
  allowFolderCreation: z.boolean(),
});
export type StoredFilingBatch = z.infer<typeof StoredBatchSchema>;

export function storedFilingBatch(content: unknown): StoredFilingBatch {
  const parsed = StoredBatchSchema.safeParse(content);
  return parsed.success ? parsed.data : { items: [], threshold: 100, allowFolderCreation: false };
}

const StoredRuleSchema = z.object({
  id: z.string(),
  kind: EmailFilingRuleKindSchema,
  value: z.string(),
  label: z.string(),
  folderId: z.string(),
  folderPath: z.string(),
  createdAt: z.string(),
});
export type StoredFilingRule = z.infer<typeof StoredRuleSchema>;

const StoredMemorySchema = z.object({
  id: z.string(),
  text: z.string(),
  createdAt: z.string(),
});
export type StoredFilingMemory = z.infer<typeof StoredMemorySchema>;

const StoredProfileSchema = z.object({
  settings: EmailFilingSettingsSchema.partial().default({}),
  rules: z.array(StoredRuleSchema).default([]),
  memories: z.array(StoredMemorySchema).default([]),
});

export interface FilingProfile {
  id: string | null;
  version: number;
  settings: EmailFilingSettings;
  rules: StoredFilingRule[];
  memories: StoredFilingMemory[];
}

export async function loadFilingProfile(
  prisma: PrismaClient,
  owner: FilingOwner,
): Promise<FilingProfile> {
  const row = await runAsTenant(owner, () =>
    prisma.emailFilingProfile.findFirst({
      where: { spaceId: owner.spaceId, userId: owner.userId },
    }),
  );
  const parsed = StoredProfileSchema.safeParse(row?.content ?? {});
  const stored = parsed.success ? parsed.data : { settings: {}, rules: [], memories: [] };
  return {
    id: row?.id ?? null,
    version: row?.version ?? 0,
    settings: { ...DEFAULT_EMAIL_FILING_SETTINGS, ...stored.settings },
    rules: stored.rules,
    memories: stored.memories,
  };
}

/** Saves the profile unless it changed since it was read; returns whether it saved. */
export async function saveFilingProfile(
  prisma: PrismaClient,
  owner: FilingOwner,
  profile: FilingProfile,
): Promise<boolean> {
  const content = {
    settings: profile.settings,
    rules: profile.rules.slice(-EMAIL_FILING_LIMITS.rules),
    memories: profile.memories.slice(-EMAIL_FILING_LIMITS.memories),
  } as Prisma.InputJsonValue;
  return runAsTenant(owner, async () => {
    if (!profile.id) {
      try {
        await prisma.emailFilingProfile.create({
          data: { spaceId: owner.spaceId, userId: owner.userId, content },
        });
        return true;
      } catch {
        return false;
      }
    }
    const { count } = await prisma.emailFilingProfile.updateMany({
      where: { id: profile.id, userId: owner.userId, version: profile.version },
      data: { content, version: { increment: 1 } },
    });
    return count === 1;
  });
}

/** Applies a change to the profile, retrying once if another save raced it. */
export async function updateFilingProfile(
  prisma: PrismaClient,
  owner: FilingOwner,
  change: (profile: FilingProfile) => FilingProfile,
): Promise<FilingProfile> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const next = change(await loadFilingProfile(prisma, owner));
    if (await saveFilingProfile(prisma, owner, next)) return loadFilingProfile(prisma, owner);
  }
  throw new Error("Your filing settings changed elsewhere. Try again.");
}

/** A rule the person taught by filing an email somewhere else; one per sender, domain or thread. */
export function learnRule(
  rules: readonly StoredFilingRule[],
  item: Pick<StoredFilingItem, "fromAddress" | "conversationId" | "subject">,
  kind: Exclude<StoredFilingItem["remember"], "none">,
  folder: { id: string; path: string },
): StoredFilingRule[] {
  const value =
    kind === "sender"
      ? item.fromAddress
      : kind === "domain"
        ? item.fromAddress?.includes("@")
          ? `@${item.fromAddress.split("@")[1]}`
          : null
        : item.conversationId;
  if (!value) return [...rules];
  const label = kind === "conversation" ? `the conversation "${item.subject.slice(0, 80)}"` : value;
  const kept = rules.filter((rule) => !(rule.kind === kind && rule.value === value));
  return [
    ...kept,
    {
      id: randomUUID().slice(0, 12),
      kind: kind as EmailFilingRuleKind,
      value,
      label,
      folderId: folder.id,
      folderPath: folder.path,
      createdAt: new Date().toISOString(),
    },
  ];
}

export function publicRule(rule: StoredFilingRule): EmailFilingRule {
  return {
    id: rule.id,
    kind: rule.kind,
    label: rule.label,
    folderId: rule.folderId,
    folderPath: rule.folderPath,
    createdAt: rule.createdAt,
  };
}

/** The instruction filing will read next time, or null when there is nothing to keep. */
export function filingMemoryText(text: string): string | null {
  const cleaned = text.replace(/\s+/g, " ").trim().slice(0, EMAIL_FILING_LIMITS.memory);
  return cleaned.length >= 3 ? cleaned : null;
}

/** Adds one instruction, replacing an earlier one that says the same thing. */
export function addFilingMemory(
  memories: readonly StoredFilingMemory[],
  text: string,
): StoredFilingMemory[] {
  const cleaned = filingMemoryText(text);
  if (!cleaned) return [...memories];
  const kept = memories.filter((memory) => memory.text.toLowerCase() !== cleaned.toLowerCase());
  return [
    ...kept,
    { id: randomUUID().slice(0, 12), text: cleaned, createdAt: new Date().toISOString() },
  ].slice(-EMAIL_FILING_LIMITS.memories);
}

export function publicMemory(memory: StoredFilingMemory): EmailFilingMemory {
  return { id: memory.id, text: memory.text, createdAt: memory.createdAt };
}

/** Message ids still waiting on an open card, so a new proposal does not repeat them. */
export async function pendingFilingMessageIds(
  prisma: PrismaClient,
  owner: FilingOwner,
): Promise<Set<string>> {
  const rows = await runAsTenant(owner, () =>
    prisma.emailFilingBatch.findMany({
      where: {
        spaceId: owner.spaceId,
        userId: owner.userId,
        status: "open",
        expiresAt: { gt: new Date() },
      },
      select: { content: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  );
  const ids = new Set<string>();
  for (const row of rows) {
    for (const item of storedFilingBatch(row.content).items) {
      if (item.status === "proposed" || item.status === "filing") ids.add(item.messageId);
    }
  }
  return ids;
}

export async function createFilingBatch(
  prisma: PrismaClient,
  owner: FilingOwner,
  input: { threadId: string; botId: string; runId: string; content: StoredFilingBatch },
): Promise<{ id: string }> {
  return runAsTenant(owner, async () => {
    await prisma.emailFilingBatch.deleteMany({
      where: { spaceId: owner.spaceId, userId: owner.userId, expiresAt: { lt: new Date() } },
    });
    return prisma.emailFilingBatch.create({
      data: {
        spaceId: owner.spaceId,
        userId: owner.userId,
        threadId: input.threadId,
        botId: input.botId,
        runId: input.runId,
        content: input.content as Prisma.InputJsonValue,
        status: batchStatus(input.content.items),
        expiresAt: new Date(Date.now() + EMAIL_FILING_BATCH_DAYS * 86_400_000),
      },
      select: { id: true },
    });
  });
}

export function batchStatus(items: readonly StoredFilingItem[]): "open" | "done" {
  return items.some(
    (item) => item.status === "proposed" || item.status === "filing" || item.status === "failed",
  )
    ? "open"
    : "done";
}

export function publicTarget(target: StoredFilingTarget | null): EmailFilingTarget | null {
  if (!target) return null;
  if (target.kind === "folder") return target;
  return {
    kind: "project",
    jobNumber: target.jobNumber,
    title: target.title,
    folderName: target.folderName,
    parentPath: target.parentPath,
  };
}

export function presentFilingBatch(
  row: {
    id: string;
    threadId: string;
    content: unknown;
    expiresAt: Date;
    createdAt: Date;
  },
  cannotFile: string | null,
): EmailFilingBatch {
  const content = storedFilingBatch(row.content);
  return {
    id: row.id,
    threadId: row.threadId,
    threshold: content.threshold,
    allowFolderCreation: content.allowFolderCreation,
    items: content.items.map((item) => ({
      id: item.id,
      subject: item.subject,
      from: item.from,
      receivedAt: item.receivedAt,
      hasAttachments: item.hasAttachments,
      preview: item.preview,
      webLink: item.webLink,
      source: item.source,
      target: publicTarget(item.target),
      confidence: Math.round(item.confidence),
      reason: item.reason,
      evidence: item.evidence,
      ready:
        item.status === "proposed" &&
        item.target !== null &&
        (item.chosen || item.confidence >= content.threshold),
      status: item.status as EmailFilingItemStatus,
      error: item.error,
      filedPath: item.filedPath,
      canUndo: item.status === "filed" && Boolean(item.movedMessageId),
    })),
    cannotFile,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export function describeSender(message: MailMessage): string {
  return address(message.from) ?? "(unknown sender)";
}
