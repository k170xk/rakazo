import { useLingui } from "@lingui/react/macro";
import type { DocumentFormat } from "@rakazo/contracts";
import { attachmentSizeLabel } from "@rakazo/contracts";
import { toast } from "@rakazo/ui-web";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { selectedSpaceId } from "../../lib/rpc";
import { useBoundSpaceId } from "../../lib/space-rpc";
import { useDocumentBotId } from "./document-bot";
import { OFFICE_STUDIOS } from "./registry";
import { fileMatchesFormat, uploadNewDocument } from "./upload-document";

/**
 * A hidden file picker for one format. `choose()` opens it; the picked file becomes a new
 * document, which `onCreated` opens. Refusals are told with a toast.
 */
export function useDocumentUpload(
  format: DocumentFormat,
  onCreated: (rootArtifactId: string) => void,
  /** Runs before the upload starts, e.g. to save the open document first. */
  before?: () => Promise<unknown>,
): { choose: () => void; busy: boolean; input: ReactNode } {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const spaceId = useBoundSpaceId() ?? selectedSpaceId();
  const documentBot = useDocumentBotId();
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const extension = OFFICE_STUDIOS[format].extension;

  async function upload(file: File) {
    if (!fileMatchesFormat(file, format)) {
      toast.error(t`Choose a ${extension} file.`);
      return;
    }
    setBusy(true);
    try {
      await before?.();
      const result = await uploadNewDocument({
        format,
        file,
        name: file.name,
        spaceId,
        ...documentBot,
      });
      if (result.kind === "created") {
        await queryClient.invalidateQueries({ queryKey: queries.documents.list.key() });
        onCreated(result.created.rootArtifactId);
        return;
      }
      const fileSize = `${(file.size / (1024 * 1024)).toFixed(1)} MiB`;
      const maxSize = result.maxBytes ? attachmentSizeLabel(result.maxBytes) : null;
      const status = result.status;
      toast.error(
        result.code === "STORAGE_FULL"
          ? t`There's no room for this file. Free up storage and try again.`
          : result.code === "PAYLOAD_TOO_LARGE"
            ? maxSize
              ? t`This file is ${fileSize}, over the ${maxSize} upload limit.`
              : t`This file (${fileSize}) is over the upload limit.`
            : result.code === "UNSUPPORTED_MEDIA_TYPE"
              ? t`This file couldn't be read. Check it is a ${extension} file without macros.`
              : result.message
                ? t`Couldn't upload the file: ${result.message} (error ${status})`
                : t`Couldn't upload the file (error ${status}). Try again.`,
      );
    } catch {
      toast.error(t`Couldn't upload the file. Check your connection and try again.`);
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    choose: () => picker.current?.click(),
    input: (
      <input
        ref={picker}
        type="file"
        accept={OFFICE_STUDIOS[format].accept}
        hidden
        tabIndex={-1}
        aria-hidden="true"
        data-testid={`upload-${format}`}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void upload(file);
        }}
      />
    ),
  };
}
