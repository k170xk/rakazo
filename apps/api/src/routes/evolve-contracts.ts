import { createHash } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { createAdapterContext } from "@rakazo/adapter-kit";
import {
  buildClauseLibraryMarkdown,
  buildContractAgentInstructions,
  buildContractBriefingText,
  type EvolveContractBundle,
  fetchEvolveContractBundle,
} from "@rakazo/adapters";
import type { DocumentFormat, MessageBlock } from "@rakazo/contracts";
import {
  ARTIFACT_NAME_MAX_LENGTH,
  attachmentMaxBytes,
  BOT_NAME_MAX_LENGTH,
  DOCUMENT_MIME_TYPES,
} from "@rakazo/contracts";
import { BOT_AVATAR_COLORS, organicAvatarFamily, shippedHash } from "@rakazo/core";
import { createThreadMessageInTransaction, withResolvedArtifactVersion } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { actorEmail } from "./bots.js";
import type { RouterContext } from "./context.js";

type Deps = Parameters<typeof actorEmail>[0];
type Actor = Parameters<typeof actorEmail>[1];

const CONTRACT_DOWNLOAD_TIMEOUT_MS = 30_000;

function contractBotName(bundle: EvolveContractBundle): string {
  const c = bundle.contract;
  const prefix = c.jobNumber ? `${c.jobNumber} — ` : "Contract: ";
  const raw = `${prefix}${c.title || "Legal Review"}`.replace(/\s+/g, " ").trim();
  return raw.slice(0, BOT_NAME_MAX_LENGTH);
}

function sanitizeFileName(raw: string, ext: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\p{Cc}\u2028\u2029]/gu, " ").replace(/\s+/g, " ").trim();
  const suffix = ext.startsWith(".") ? ext : `.${ext}`;
  const withExt = cleaned.toLowerCase().endsWith(suffix.toLowerCase())
    ? cleaned
    : `${cleaned || "Document"}${suffix}`;
  return withExt.slice(0, ARTIFACT_NAME_MAX_LENGTH);
}

function contractLook(contractId: string) {
  const digest = shippedHash(`contract:${contractId}`);
  const color = BOT_AVATAR_COLORS[digest % BOT_AVATAR_COLORS.length] ?? "#76BF43";
  return {
    color,
    avatarFamily: organicAvatarFamily(`contract:${contractId}`),
  };
}

async function downloadBounded(url: string, maxBytes: number): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(CONTRACT_DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) return null;
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > maxBytes) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > maxBytes) return null;
    return buf;
  } catch {
    return null;
  }
}

type SyncedArtifact = {
  artifactId: string;
  rootArtifactId: string;
  name: string;
  mimeType: string;
  size: number;
  format: DocumentFormat | null;
  isPrimary: boolean;
  isNew: boolean;
};

async function storeBotFileIfMissing(
  deps: Deps,
  actor: Actor,
  input: {
    botId: string;
    name: string;
    mimeType: string;
    format: DocumentFormat | null;
    bytes: Uint8Array;
    isPrimary: boolean;
    existingByHash: Map<string, { id: string; rootArtifactId: string | null; name: string; mimeType: string; size: number }>;
  },
): Promise<SyncedArtifact> {
  const hash = createHash("sha256").update(input.bytes).digest("hex");
  const existing = input.existingByHash.get(hash);
  if (existing) {
    return {
      artifactId: existing.id,
      rootArtifactId: existing.rootArtifactId ?? existing.id,
      name: existing.name,
      mimeType: existing.mimeType,
      size: existing.size,
      format: input.format,
      isPrimary: input.isPrimary,
      isNew: false,
    };
  }

  const context = createAdapterContext(actor, input.botId, `evolve-contract:${input.botId}`);
  const stored = await deps.artifacts.put(
    { name: input.name, mimeType: input.mimeType, bytes: input.bytes },
    context,
  );

  try {
    const row = await withResolvedArtifactVersion(
      deps.prisma,
      { spaceId: actor.spaceId, userId: actor.userId, botId: input.botId, name: input.name },
      async (tx, next) =>
        tx.artifact.create({
          data: {
            spaceId: actor.spaceId,
            userId: actor.userId,
            botId: input.botId,
            name: input.name,
            mimeType: input.mimeType,
            size: input.bytes.byteLength,
            hash,
            storageKey: stored.id,
            rootArtifactId: next.rootArtifactId,
            version: next.version,
            source: input.format ? "studio" : "upload",
          },
          select: { id: true, rootArtifactId: true, name: true, mimeType: true, size: true },
        }),
    );
    input.existingByHash.set(hash, row);
    return {
      artifactId: row.id,
      rootArtifactId: row.rootArtifactId ?? row.id,
      name: row.name,
      mimeType: row.mimeType,
      size: row.size,
      format: input.format,
      isPrimary: input.isPrimary,
      isNew: true,
    };
  } catch (error) {
    await deps.artifacts.remove(stored.id, context).catch(() => undefined);
    throw error;
  }
}

