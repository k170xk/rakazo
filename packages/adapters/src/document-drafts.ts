import type { AdapterContext, ArtifactStore } from "@rakazo/adapter-kit";
import { attachmentExtensionForMimeType } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { newestFamilyVersion } from "./document-versions.js";
import { editedAttachmentId, printedJson } from "./ocsc-tool.js";

/** A draft larger than this is not kept; the studio waits for the attached version instead. */
export const DOCUMENT_DRAFT_MAX_BYTES = 25 * 1024 * 1024;

const DRAFT_PROGRAMS = new Set(["word", "pptx", "xlsx"]);

export type DocumentDraftDeps = {
  prisma: Pick<PrismaClient, "artifact" | "documentDraft">;
  artifacts: ArtifactStore | undefined;
};

export type DocumentDraftWrite = {
  context: AdapterContext;
  program: string;
  args: readonly string[];
  result: unknown;
  /** Reads a file the command wrote, by the path it was given. */
  read: (filePath: string, maxBytes: number) => Promise<Uint8Array>;
};

function outPath(args: readonly string[], printed: Record<string, unknown>): string | undefined {
  const at = args.indexOf("--out");
  const given = at >= 0 ? args[at + 1] : undefined;
  if (given) return given;
  return typeof printed.path === "string" && printed.path ? printed.path : undefined;
}

/**
 * After a successful ocsc edit of a conversation file, keeps what it wrote as that family's live
 * draft so an open studio can show it before the file is attached. Never throws.
 */
export async function saveDocumentDraft(
  deps: DocumentDraftDeps,
  write: DocumentDraftWrite,
): Promise<"saved" | "skipped" | "failed"> {
  const { artifacts, prisma } = deps;
  if (!artifacts || !DRAFT_PROGRAMS.has(write.program)) return "skipped";
  const artifactId = editedAttachmentId(write.program, write.args);
  if (!artifactId) return "skipped";
  const printed = printedJson(write.result);
  if (printed?.ok !== true) return "skipped";
  const filePath = outPath(write.args, printed);
  if (!filePath) return "skipped";
  const { spaceId, userId, botId } = write.context;
  try {
    const family = await newestFamilyVersion(prisma, { spaceId, userId }, artifactId);
    if (!family || family.newest.version > family.given.version) return "skipped";
    const bytes = await write.read(filePath, DOCUMENT_DRAFT_MAX_BYTES);
    const key = { spaceId, userId, rootArtifactId: family.rootId };
    const previous = await prisma.documentDraft.findUnique({
      where: { spaceId_userId_rootArtifactId: key },
      select: { storageKey: true },
    });
    const ext = attachmentExtensionForMimeType(family.newest.mimeType);
    const stored = await artifacts.put(
      { name: `draft${ext}`, mimeType: family.newest.mimeType, bytes },
      write.context,
    );
    const fields = {
      botId: botId || null,
      storageKey: stored.id,
      size: bytes.byteLength,
      baseVersion: family.given.version,
    };
    await prisma.documentDraft.upsert({
      where: { spaceId_userId_rootArtifactId: key },
      create: { ...key, ...fields },
      update: fields,
    });
    if (previous && previous.storageKey !== stored.id) {
      await artifacts.remove(previous.storageKey, write.context).catch((error: unknown) => {
        getLogger().warn("old document draft not removed", { error: String(error) });
      });
    }
    return "saved";
  } catch (error) {
    getLogger().warn("document draft not saved", { error: String(error) });
    return "failed";
  }
}
