import type { MessageBlock } from "@rakazo/contracts";
import { studioNoteDocument } from "@rakazo/contracts";
import { attachmentExtensionForMimeType } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";

type Owner = { spaceId: string; userId: string };

export type FamilyVersion = {
  id: string;
  version: number;
  name: string;
  mimeType: string;
  source: string | null;
};

/** The artifact and its family's newest version, both the owner's; undefined when not theirs. */
export async function newestFamilyVersion(
  prisma: Pick<PrismaClient, "artifact">,
  owner: Owner,
  artifactId: string,
): Promise<{ given: FamilyVersion; rootId: string; newest: FamilyVersion } | undefined> {
  const select = { id: true, version: true, name: true, mimeType: true, source: true } as const;
  const given = await prisma.artifact.findFirst({
    where: { id: artifactId, spaceId: owner.spaceId, userId: owner.userId },
    select: { ...select, rootArtifactId: true },
  });
  if (!given) return undefined;
  const rootId = given.rootArtifactId ?? given.id;
  const newest = await prisma.artifact.findFirst({
    where: {
      spaceId: owner.spaceId,
      userId: owner.userId,
      OR: [{ id: rootId }, { rootArtifactId: rootId }],
    },
    orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    select,
  });
  return { given, rootId, newest: newest ?? given };
}

/** Where an artifact sits on a run's computer once fetched or attached. */
export function attachmentPathFor(row: { id: string; mimeType: string }): string {
  return `attachments/${row.id}${attachmentExtensionForMimeType(row.mimeType)}`;
}

/** The document a studio note names, as the run that answers the note may reach it. */
export type StudioDocument = {
  rootId: string;
  /** The family's newest version, then the version the studio showed when that is older. */
  versions: readonly (FamilyVersion & { size: number })[];
  /** Where the family's versions are kept, so an attached edit joins the family. */
  botId: string | null;
  groupId: string | null;
  name: string;
  mimeType: string;
};

/**
 * The document a studio note names, when the person sending the note owns it. Only that family is
 * resolved, whichever agent or group made it; a note naming someone else's file finds nothing.
 */
export async function studioNotedDocument(
  prisma: Pick<PrismaClient, "artifact">,
  owner: Owner,
  note: { documentId: string; artifactId: string },
): Promise<StudioDocument | undefined> {
  const family = await newestFamilyVersion(prisma, owner, note.artifactId);
  if (!family || family.rootId !== note.documentId) return undefined;
  const { given, newest } = family;
  const rows = await prisma.artifact.findMany({
    where: { id: { in: [newest.id, given.id] }, spaceId: owner.spaceId, userId: owner.userId },
    select: { id: true, size: true, botId: true, groupId: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const scope = byId.get(newest.id);
  if (!scope) return undefined;
  const versions = (given.id === newest.id ? [newest] : [newest, given]).flatMap((version) => {
    const row = byId.get(version.id);
    return row ? [{ ...version, size: row.size }] : [];
  });
  return {
    rootId: family.rootId,
    versions,
    botId: scope.botId,
    groupId: scope.groupId,
    name: newest.name,
    mimeType: newest.mimeType,
  };
}

/**
 * Where an attached file is kept so it becomes the studio document's next version: under the
 * document's own name, agent and group. Undefined when the file is a different document: another
 * name, another file type, or no name and no edit of the studio document in this run.
 */
export function studioAttachTarget(
  document: StudioDocument | undefined,
  file: { name?: string; mimeType: string; studioEdited?: boolean },
): { botId: string; groupId: string | undefined; name: string } | undefined {
  if (!document?.botId || file.mimeType !== document.mimeType) return undefined;
  const named = file.name?.trim();
  if (named ? !namesStudioDocument(document, named) : !file.studioEdited) return undefined;
  return { botId: document.botId, groupId: document.groupId ?? undefined, name: document.name };
}

/** The studio document's versions as conversation files, so fetch_file reaches them by path. */
export function studioDocumentFiles(document: StudioDocument | undefined) {
  return (document?.versions ?? []).map((version) => ({
    artifactId: version.id,
    name: version.name,
    mimeType: version.mimeType,
    size: version.size,
    path: attachmentPathFor(version),
  }));
}

/** `studioNotedDocument` for the studio note in a turn's text, if it has one. */
export async function studioDocumentForTurn(
  prisma: Pick<PrismaClient, "artifact">,
  owner: Owner,
  blocks: readonly MessageBlock[] | undefined,
): Promise<StudioDocument | undefined> {
  const text = (blocks ?? []).flatMap((block) => (block.kind === "text" ? [block.text] : []));
  const note = studioNoteDocument(text.join("\n"));
  return note ? studioNotedDocument(prisma, owner, note) : undefined;
}

const OFFICE_EXTENSION = /\.(docx|pptx|xlsx)$/i;

/** True when `name` is the studio document's name, with or without its file extension. */
export function namesStudioDocument(document: Pick<StudioDocument, "name">, name: string): boolean {
  const plain = (value: string) => value.trim().replace(OFFICE_EXTENSION, "").toLowerCase();
  return plain(name) !== "" && plain(name) === plain(document.name);
}

/**
 * The newest version of a file the person attached in this conversation, when `artifactId` is it:
 * a later version (one they saved in a studio, say) is the same file, so a run may fetch it.
 */
export async function newerConversationVersion(
  prisma: Pick<PrismaClient, "artifact">,
  owner: Owner,
  artifactId: string,
  conversationArtifactIds: readonly string[],
): Promise<FamilyVersion | undefined> {
  if (conversationArtifactIds.length === 0) return undefined;
  const family = await newestFamilyVersion(prisma, owner, artifactId);
  if (!family || family.newest.id !== artifactId) return undefined;
  const attached = await prisma.artifact.count({
    where: {
      id: { in: [...conversationArtifactIds] },
      spaceId: owner.spaceId,
      userId: owner.userId,
      OR: [{ id: family.rootId }, { rootArtifactId: family.rootId }],
    },
  });
  return attached > 0 ? family.newest : undefined;
}
