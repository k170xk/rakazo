import { Trans, useLingui } from "@lingui/react/macro";
import type { DocumentFormat } from "@rakazo/contracts";
import { DOCUMENT_LIST_MAX_LIMIT } from "@rakazo/contracts";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  toast,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Upload } from "lucide-react";
import type { ReactNode } from "react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { errorCode } from "../../lib/user-error";
import { control, pill, StudioFrame, useStudioDock } from "../studio/StudioFrame";
import { useDocumentBotId } from "./document-bot";
import { OFFICE_STUDIOS } from "./registry";
import { StudioWelcome } from "./StudioWelcome";
import { useDocumentUpload } from "./use-document-upload";
import { lastOffice, orderedOffices, rememberOffice } from "./word/offices";

export type OfficeStudioHostProps = {
  /** The family to open; null opens the newest document of `format`, or the empty state. */
  id: string | null;
  /** From the link; read from the file when absent. */
  format: DocumentFormat | null;
  onClose: () => void;
  /** Opens another document, replacing the open one in the URL. */
  onOpen: (id: string, format: DocumentFormat) => void;
};

/** Routes `?doc=` to the studio for the file's format, its newest file, or an empty studio. */
export default function OfficeStudioHost({ id, format, onClose, onOpen }: OfficeStudioHostProps) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const detail = useQuery({
    ...queries.documents.get.queryOptions({ input: { rootArtifactId: id ?? "" } }),
    enabled: id !== null && format === null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const shownFormat = format ?? detail.data?.format ?? (id === null ? "docx" : null);
  const newest = useQuery({
    ...queries.documents.list.queryOptions({
      input: { format: shownFormat ?? "docx", limit: DOCUMENT_LIST_MAX_LIMIT },
    }),
    enabled: id === null && shownFormat !== null,
  });
  const newestId = id === null ? newest.data?.items[0]?.rootArtifactId : undefined;
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  useEffect(() => {
    if (newestId && shownFormat) openRef.current(newestId, shownFormat);
  }, [newestId, shownFormat]);

  if (id !== null && format === null && detail.isError) {
    const code = errorCode(detail.error);
    return (
      <MessageFrame
        title={t`Document`}
        onClose={onClose}
        message={
          code === "UNSUPPORTED_MEDIA_TYPE"
            ? t`Only Word, PowerPoint and Excel files open here.`
            : code === "NOT_FOUND" || code === "FORBIDDEN"
              ? t`This document isn't available. It may have been deleted, or it belongs to someone else.`
              : t`This document couldn't be opened. Check your connection and try again.`
        }
      />
    );
  }
  if (!shownFormat) return <LoadingFrame onClose={onClose} />;
  const studio = OFFICE_STUDIOS[shownFormat];
  const Studio = studio.Studio;
  if (!Studio) {
    return (
      <MessageFrame
        title={studio.label()}
        onClose={onClose}
        message={t`This studio is coming soon. Download the file from the chat to open it.`}
      />
    );
  }
  if (id === null) {
    if (newest.isPending || newestId) return <LoadingFrame onClose={onClose} />;
    return (
      <EmptyStudio
        format={shownFormat}
        onClose={onClose}
        onOpen={(next) => onOpen(next, shownFormat)}
      />
    );
  }
  return (
    <Suspense fallback={<LoadingFrame onClose={onClose} />}>
      <Studio
        rootArtifactId={id}
        onClose={onClose}
        onOpenDocument={(next) => onOpen(next, shownFormat)}
      />
      <StudioWelcome format={shownFormat} documentId={id} />
    </Suspense>
  );
}

function LoadingFrame({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const dock = useStudioDock();
  return (
    <StudioFrame testId="office-studio-loading" title={t`Loading`} onClose={onClose} dock={dock}>
      <div className="grid size-full place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t`Loading`} />
      </div>
    </StudioFrame>
  );
}

function MessageFrame({
  title,
  message,
  onClose,
}: {
  title: string;
  message: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const dock = useStudioDock();
  return (
    <StudioFrame
      testId="office-studio-message"
      title={title}
      onClose={onClose}
      closeLabel={t`Close document`}
      dock={dock}
    >
      <div className="grid size-full place-items-center p-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <p className="text-[14px] text-muted-foreground">{message}</p>
          <Button variant="outline" size="sm" onClick={onClose}>
            <Trans>Close</Trans>
          </Button>
        </div>
      </div>
    </StudioFrame>
  );
}

/** A studio with no documents of its type yet: make a blank one or upload one. */
function EmptyStudio({
  format,
  onClose,
  onOpen,
}: {
  format: DocumentFormat;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const documentBot = useDocumentBotId();
  const dock = useStudioDock();
  const studio = OFFICE_STUDIOS[format];
  const [creating, setCreating] = useState(false);
  const uploader = useDocumentUpload(format, onOpen);
  const busy = creating || uploader.busy;
  const offices = orderedOffices(lastOffice());
  const label = studio.label();
  const extension = studio.extension;

  async function create(office?: string) {
    if (office) rememberOffice(office);
    setCreating(true);
    try {
      const created = await queries.documents.create.call({
        format,
        title:
          format === "docx"
            ? t`Untitled document`
            : format === "pptx"
              ? t`Untitled presentation`
              : t`Untitled spreadsheet`,
        ...(office ? { office } : {}),
        ...documentBot,
      });
      await queryClient.invalidateQueries({ queryKey: queries.documents.list.key() });
      onOpen(created.rootArtifactId);
    } catch (error) {
      const code = errorCode(error);
      toast.error(
        code === "PRECONDITION_FAILED"
          ? t`New documents can't be made here yet.`
          : code === "STORAGE_FULL"
            ? t`There's no room for a new document. Free up storage and try again.`
            : t`Couldn't make a new document.`,
      );
    } finally {
      setCreating(false);
    }
  }

  const newMenu = (trigger: ReactNode) =>
    format === "docx" ? (
      <DropdownMenu>
        {trigger}
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <Trans>New document for which office?</Trans>
            </DropdownMenuLabel>
            {offices.map((office) => (
              <DropdownMenuItem key={office} onClick={() => void create(office)}>
                {office}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      trigger
    );

  const headerNew =
    format === "docx" ? (
      <DropdownMenuTrigger
        data-testid="office-new"
        disabled={busy}
        aria-label={t`New blank document`}
        title={t`New blank document`}
        className={`${control} size-[35px] disabled:opacity-40`}
      >
        <Plus className="size-[18px]" strokeWidth={1.7} />
      </DropdownMenuTrigger>
    ) : (
      <button
        type="button"
        data-testid="office-new"
        disabled={busy}
        aria-label={t`New blank document`}
        title={t`New blank document`}
        onClick={() => void create()}
        className={`${control} size-[35px] disabled:opacity-40`}
      >
        <Plus className="size-[18px]" strokeWidth={1.7} />
      </button>
    );

  const bodyNew =
    format === "docx" ? (
      <DropdownMenuTrigger
        disabled={busy}
        render={<Button size="sm" />}
        data-testid="office-empty-new"
      >
        <Plus className="size-4" />
        <Trans>New blank document</Trans>
      </DropdownMenuTrigger>
    ) : (
      <Button
        size="sm"
        disabled={busy}
        onClick={() => void create()}
        data-testid="office-empty-new"
      >
        <Plus className="size-4" />
        <Trans>New blank document</Trans>
      </Button>
    );

  return (
    <StudioFrame
      testId="office-studio-empty"
      title={label}
      onClose={onClose}
      closeLabel={t`Close document`}
      dock={dock}
      start={
        <>
          {newMenu(headerNew)}
          <span className="flex min-w-0 items-center gap-1.5 px-2 text-[14px] font-medium">
            <img src={studio.icon} alt="" className="size-5 shrink-0 object-contain" />
            <span className="truncate">{label}</span>
          </span>
        </>
      }
      actions={
        <button
          type="button"
          disabled={busy}
          onClick={uploader.choose}
          className={`${pill} disabled:opacity-40`}
        >
          <Upload className="size-4" strokeWidth={1.8} />
          <span className="max-sm:sr-only">
            <Trans>Upload</Trans>
          </span>
        </button>
      }
    >
      {uploader.input}
      <div className="grid size-full place-items-center p-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <img src={studio.icon} alt="" className="size-20 object-contain" />
          <h2 className="text-[16px] font-medium">
            {format === "docx" ? (
              <Trans>No Word documents yet</Trans>
            ) : format === "pptx" ? (
              <Trans>No presentations yet</Trans>
            ) : (
              <Trans>No spreadsheets yet</Trans>
            )}
          </h2>
          <p className="text-[14px] text-muted-foreground">
            <Trans>
              Start a blank one, upload a {extension} file from your computer, or ask the assistant
              to make one.
            </Trans>
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {busy ? (
              <Loader2
                className="size-5 animate-spin text-muted-foreground"
                aria-label={t`Loading`}
              />
            ) : (
              <>
                {newMenu(bodyNew)}
                <Button size="sm" variant="outline" onClick={uploader.choose}>
                  <Upload className="size-4" />
                  {format === "docx" ? (
                    <Trans>Upload a .docx file</Trans>
                  ) : format === "pptx" ? (
                    <Trans>Upload a .pptx file</Trans>
                  ) : (
                    <Trans>Upload a .xlsx file</Trans>
                  )}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </StudioFrame>
  );
}
