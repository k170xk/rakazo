import * as z from "zod";
import { ARTIFACT_NAME_MAX_LENGTH } from "./attachments.js";
import { Id } from "./ids.js";

/** The Office files a studio opens: Word, PowerPoint and Excel. */
export const DocumentFormatSchema = z.enum(["docx", "pptx", "xlsx"]);
export type DocumentFormat = z.infer<typeof DocumentFormatSchema>;

export const DOCUMENT_MIME_TYPES: Readonly<Record<DocumentFormat, string>> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function documentFormatForMimeType(mimeType: string): DocumentFormat | null {
  for (const format of DocumentFormatSchema.options) {
    if (DOCUMENT_MIME_TYPES[format] === mimeType) return format;
  }
  return null;
}

/** Who made a version. Null on versions saved before this was recorded, and on uploads. */
export const DocumentVersionSourceSchema = z.enum(["assistant", "studio"]).nullable();
export type DocumentVersionSource = z.infer<typeof DocumentVersionSourceSchema>;

export const DOCUMENT_VERSIONS_MAX = 200;

/** `POST` the file's bytes here, with `?baseVersion=&format=`, to save it as the next version. */
export function documentVersionsPath(rootArtifactId: string): string {
  return `/api/v1/documents/${encodeURIComponent(rootArtifactId)}/versions`;
}

/**
 * `POST` a file here, with `?format=&name=[&botId=]` and the format's MIME type as Content-Type,
 * to start a new document from it. Answers 201 with `DocumentCreated`.
 */
export const DOCUMENTS_UPLOAD_PATH = "/api/v1/documents";

export const DocumentVersionSchema = z.object({
  artifactId: Id,
  version: z.number().int().positive(),
  size: z.number().int(),
  createdAt: z.string(),
  source: DocumentVersionSourceSchema,
});
export type DocumentVersion = z.infer<typeof DocumentVersionSchema>;

export const DocumentDetailSchema = z.object({
  rootArtifactId: Id,
  name: z.string(),
  format: DocumentFormatSchema,
  mimeType: z.string(),
  /** Newest first, at most DOCUMENT_VERSIONS_MAX. */
  versions: z.array(DocumentVersionSchema),
  latest: z.object({
    artifactId: Id,
    version: z.number().int().positive(),
    /** One-time token for `GET /api/artifacts/download?token=`. */
    downloadToken: z.string(),
  }),
});
export type DocumentDetail = z.infer<typeof DocumentDetailSchema>;

export const DocumentSummarySchema = z.object({
  rootArtifactId: Id,
  /** The newest version. */
  artifactId: Id,
  name: z.string(),
  format: DocumentFormatSchema,
  version: z.number().int().positive(),
  size: z.number().int(),
  updatedAt: z.string(),
  source: DocumentVersionSourceSchema,
});
export type DocumentSummary = z.infer<typeof DocumentSummarySchema>;

export const DocumentSavedSchema = z.object({
  artifactId: Id,
  version: z.number().int().positive(),
});
export type DocumentSaved = z.infer<typeof DocumentSavedSchema>;

export const DocumentRefInput = z.strictObject({
  /** The family's root id; any version's id in the family is accepted too. */
  rootArtifactId: Id,
});

export const DocumentRevisionInput = DocumentRefInput.extend({
  /** The `draft.updatedAt` the studio already loaded; that draft then comes back without a token. */
  draftSeen: z.string().max(40).optional(),
});

/**
 * The assistant's latest unsent write to the family during a run, newer than any version.
 * Not a version or a chat file; it is gone once a newer version than `baseVersion` exists.
 */
export const DocumentDraftSchema = z.object({
  updatedAt: z.string(),
  /** The version the assistant's edit started from. */
  baseVersion: z.number().int().positive(),
  /** One-time token for `GET /api/artifacts/download?token=`; absent when `draftSeen` matched. */
  downloadToken: z.string().optional(),
});
export type DocumentDraft = z.infer<typeof DocumentDraftSchema>;

export const DocumentRevisionSchema = DocumentSavedSchema.extend({
  draft: DocumentDraftSchema.optional(),
});
export type DocumentRevision = z.infer<typeof DocumentRevisionSchema>;

export const DOCUMENT_LIST_MAX_LIMIT = 50;

export const DocumentListInput = z.strictObject({
  format: DocumentFormatSchema.optional(),
  limit: z.number().int().min(1).max(DOCUMENT_LIST_MAX_LIMIT).optional(),
});

export const DocumentCreateInput = z.strictObject({
  format: DocumentFormatSchema,
  title: z
    .string()
    .transform((title) => title.replace(/[\p{Cc}\u2028\u2029\s]+/gu, " ").trim())
    .pipe(
      z
        .string()
        .min(1)
        .max(ARTIFACT_NAME_MAX_LENGTH - 10),
    ),
  /** The agent whose files it joins; the person's first agent here when absent. */
  botId: Id.optional(),
  /** The OCSC office a Word report's back cover names. */
  office: z.string().trim().min(1).max(100).optional(),
});

export const DocumentCreatedSchema = DocumentSavedSchema.extend({ rootArtifactId: Id });
export type DocumentCreated = z.infer<typeof DocumentCreatedSchema>;
