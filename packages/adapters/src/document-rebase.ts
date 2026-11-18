import type { AdapterContext, ArtifactStore, ComputerRef } from "@rakazo/adapter-kit";
import { ATTACHMENT_MAX_BYTES } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import type { FamilyVersion } from "./document-versions.js";
import { attachmentPathFor, newestFamilyVersion } from "./document-versions.js";
import { editedAttachmentId, ocscInPath, printedJson } from "./ocsc-tool.js";
import type { WorkspaceFiles } from "./tool-runner.js";

type Owner = { spaceId: string; userId: string };

/** One ocsc command that changed a document. */
export type DocumentEditStep = { program: string; args: readonly string[] };

/**
 * How a file this run wrote came from a saved document version: the version it started from and
 * every command since, so the same edits can be made again on a version saved later.
 */
export type DocumentLineage = {
  rootId: string;
  baseId: string;
  baseVersion: number;
  name: string;
  mimeType: string;
  /** The first step's --in is the base version's attachment path. */
  steps: readonly DocumentEditStep[];
};

/** Where ocsc reads and writes files for this run. */
export type DocumentFolder = {
  files: WorkspaceFiles;
  ref: () => Promise<ComputerRef>;
  /** The stored path of a path as the command sees it. */
  stored: (filePath: string) => string;
  context: AdapterContext;
};

export function normalizeDocumentPath(filePath: string): string {
  return filePath.trim().replace(/^\.\//, "");
}

/** The same arguments with --in pointing at `filePath`. */
export function withInPath(args: readonly string[], filePath: string): string[] {
  const next = [...args];
  const at = next.indexOf("--in");
  if (at >= 0 && at + 1 < next.length) next[at + 1] = filePath;
  return next;
}

/** The file an ocsc edit wrote: its --out, else the path it printed. */
export function ocscOutPath(args: readonly string[], result: unknown): string | undefined {
  const printed = printedJson(result);
  if (printed?.ok !== true) return undefined;
  const at = args.indexOf("--out");
  const given = at >= 0 ? args[at + 1] : undefined;
  const written = given ?? (typeof printed.path === "string" ? printed.path : undefined);
  return written ? normalizeDocumentPath(written) : undefined;
}

export async function folderHasFile(folder: DocumentFolder, filePath: string): Promise<boolean> {
  const stored = folder.stored(filePath);
  const segments = stored.split("/").filter(Boolean);
  const name = segments.pop();
  const entries = await folder.files
    .listFiles(await folder.ref(), segments.join("/"), folder.context)
    .catch(() => []);
  return entries.some((entry) => entry.path.split("/").filter(Boolean).at(-1) === name);
}

/** Puts a saved version in the folder at its attachment path, unless it is already there. */
export async function placeVersion(
  deps: { prisma: Pick<PrismaClient, "artifact">; artifacts: Pick<ArtifactStore, "get"> },
  folder: DocumentFolder,
  owner: Owner,
  version: Pick<FamilyVersion, "id" | "mimeType">,
  maxBytes = ATTACHMENT_MAX_BYTES,
): Promise<string> {
  const filePath = attachmentPathFor(version);
  if (await folderHasFile(folder, filePath)) return filePath;
  const row = await deps.prisma.artifact.findFirst({
    where: { id: version.id, spaceId: owner.spaceId, userId: owner.userId },
    select: { storageKey: true, size: true },
  });
  if (!row) throw new Error("that version is no longer available");
  if (row.size > maxBytes) throw new Error("that version is larger than the attachment limit");
  const content = await deps.artifacts.get(row.storageKey, folder.context);
  await folder.files.writeFile(
    await folder.ref(),
    { path: folder.stored(filePath), content },
    folder.context,
  );
  return filePath;
}

/** Who saved a newer version, in words for the agent. */
function savedBy(newest: Pick<FamilyVersion, "source">): string {
  return newest.source === "studio" ? "the person saved it in the studio" : "another chat saved it";
}

export function rebasedEditNote(
  given: Pick<FamilyVersion, "version">,
  newest: Pick<FamilyVersion, "version" | "name" | "source">,
  filePath: string,
): string {
  return `Version ${given.version} is not the newest: version ${newest.version} exists (${savedBy(newest)}), so this edit ran on version ${newest.version} at ${filePath} and keeps those changes. Carry on from this result and attach it as "${newest.name}". Do not ask the person to reopen anything.`;
}

export function rebasedAttachNote(
  newest: Pick<FamilyVersion, "version" | "source">,
  steps: number,
): string {
  return `Version ${newest.version} was saved while you worked (${savedBy(newest)}), so your ${steps === 1 ? "edit was" : `${steps} edits were`} made again on top of it and both sets of changes are kept.`;
}

export type EditBase =
  | { kind: "none" }
  | { kind: "refuse"; error: string }
  | {
      kind: "base";
      args: string[];
      lineage: DocumentLineage;
      /** Set when the command now starts from a newer version than the one it named. */
      note?: string;
    };

/**
 * Which saved version an ocsc edit of `attachments/<id>` starts from: the newest version of that
 * document, placed in the folder so the command finds it. `reachable` says whether this run may
 * use the document at all; when it may not, nothing changes.
 */
export async function resolveEditBase(
  deps: { prisma: Pick<PrismaClient, "artifact">; artifacts?: Pick<ArtifactStore, "get"> },
  input: {
    owner: Owner;
    program: string;
    args: readonly string[];
    folder: DocumentFolder;
    reachable: (family: { rootId: string; given: FamilyVersion }) => Promise<boolean>;
    maxBytes?: number;
  },
): Promise<EditBase> {
  const artifactId = editedAttachmentId(input.program, input.args);
  if (!artifactId || !deps.artifacts) return { kind: "none" };
  const family = await newestFamilyVersion(deps.prisma, input.owner, artifactId);
  if (!family) return { kind: "none" };
  const { given, newest, rootId } = family;
  if (!(await input.reachable({ rootId, given }))) return { kind: "none" };
  const target = newest.version > given.version ? newest : given;
  let filePath: string;
  try {
    filePath = await placeVersion(
      { prisma: deps.prisma, artifacts: deps.artifacts },
      input.folder,
      input.owner,
      target,
      input.maxBytes,
    );
  } catch (error) {
    if (target === given) return { kind: "none" };
    return {
      kind: "refuse",
      error: `Version ${newest.version} of "${newest.name}" is the newest, but it could not be put in place (${error instanceof Error ? error.message : "unknown error"}). Call fetch_file with ${attachmentPathFor(newest)}, then run this command again with --in ${attachmentPathFor(newest)}.`,
    };
  }
  const args = target === given ? [...input.args] : withInPath(input.args, filePath);
  return {
    kind: "base",
    args,
    lineage: {
      rootId,
      baseId: target.id,
      baseVersion: target.version,
      name: newest.name,
      mimeType: newest.mimeType,
      steps: [],
    },
    ...(target === given ? {} : { note: rebasedEditNote(given, newest, filePath) }),
  };
}

/** The lineage of an edit whose --in is a file this run already wrote from a saved version. */
export function continuedLineage(
  lineages: ReadonlyMap<string, DocumentLineage> | undefined,
  args: readonly string[],
): DocumentLineage | undefined {
  const input = ocscInPath(args);
  return input ? lineages?.get(normalizeDocumentPath(input)) : undefined;
}

/** The steps to make again on `newestPath`: the first one now starts from that version. */
export function replaySteps(lineage: DocumentLineage, newestPath: string): DocumentEditStep[] {
  return lineage.steps.map((step, index) =>
    index === 0 ? { program: step.program, args: withInPath(step.args, newestPath) } : step,
  );
}
