import { resolveNextArtifactVersion } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { normalizeDocumentPath } from "./document-rebase.js";
import { attachmentPathFor, newestFamilyVersion } from "./document-versions.js";
import type { RunContext } from "./run-context.js";

type DocumentState = RunContext["state"]["documents"];

/** Remembers that this run read (or saved) a version of a document family. */
export function noteDocumentRead(state: DocumentState, rootId: string, version: number) {
  const read = state.read ?? new Map<string, number>();
  read.set(rootId, Math.max(version, read.get(rootId) ?? 0));
  state.read = read;
}

/** The newest version of the family this run is known to have worked from, if any. */
export function documentBaseVersion(
  state: DocumentState,
  studio: { rootId: string; versions: readonly { version: number }[] } | undefined,
  rootId: string,
): number | undefined {
  const known = [
    state.read?.get(rootId),
    studio?.rootId === rootId ? studio.versions[0]?.version : undefined,
    ...[...(state.lineage?.values() ?? [])]
      .filter((lineage) => lineage.rootId === rootId)
      .map((lineage) => lineage.baseVersion),
  ].filter((version): version is number => typeof version === "number");
  return known.length ? Math.max(...known) : undefined;
}

/**
 * Why a file must not be saved as a document's next version: someone saved a newer version (in a
 * studio, another chat or another agent) after this run read the one it changed, and the change
 * was not made with ocsc edits that are replayed onto the newest version. Saving it would quietly
 * undo their work. Undefined when the save is safe or the run's starting version is unknown.
 */
export async function staleSaveRefusal(
  ctx: RunContext,
  filePath: string,
  target: { botId: string; groupId: string | undefined; name: string; rootId?: string },
): Promise<string | undefined> {
  const lineage = ctx.state.documents.lineage?.get(normalizeDocumentPath(filePath));
  if (lineage?.steps.length) return undefined;
  try {
    const rootId =
      target.rootId ??
      (
        await resolveNextArtifactVersion(ctx.deps.prisma, {
          spaceId: ctx.run.spaceId,
          userId: ctx.run.userId,
          botId: target.botId,
          groupId: target.groupId,
          name: target.name,
        })
      ).rootArtifactId ??
      undefined;
    if (!rootId) return undefined;
    const base = documentBaseVersion(ctx.state.documents, ctx.computer.studioDocument, rootId);
    if (base === undefined) return undefined;
    const family = await newestFamilyVersion(ctx.deps.prisma, ctx.context, rootId);
    if (!family || family.newest.version <= base) return undefined;
    return `Not saved: "${target.name}" has a newer version (version ${family.newest.version}) that someone saved in a studio, another chat or another agent after you read version ${base}, so saving yours would undo their changes. Run fetch_file with ${attachmentPathFor(family.newest)}, make your change on that file (prefer ocsc edit, which carries changes onto newer versions), then attach the result. Tell the person only if they asked for something that now conflicts with the newer version.`;
  } catch (error) {
    getLogger().warn("document save base not checked", { error: String(error) });
    return undefined;
  }
}
