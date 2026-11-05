import { useLingui } from "@lingui/react/macro";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@rakazo/ui-web";
import { Check, Copy, Download, ExternalLink, Minus, Plus, ScanSearch, X } from "lucide-react";
import type { ReactNode, PointerEvent as ReactPointerEvent, WheelEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { IconTooltip } from "./IconTooltip";

export type LightboxImage = { src: string; name: string; downloadName?: string };

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

/**
 * Full-screen viewer for a chat image: zoom with the buttons, wheel or a double click, drag to
 * pan while zoomed, and download, open or copy the picture.
 */
export function ImageLightbox({
  image,
  onClose,
}: {
  image: LightboxImage | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={image !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        showCloseButton={false}
        className="top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-black/95 p-0 text-white ring-0 sm:max-w-none"
      >
        {image ? <Viewer key={image.src} image={image} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Viewer({ image }: { image: LightboxImage }) {
  const { t } = useLingui();
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [copied, setCopied] = useState<"image" | "link" | null>(null);
  const [failed, setFailed] = useState(false);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const picture = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (zoom === MIN_ZOOM) setOffset({ x: 0, y: 0 });
  }, [zoom]);

  function zoomTo(next: number) {
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 100) / 100)));
  }

  function actualSize() {
    const element = picture.current;
    if (!element?.naturalWidth || !element.clientWidth) return;
    zoomTo(zoom === MIN_ZOOM ? element.naturalWidth / element.clientWidth : MIN_ZOOM);
  }

  async function imageBlob(): Promise<Blob> {
    const response = await fetch(image.src, { credentials: "same-origin" });
    if (!response.ok) throw new Error(String(response.status));
    return response.blob();
  }

  async function download() {
    const name = image.downloadName ?? image.name;
    try {
      const url = URL.createObjectURL(await imageBlob());
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      window.open(image.src, "_blank", "noopener,noreferrer");
    }
  }

  async function copy() {
    try {
      const blob = await pngBlob(await imageBlob());
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopied("image");
    } catch {
      if (image.src.startsWith("blob:") || image.src.startsWith("data:")) return;
      await navigator.clipboard?.writeText(image.src).catch(() => undefined);
      setCopied("link");
    }
    window.setTimeout(() => setCopied(null), 1600);
  }

  function onWheel(event: WheelEvent) {
    zoomTo(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
  }

  function onPointerDown(event: ReactPointerEvent) {
    if (zoom === MIN_ZOOM) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: offset.x, y: offset.y, startX: event.clientX, startY: event.clientY };
  }

  function onPointerMove(event: ReactPointerEvent) {
    const start = drag.current;
    if (!start) return;
    setOffset({
      x: start.x + (event.clientX - start.startX),
      y: start.y + (event.clientY - start.startY),
    });
  }

  const opensElsewhere = !image.src.startsWith("blob:") && !image.src.startsWith("data:");

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-1 px-4">
        <DialogTitle className="min-w-0 flex-1 truncate text-[14px] font-medium text-white">
          {image.name}
        </DialogTitle>
        <ViewerButton
          label={t`Zoom out`}
          disabled={zoom <= MIN_ZOOM}
          onClick={() => zoomTo(zoom / 1.5)}
        >
          <Minus />
        </ViewerButton>
        <span className="w-12 text-center text-[12.5px] tabular-nums text-white/70">
          {Math.round(zoom * 100)}%
        </span>
        <ViewerButton
          label={t`Zoom in`}
          disabled={zoom >= MAX_ZOOM}
          onClick={() => zoomTo(zoom * 1.5)}
        >
          <Plus />
        </ViewerButton>
        <ViewerButton
          label={zoom === MIN_ZOOM ? t`Actual size` : t`Fit to screen`}
          onClick={actualSize}
        >
          <ScanSearch />
        </ViewerButton>
        <span className="mx-1 h-5 w-px bg-white/15" aria-hidden />
        <ViewerButton
          label={
            copied === "image" ? t`Copied` : copied === "link" ? t`Link copied` : t`Copy image`
          }
          onClick={() => void copy()}
        >
          {copied ? <Check /> : <Copy />}
        </ViewerButton>
        <ViewerButton label={t`Download`} onClick={() => void download()}>
          <Download />
        </ViewerButton>
        {opensElsewhere ? (
          <ViewerButton
            label={t`Open in new tab`}
            onClick={() => window.open(image.src, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink />
          </ViewerButton>
        ) : null}
        <DialogClose
          aria-label={t`Close`}
          className="ms-1 grid size-9 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
        >
          <X className="size-5" />
        </DialogClose>
      </header>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer panning and wheel zoom; the toolbar offers the same zoom by keyboard. */}
      <div
        className={`relative min-h-0 flex-1 touch-none overflow-hidden select-none ${zoom > MIN_ZOOM ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          drag.current = null;
        }}
        onDoubleClick={() => zoomTo(zoom === MIN_ZOOM ? 2.5 : MIN_ZOOM)}
      >
        {failed ? (
          <p className="absolute inset-0 grid place-items-center text-white/70">
            {t`This image could not be shown.`}
          </p>
        ) : (
          <img
            ref={picture}
            src={image.src}
            alt={image.name}
            draggable={false}
            onError={() => setFailed(true)}
            referrerPolicy="no-referrer"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
            className="absolute inset-0 m-auto max-h-[calc(100%-2rem)] max-w-[calc(100%-2rem)] object-contain transition-transform duration-75 ease-out"
          />
        )}
      </div>
    </>
  );
}

function ViewerButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <IconTooltip label={label}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className="grid size-9 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-35 [&_svg]:size-[18px]"
      >
        {children}
      </button>
    </IconTooltip>
  );
}

/** The clipboard takes PNG everywhere; other formats are redrawn first. */
async function pngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("png"))), "image/png"),
  );
}
