import type { DocumentCreated, DocumentFormat } from "@rakazo/contracts";
import { DOCUMENT_MIME_TYPES, DOCUMENTS_UPLOAD_PATH } from "@rakazo/contracts";
import { withSpaceHeaders } from "../../lib/rpc";

export type UploadDocumentResult =
  | { kind: "created"; created: DocumentCreated }
  /** `code` is the server's stable refusal code, e.g. STORAGE_FULL or UNSUPPORTED_MEDIA_TYPE. */
  | {
      kind: "refused";
      code: string;
      status: number;
      /** The server's own wording, when it sent one. */
      message?: string;
      /** The per-file limit, sent with PAYLOAD_TOO_LARGE. */
      maxBytes?: number;
    };

const CODE_FOR_STATUS: Record<number, string> = {
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  507: "STORAGE_FULL",
};

/** True when `file` is named like a `format` file; the server still checks what is inside. */
export function fileMatchesFormat(file: Pick<File, "name">, format: DocumentFormat): boolean {
  return file.name.toLowerCase().endsWith(`.${format}`);
}

/** Starts a new document from a file on the person's computer. Throws only when offline. */
export async function uploadNewDocument(input: {
  format: DocumentFormat;
  file: Blob;
  name: string;
  spaceId: string | null;
  botId?: string;
}): Promise<UploadDocumentResult> {
  const mimeType = DOCUMENT_MIME_TYPES[input.format];
  const query = new URLSearchParams({ format: input.format, name: input.name });
  if (input.botId) query.set("botId", input.botId);
  const response = await fetch(`${DOCUMENTS_UPLOAD_PATH}?${query}`, {
    method: "POST",
    credentials: "include",
    headers: withSpaceHeaders({ "content-type": mimeType }, input.spaceId),
    body: new Blob([input.file], { type: mimeType }),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (response.ok && body && typeof body.rootArtifactId === "string") {
    return { kind: "created", created: body as unknown as DocumentCreated };
  }
  return {
    kind: "refused",
    code:
      typeof body?.code === "string" ? body.code : (CODE_FOR_STATUS[response.status] ?? "UNKNOWN"),
    status: response.status,
    ...(typeof body?.error === "string" ? { message: body.error } : {}),
    ...(typeof body?.maxBytes === "number" ? { maxBytes: body.maxBytes } : {}),
  };
}
