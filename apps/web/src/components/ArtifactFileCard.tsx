import { i18n } from "@lingui/core";
import { t as translate } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { ChatMarkdown } from "@rakazo/chat-ui/web";
import { artifactPreviewKind, isAttachmentAudioMimeType } from "@rakazo/contracts";
import { artifactTypeLabel, attachmentExtensionForMimeType, fileSizeParts } from "@rakazo/core";
import { Button, Dialog, DialogClose, DialogContent, DialogTitle, Spinner } from "@rakazo/ui-web";
import type { LucideIcon } from "lucide-react";
import {
  Code2,
  Download,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Play,
  Presentation,
  X,
} from "lucide-react";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ArtifactTarget } from "../lib/artifact-open";
import { downloadArtifact, downloadArtifactBytes, fetchArtifactBytes } from "../lib/artifact-open";
import { errorText } from "../lib/user-error";
import { BuiCard } from "./ai/primitives";
import { IconTooltip } from "./IconTooltip";
import { PdfViewer } from "./PdfViewer";
import { SandboxedHtmlViewer } from "./SandboxedHtmlViewer";

type ArtifactFileCardProps = {
  target: ArtifactTarget;
  artifactId: string;
  name: string;
  mimeType: string;
  size: number;
};

function isTextPreview(mimeType: string) {
  const kind = artifactPreviewKind(mimeType);
  return kind === "markdown" || kind === "html" || kind === "text";
}

function isPreviewable(mimeType: string) {
  return (
    isTextPreview(mimeType) ||
    artifactPreviewKind(mimeType) === "pdf" ||
    artifactPreviewKind(mimeType) === "video"
  );
}

