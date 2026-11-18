import { attachmentExtensionForMimeType } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { attachmentPathFor, newestFamilyVersion } from "./document-versions.js";

type Owner = { spaceId: string; userId: string };

const KINDS = {
  word: { label: "Word document", extensions: [".docx", ".doc"] },
  powerpoint: { label: "PowerPoint deck", extensions: [".pptx", ".ppt"] },
  excel: { label: "Excel workbook", extensions: [".xlsx", ".xls", ".csv"] },
  pdf: { label: "PDF", extensions: [".pdf"] },
} as const;

export type DocumentKind = keyof typeof KINDS;
export const DOCUMENT_KINDS = Object.keys(KINDS) as DocumentKind[];

function kindOf(mimeType: string): DocumentKind | undefined {
  const extension = attachmentExtensionForMimeType(mimeType).toLowerCase();
  return DOCUMENT_KINDS.find((kind) =>
    (KINDS[kind].extensions as readonly string[]).includes(extension),
  );
}

export type FoundDocument = {
  documentId: string;
  name: string;
  type: string;
  version: number;
  lastSaved: string;
  savedBy: "studio" | "assistant" | "upload";
  /** Where ocsc and attach_file reach its newest version. */
  path: string;
};

const SCAN_LIMIT = 300;
const RESULT_LIMIT = 8;

/** The words a name must all contain: letters and digits, split on everything else. */
export function documentQueryWords(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length > 1),
    ),
  ];
}

function nameMatches(name: string, words: readonly string[]): boolean {
  const plain = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
  return words.every((word) => plain.includes(word));
}

/**
 * The person's own Word, PowerPoint, Excel and PDF documents whose names contain every word of
 * `query`, one entry per document at its newest version, most recently saved first. Only their
 * own files are ever read; `groupId` keeps a shared chat to documents of that same chat group.
 */
export async function findMyDocuments(
  prisma: Pick<PrismaClient, "artifact">,
  owner: Owner,
  options: { query: string; kind?: DocumentKind; groupId?: string | null },
): Promise<FoundDocument[]> {
  const words = documentQueryWords(options.query);
  const rows = await prisma.artifact.findMany({
    where: {
      spaceId: owner.spaceId,
      userId: owner.userId,
      ...(options.groupId ? { groupId: options.groupId } : {}),
      ...(words.length
        ? { AND: words.map((word) => ({ name: { contains: word, mode: "insensitive" as const } })) }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: SCAN_LIMIT,
    select: { id: true, name: true, mimeType: true, rootArtifactId: true },
  });
  const roots: string[] = [];
  for (const row of rows) {
    const kind = kindOf(row.mimeType);
    if (!kind || (options.kind && kind !== options.kind)) continue;
    if (words.length && !nameMatches(row.name, words)) continue;
    const rootId = row.rootArtifactId ?? row.id;
    if (!roots.includes(rootId)) roots.push(rootId);
    if (roots.length >= RESULT_LIMIT) break;
  }
  const found: FoundDocument[] = [];
  for (const rootId of roots) {
    const family = await newestFamilyVersion(prisma, owner, rootId);
    if (!family) continue;
    const { newest } = family;
    const saved = await prisma.artifact.findFirst({
      where: { id: newest.id, spaceId: owner.spaceId, userId: owner.userId },
      select: { createdAt: true },
    });
    const kind = kindOf(newest.mimeType);
    found.push({
      documentId: rootId,
      name: newest.name,
      type: kind ? KINDS[kind].label : newest.mimeType,
      version: newest.version,
      lastSaved: (saved?.createdAt ?? new Date(0)).toISOString(),
      savedBy:
        newest.source === "studio"
          ? "studio"
          : newest.source === "assistant"
            ? "assistant"
            : "upload",
      path: attachmentPathFor(newest),
    });
  }
  return found.sort((a, b) => b.lastSaved.localeCompare(a.lastSaved));
}

/** What the agent does next with what was found. */
export function foundDocumentsNext(found: readonly FoundDocument[], query: string): string {
  if (!found.length) {
    return `None of the person's documents has a name containing every word of "${query}". Try fewer or other words, or ask them for the document's name. Never make a new document in its place.`;
  }
  if (found.length === 1) {
    return "Use this path with ocsc (read, then edit) and attach the result with attach_file under its exact name, so it becomes the next version of that same document.";
  }
  return "More than one document matches. Unless the person's words clearly pick one (its type or name), ask them which they mean, listing each name, type and when it was last saved, before reading or editing any. Then use its path with ocsc and attach the result under its exact name.";
}
