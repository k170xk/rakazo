import { ORPCError } from "@orpc/server";
import {
  createDocument,
  DocumentError,
  documentFamily,
  documentRevisionWithDraft,
  listDocuments,
  versionSource,
} from "../documents.js";
import type { RouterContext } from "./context.js";

async function refusing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DocumentError) {
      throw new ORPCError(error.code, {
        status: error.status,
        message: error.message,
        data: error.data,
      });
    }
    throw error;
  }
}

export function documentsRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  return {
    documents: {
      get: authed.documents.get.handler(({ context, input }) =>
        refusing(async () => {
          const family = await documentFamily(deps.prisma, context.actor, input.rootArtifactId);
          const { latest } = family;
          const downloadToken = await deps.auth.issueArtifactDownloadToken({
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            artifactId: latest.id,
          });
          return {
            rootArtifactId: family.rootArtifactId,
            name: latest.name,
            format: family.format,
            mimeType: latest.mimeType,
            versions: family.versions.map((row) => ({
              artifactId: row.id,
              version: row.version,
              size: row.size,
              createdAt: row.createdAt.toISOString(),
              source: versionSource(row.source),
            })),
            latest: { artifactId: latest.id, version: latest.version, downloadToken },
          };
        }),
      ),
      revision: authed.documents.revision.handler(({ context, input }) =>
        documentRevisionWithDraft(deps, context.actor, input),
      ),
      list: authed.documents.list.handler(async ({ context, input }) => ({
        items: await listDocuments(deps.prisma, context.actor, input),
      })),
      create: authed.documents.create.handler(({ context, input }) =>
        refusing(() =>
          createDocument(
            { ...deps, maxUploadSizeBytes: deps.env.maxUploadSizeBytes },
            context.actor,
            input,
            context.signal ?? new AbortController().signal,
          ),
        ),
      ),
    },
  };
}