export function ArtifactFileCard(props: ArtifactFileCardProps) {
  const { t } = useLingui();
  const previewable = isPreviewable(props.mimeType);
  const previewButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function startDownload() {
    setDownloadError(null);
    try {
      await downloadArtifact(props.target, props.artifactId, props.name, props.mimeType);
    } catch {
      setDownloadError(t`Could not download ${props.name}. Try again.`);
    }
  }

  if (isAttachmentAudioMimeType(props.mimeType)) {
    return (
      <BuiCard className="min-w-[280px] p-4 text-foreground">
        <AudioArtifactPreview
          key={JSON.stringify([props.target, props.artifactId, props.mimeType])}
          {...props}
          onDownload={startDownload}
        />
        {downloadError ? <DownloadError message={downloadError} /> : null}
      </BuiCard>
    );
  }

  if (artifactPreviewKind(props.mimeType) === "video") {
    return (
      <div className="w-[min(560px,100%)]">
        <InlineVideo {...props} onDownload={startDownload} />
        {downloadError ? <DownloadError message={downloadError} /> : null}
      </div>
    );
  }

  const type = fileType(props.name, props.mimeType);
  const details = (
    <>
      <span
        className={`grid size-10 shrink-0 place-items-center rounded-[10px] ${type.tile}`}
        aria-hidden
      >
        <type.icon size={21} strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{props.name}</span>
        <span className="mt-0.5 flex gap-1.5 text-[13px] text-muted-foreground">
          <span>{type.label}</span>
          <span aria-hidden>·</span>
          <span data-testid="artifact-file-size">{formatSize(props.size)}</span>
        </span>
      </span>
    </>
  );

  return (
    <>
      <div>
        <BuiCard className="flex w-[min(420px,100%)] min-w-[280px] items-center gap-2 overflow-hidden border border-border py-2.5 ps-3 pe-2.5 text-left text-foreground dark:border-transparent">
          {previewable ? (
            <button
              ref={previewButton}
              type="button"
              aria-label={t`Preview ${props.name}`}
              onClick={() => setPreviewOpen(true)}
              className="-my-1 -ms-1 flex min-w-0 flex-1 items-center gap-3 rounded-[14px] p-1 text-left hover:bg-accent"
            >
              {details}
            </button>
          ) : (
            <span className="flex min-w-0 flex-1 items-center gap-3">{details}</span>
          )}
          <DownloadPill name={props.name} onDownload={startDownload} />
        </BuiCard>
        {downloadError ? <DownloadError message={downloadError} /> : null}
      </div>
      {previewable ? (
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent
            showCloseButton={false}
            initialFocus={closeButton}
            finalFocus={previewButton}
            className="flex h-[min(88vh,900px)] w-[min(960px,94vw)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
          >
            <FilePreview {...props} closeButtonRef={closeButton} />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

function DownloadPill({ name, onDownload }: { name: string; onDownload: () => Promise<void> }) {
  const { t } = useLingui();
  return (
    <button
      type="button"
      aria-label={t`Download ${name}`}
      onClick={() => void onDownload()}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-2.5 text-[13px] font-medium text-background hover:bg-foreground/85"
    >
      <Download aria-hidden className="size-3.5" strokeWidth={2} />
      {t`Download`}
    </button>
  );
}

const FILE_TYPES: Record<string, { icon: LucideIcon; label: () => string; tile: string }> = {
  docx: {
    icon: FileText,
    label: () => translate`Word document`,
    tile: "bg-link/10 text-link",
  },
  pptx: {
    icon: Presentation,
    label: () => translate`PowerPoint`,
    tile: "bg-warning/15 text-warning",
  },
  xlsx: {
    icon: FileSpreadsheet,
    label: () => translate`Spreadsheet`,
    tile: "bg-success/15 text-success",
  },
  pdf: {
    icon: FileText,
    label: () => translate`PDF`,
    tile: "bg-destructive/10 text-destructive",
  },
  html: { icon: Code2, label: () => translate`Web page`, tile: "bg-muted text-foreground" },
  zip: { icon: FileArchive, label: () => translate`ZIP archive`, tile: "bg-muted text-foreground" },
};

function fileType(name: string, mimeType: string) {
  const extension =
    attachmentExtensionForMimeType(mimeType).slice(1) ||
    (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");
  const key =
    extension === "doc"
      ? "docx"
      : extension === "ppt"
        ? "pptx"
        : extension === "xls" || extension === "csv"
          ? "xlsx"
          : extension === "htm" || mimeType === "text/html"
            ? "html"
            : mimeType === "application/pdf"
              ? "pdf"
              : extension;
  const known = FILE_TYPES[key];
  if (known) return { icon: known.icon, label: known.label(), tile: known.tile };
  return {
    icon: FileText,
    label: artifactTypeLabel(mimeType),
    tile: "bg-muted text-foreground",
  };
}

/** Small videos load as soon as they scroll into view; larger ones wait for Play. */
const INLINE_VIDEO_AUTOLOAD_BYTES = 40 * 1024 * 1024;

function InlineVideo({
  target,
  artifactId,
  name,
  size,
  onDownload,
}: ArtifactFileCardProps & { onDownload: () => Promise<void> }) {
  const { t } = useLingui();
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<
    { status: "idle" | "loading" | "error" } | { status: "ready"; src: string }
  >({ status: "idle" });
  const started = useRef(false);
  const src = state.status === "ready" ? state.src : undefined;
  useEffect(() => () => (src ? URL.revokeObjectURL(src) : undefined), [src]);

  const load = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    setState({ status: "loading" });
    try {
      const bytes = await fetchArtifactBytes(target, artifactId);
      setState({
        status: "ready",
        src: URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "video/mp4" })),
      });
    } catch {
      started.current = false;
      setState({ status: "error" });
    }
  }, [target, artifactId]);

  useEffect(() => {
    if (size > INLINE_VIDEO_AUTOLOAD_BYTES) return;
    const element = container.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      void load();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      },
      { rootMargin: "320px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [load, size]);

  return (
    <div
      ref={container}
      className="overflow-hidden rounded-[20px] border border-border bg-card text-foreground dark:border-transparent"
    >
      <div className="relative aspect-video w-full bg-black">
        {src ? (
          // biome-ignore lint/a11y/useMediaCaption: A bot's rendered video carries no caption track.
          <video
            src={src}
            controls
            playsInline
            preload="metadata"
            aria-label={name}
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <button
            type="button"
            aria-label={t`Play ${name}`}
            aria-busy={state.status === "loading"}
            disabled={state.status === "loading"}
            onClick={() => void load()}
            className="absolute inset-0 grid place-items-center text-white"
          >
            {state.status === "loading" ? (
              <Spinner aria-label={t`Loading video…`} />
            ) : (
              <span className="grid size-14 place-items-center rounded-full bg-white/15 backdrop-blur-sm transition-colors hover:bg-white/25">
                <Play aria-hidden className="ms-0.5 size-6 fill-current" />
              </span>
            )}
          </button>
        )}
      </div>
      <div className="flex items-center gap-3 py-2.5 ps-4 pe-2.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium">{name}</span>
          <span className="mt-0.5 block text-[13px] text-muted-foreground">
            {state.status === "error" ? t`The video could not be loaded.` : formatSize(size)}
          </span>
        </span>
        <DownloadPill name={name} onDownload={onDownload} />
      </div>
    </div>
  );
}

function FilePreview({
  target,
  artifactId,
  name,
  mimeType,
  closeButtonRef,
}: ArtifactFileCardProps & { closeButtonRef: RefObject<HTMLButtonElement | null> }) {
  const { t } = useLingui();
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; bytes: Uint8Array; text?: string }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const targetBotId = "botId" in target ? target.botId : undefined;
  const targetGroupId = "groupId" in target ? target.groupId : undefined;

  useEffect(() => {
    let cancelled = false;
    const artifactTarget: ArtifactTarget =
      targetBotId !== undefined ? { botId: targetBotId } : { groupId: targetGroupId! };
    void fetchArtifactBytes(artifactTarget, artifactId)
      .then((bytes) => {
        if (cancelled) return;
        if (!isTextPreview(mimeType)) {
          setState({ status: "ready", bytes });
          return;
        }
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          setState({ status: "ready", bytes, text });
        } catch {
          setState({ status: "error", message: t`This file is not valid UTF-8 text.` });
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: errorText(error, t`Could not load this file.`),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [artifactId, targetBotId, targetGroupId, mimeType, t]);
  const kind = artifactPreviewKind(mimeType);

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-5">
        <DialogTitle className="min-w-0 flex-1 truncate text-[14px] leading-5 font-medium text-foreground">
          {name}
        </DialogTitle>
        <IconTooltip label={t`Download ${name}`}>
          <Button
            variant="ghost"
            size="icon-lg"
            className="rounded-full text-muted-foreground"
            aria-label={t`Download ${name}`}
            onClick={() =>
              void (async () => {
                setDownloadError(null);
                try {
                  if (state.status === "ready") downloadArtifactBytes(name, mimeType, state.bytes);
                  else await downloadArtifact(target, artifactId, name, mimeType);
                } catch {
                  setDownloadError(t`Could not download ${name}. Try again.`);
                }
              })()
            }
          >
            <Download />
          </Button>
        </IconTooltip>
        <DialogClose
          ref={closeButtonRef}
          aria-label={t`Close preview`}
          render={
            <Button variant="ghost" size="icon-lg" className="rounded-full text-muted-foreground" />
          }
        >
          <X />
        </DialogClose>
      </header>
      {downloadError ? (
        <div className="shrink-0 px-5 pt-4">
          <DownloadError message={downloadError} />
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {state.status === "loading" ? (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground">
            <Spinner aria-label={t`Loading preview…`} />
          </div>
        ) : state.status === "error" ? (
          <div className="m-5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive">
            {state.message}
          </div>
        ) : kind === "html" && state.text !== undefined ? (
          <SandboxedHtmlViewer html={state.text} title={name} />
        ) : kind === "video" ? (
          <VideoPreview bytes={state.bytes} name={name} />
        ) : kind === "pdf" ? (
          <PdfViewer bytes={state.bytes} title={name} />
        ) : state.text !== undefined && kind === "text" ? (
          <pre className="px-8 py-10 font-mono text-[13px] leading-6 whitespace-pre-wrap break-words text-foreground sm:px-12 sm:py-12">
            {state.text}
          </pre>
        ) : state.text !== undefined ? (
          <article className="mx-auto w-full max-w-[760px] px-8 py-10 text-[16px] leading-7 text-foreground sm:px-12 sm:py-12">
            <ChatMarkdown>{state.text}</ChatMarkdown>
          </article>
        ) : null}
      </div>
    </>
  );
}

function AudioArtifactPreview({
  target,
  artifactId,
  name,
  mimeType,
  onDownload,
}: ArtifactFileCardProps & { onDownload: () => Promise<void> }) {
  const { t } = useLingui();
  const [state, setState] = useState<
    { status: "idle" | "loading" } | { status: "ready"; src: string } | { status: "error" }
  >({ status: "idle" });
  const lifetime = useRef<{ cancelled: boolean; started: boolean; url?: string }>(null);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const current = { cancelled: false, started: false, url: undefined as string | undefined };
    lifetime.current = current;
    return () => {
      current.cancelled = true;
      if (current.url) URL.revokeObjectURL(current.url);
    };
  }, []);
  useEffect(() => {
    if (state.status !== "ready") return;
    const player = audio.current;
    void player?.play().catch(() => {});
    return () => player?.pause();
  }, [state]);

  async function startPlayback() {
    const current = lifetime.current;
    if (!current || current.cancelled || current.started) return;
    current.started = true;
    setState({ status: "loading" });
    try {
      const bytes = await fetchArtifactBytes(target, artifactId);
      if (current.cancelled) return;
      if (!isAttachmentAudioMimeType(mimeType)) throw new Error("Unsupported audio type");
      current.url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }));
      setState({ status: "ready", src: current.url });
    } catch {
      if (!current.cancelled) setState({ status: "error" });
    }
  }

  return (
    <>
      <div className="flex items-center gap-3">
        {state.status === "idle" || state.status === "loading" ? (
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label={t`Play ${name}`}
            aria-busy={state.status === "loading"}
            disabled={state.status === "loading"}
            onClick={() => void startPlayback()}
          >
            <Play />
          </Button>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{name}</span>
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label={t`Download ${name}`}
          onClick={() => void onDownload()}
          className="text-muted-foreground"
        >
          <Download strokeWidth={1.8} className="size-[19px]" />
        </Button>
      </div>
      {state.status === "loading" ? (
        <span className="text-sm text-muted-foreground">
          <Spinner aria-label={t`Loading preview…`} />
        </span>
      ) : state.status === "error" ? (
        <DownloadError message={t`Could not load this file.`} />
      ) : state.status === "ready" ? (
        // biome-ignore lint/a11y/useMediaCaption: Attachment playback has no caption track supplied by the author.
        <audio
          ref={audio}
          src={state.src}
          controls
          preload="metadata"
          aria-label={name}
          className="mt-3 w-full"
        />
      ) : null}
    </>
  );
}

export function VideoPreview({ bytes, name }: { bytes: Uint8Array; name: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "video/mp4" }));
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [bytes]);
  return (
    // biome-ignore lint/a11y/useMediaCaption: Attachment playback has no caption track supplied by the author.
    <video
      src={src}
      controls
      playsInline
      preload="metadata"
      aria-label={name}
      className="h-full w-full object-contain"
    />
  );
}

function DownloadError({ message }: { message: string }) {
  return (
    <div role="alert" className="mt-2 text-left text-[13px] text-destructive">
      {message}
    </div>
  );
}

function formatSize(bytes: number): string {
  const parts = fileSizeParts(bytes, i18n.locale || "en");
  if (!parts) return "";
  const size = parts.amount;
  switch (parts.unit) {
    case "B":
      return translate`${size} B`;
    case "KB":
      return translate`${parts.amount} KB`;
    case "MB":
      return translate`${parts.amount} MB`;
    case "GB":
      return translate`${parts.amount} GB`;
    case "TB":
      return translate`${parts.amount} TB`;
  }
}