/**
 * Provision or reuse a dedicated per-user Rakazo agent for an Evolve Legal Contract,
 * syncing all contract files (preferring original editable .docx) and the live OCSC
 * Clause Library into the agent's workspace & Documents.
 */
export async function openEvolveContract(
  ctx: RouterContext,
  actor: Actor,
  contractId: string,
): Promise<{
  botId: string;
  created: boolean;
  contractTitle: string;
  primaryDocArtifactId: string | null;
  primaryDocFormat: DocumentFormat | null;
  syncedFilesCount: number;
  clauseCount: number;
}> {
  const { deps, repos } = ctx;
  const email = await actorEmail(deps, actor);
  if (!deps.evolvePlugins || !email) {
    throw new ORPCError("BAD_REQUEST", { message: "Evolve is not linked to this server." });
  }

  let bundle: EvolveContractBundle;
  try {
    bundle = await fetchEvolveContractBundle(deps.evolvePlugins, email, contractId);
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    if (status === 403) {
      throw new ORPCError("FORBIDDEN", {
        message: "You do not have access to this contract in Evolve.",
      });
    }
    if (status === 404) {
      throw new ORPCError("NOT_FOUND", { message: "Contract not found in Evolve." });
    }
    getLogger().warn("evolve contract bundle", { contractId, error: String(error) });
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Could not load this contract from Evolve. Try again shortly.",
    });
  }

  const spawnKey = `contract:${bundle.contract.id}`;
  const instructions = buildContractAgentInstructions(bundle);
  const name = contractBotName(bundle);
  const description = [
    "Legal Red-Pen Reviewer",
    bundle.contract.clientName,
    bundle.contract.jobNumber,
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 500);

  let existingBot = await deps.prisma.bot.findFirst({
    where: { spaceId: actor.spaceId, userId: actor.userId, spawnKey },
    select: { id: true, archivedAt: true, thread: { select: { id: true } } },
  });

  let created = false;
  let botId: string;
  let threadId: string | null = existingBot?.thread?.id ?? null;

  if (existingBot) {
    botId = existingBot.id;
    await deps.prisma.bot.update({
      where: { id: botId },
      data: {
        ...(existingBot.archivedAt ? { archivedAt: null } : {}),
        name,
        description,
        instructions,
      },
    });
  } else {
    const look = contractLook(bundle.contract.id);
    const bot = await repos.createBot(actor, {
      name,
      description,
      instructions,
      notifyOnFinish: true,
      color: look.color,
      avatarFamily: look.avatarFamily,
      spawnKey,
      initialMessage: {
        role: "system",
        blocks: [
          {
            kind: "meta",
            text: `Legal Red-Pen workspace linked to Evolve contract "${bundle.contract.title}"`,
          },
        ],
      },
    });
    botId = bot.id;
    threadId = bot.threadId ?? null;
    created = true;
  }

  if (!threadId) {
    const thread = await deps.prisma.thread.findUnique({
      where: { botId },
      select: { id: true },
    });
    threadId = thread?.id ?? null;
  }

  // Load existing artifacts on this bot to deduplicate by SHA-256 hash.
  const existingArtifacts = await deps.prisma.artifact.findMany({
    where: { spaceId: actor.spaceId, userId: actor.userId, botId },
    select: { id: true, rootArtifactId: true, name: true, mimeType: true, size: true, hash: true },
  });
  const existingByHash = new Map<
    string,
    { id: string; rootArtifactId: string | null; name: string; mimeType: string; size: number }
  >();
  for (const row of existingArtifacts) {
    if (row.hash) existingByHash.set(row.hash, row);
  }

  const maxBytes = attachmentMaxBytes({ maxUploadSizeBytes: deps.env.maxUploadSizeBytes });
  const synced: SyncedArtifact[] = [];

  for (const doc of bundle.documents) {
    const bytes = await downloadBounded(doc.signedUrl, maxBytes);
    if (!bytes) continue;
    const format: DocumentFormat = doc.fileKind;
    const mimeType = DOCUMENT_MIME_TYPES[format];
    const safeName = sanitizeFileName(doc.name, `.${format}`);
    try {
      const saved = await storeBotFileIfMissing(deps, actor, {
        botId,
        name: safeName,
        mimeType,
        format,
        bytes,
        isPrimary: doc.isPrimary,
        existingByHash,
      });
      synced.push(saved);
    } catch (error) {
      getLogger().warn("evolve contract file sync failed", {
        contractId,
        file: doc.name,
        error: String(error),
      });
    }
  }

  // Also sync the full OCSC Clause Library Markdown reference when rules exist.
  let clauseLibraryArtifact: SyncedArtifact | null = null;
  if (bundle.clauseLibrary.length > 0) {
    const mdBytes = new TextEncoder().encode(buildClauseLibraryMarkdown(bundle.clauseLibrary));
    try {
      clauseLibraryArtifact = await storeBotFileIfMissing(deps, actor, {
        botId,
        name: "OCSC-Clause-Library.md",
        mimeType: "text/markdown",
        format: null,
        bytes: mdBytes,
        isPrimary: false,
        existingByHash,
      });
    } catch (error) {
      getLogger().warn("evolve clause library sync failed", {
        contractId,
        error: String(error),
      });
    }
  }

  // Post initial briefing + attached files on first creation, or a concise sync update when new files arrived.
  const newlySynced = synced.filter((f) => f.isNew);
  if (threadId && (created || newlySynced.length > 0)) {
    const filesForMessage = created
      ? [...synced, ...(clauseLibraryArtifact ? [clauseLibraryArtifact] : [])]
      : [
          ...newlySynced,
          ...(clauseLibraryArtifact?.isNew ? [clauseLibraryArtifact] : []),
        ];

    const blocks: MessageBlock[] = [
      {
        kind: "text",
        text: created
          ? buildContractBriefingText(
              bundle,
              synced.map((f) => f.name),
            )
          : `Synced ${newlySynced.length} newly uploaded contract document${newlySynced.length === 1 ? "" : "s"} from Evolve:`,
      },
      ...filesForMessage.map(
        (f): MessageBlock => ({
          kind: "file",
          artifactId: f.artifactId,
          name: f.name,
          mimeType: f.mimeType,
          size: f.size,
        }),
      ),
    ];

    const seq = await deps.prisma.$transaction(async (tx) => {
      const msg = await createThreadMessageInTransaction(tx, {
        threadId,
        role: "bot",
        botId,
        blocks,
        markUnread: false,
      });
      return msg.seq;
    });
    deps.events.notify(threadId, seq);
  }

  // Prefer primary .docx for Word Studio side-by-side editing; fall back to any .docx, then primary .pdf.
  const primaryDoc =
    synced.find((f) => f.isPrimary && f.format === "docx") ??
    synced.find((f) => f.format === "docx") ??
    synced.find((f) => f.isPrimary) ??
    synced[0] ??
    null;

  return {
    botId,
    created,
    contractTitle: bundle.contract.title,
    primaryDocArtifactId: primaryDoc?.rootArtifactId ?? null,
    primaryDocFormat: primaryDoc?.format ?? null,
    syncedFilesCount: synced.length,
    clauseCount: bundle.clauseLibrary.length,
  };
}
