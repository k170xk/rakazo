import { useLingui } from "@lingui/react/macro";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  ScrollArea,
  toast,
} from "@rakazo/ui-web";
import { Tooltip, TooltipContent, TooltipTrigger } from "@rakazo/ui-web/components/ui/tooltip";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { useRef, useState } from "react";
import { keepFullResolution } from "../../lib/prepare-image";

/** Evolve's drawing limit: pages beyond this are rarely all relevant. */
export const MAX_DRAWING_PAGES = 10;
/** Evolve's logical page scale, multiplied by the device pixel ratio. */
const BASE_SCALE = 1.6;
const PREVIEW_SCALE = 0.4;

type PdfPreview = {
  fileName: string;
  fileIndex: number;
  pageNumber: number;
  dataUrl: string;
  selected: boolean;
};

async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

async function renderPage(pdf: PDFDocumentProxy, pageNumber: number, scale: number) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
  return canvas;
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Lossless PNG as Evolve sends; a page too large for the upload limit falls back to JPEG, then shrinks. */
async function pageFile(canvas: HTMLCanvasElement, baseName: string, maxBytes: number) {
  const png = await canvasBlob(canvas, "image/png");
  if (png && png.size <= maxBytes) return new File([png], `${baseName}.png`, { type: "image/png" });
  let source = canvas;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const jpeg = await canvasBlob(source, "image/jpeg", 0.92);
    if (jpeg && jpeg.size <= maxBytes) {
      return new File([jpeg], `${baseName}.jpg`, { type: "image/jpeg" });
    }
    const ratio = jpeg ? Math.sqrt(maxBytes / jpeg.size) * 0.9 : 0.7;
    const smaller = document.createElement("canvas");
    smaller.width = Math.max(1, Math.floor(source.width * ratio));
    smaller.height = Math.max(1, Math.floor(source.height * ratio));
    smaller.getContext("2d")?.drawImage(source, 0, 0, smaller.width, smaller.height);
    source = smaller;
  }
  return null;
}

/** Evolve chat's "Add drawings": PDF pages become images the bot can look at. */
export function DrawingsDialog({
  open,
  onOpenChange,
  maxPages,
  maxBytes,
  onAddFiles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maxPages: number;
  maxBytes: number;
  onAddFiles: (files: File[]) => void;
}) {
  const { t } = useLingui();
  const [isLoading, setIsLoading] = useState(false);
  const [previews, setPreviews] = useState<PdfPreview[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfs = useRef<{ name: string; pdf: PDFDocumentProxy; task: PDFDocumentLoadingTask }[]>([]);
  const selectedCount = previews.filter((p) => p.selected).length;

  async function closePdfs() {
    const open = pdfs.current;
    pdfs.current = [];
    await Promise.all(open.map(({ task }) => task.destroy().catch(() => undefined)));
  }

  async function handleSelectPdf(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    if (files.some((file) => !file.type.includes("pdf"))) {
      toast.error(t`Please select PDF files only`);
      return;
    }
    setIsLoading(true);
    try {
      const pdfjs = await loadPdfjs();
      await closePdfs();
      const all: PdfPreview[] = [];
      for (const [fileIndex, file] of files.entries()) {
        const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
        const pdf = await task.promise;
        pdfs.current.push({ name: file.name, pdf, task });
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          const canvas = await renderPage(pdf, pageNumber, PREVIEW_SCALE * BASE_SCALE);
          all.push({
            fileName: file.name,
            fileIndex,
            pageNumber,
            dataUrl: canvas.toDataURL("image/png"),
            selected: false,
          });
        }
      }
      setPreviews(all);
      const pageCount = all.length;
      toast.success(
        pageCount === 1
          ? t`Loaded ${pageCount} page from ${files.length} PDF(s)`
          : t`Loaded ${pageCount} pages from ${files.length} PDF(s)`,
      );
    } catch {
      toast.error(t`Failed to preview PDF`);
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function toggleSelect(fileIndex: number, pageNumber: number) {
    setPreviews((current) =>
      current.map((p) => {
        if (p.fileIndex !== fileIndex || p.pageNumber !== pageNumber) return p;
        if (!p.selected && selectedCount >= maxPages) {
          toast.error(t`You can select up to ${maxPages} pages at a time`);
          return p;
        }
        return { ...p, selected: !p.selected };
      }),
    );
  }

  async function handleAdd() {
    const chosen = previews.filter((p) => p.selected);
    if (chosen.length === 0) {
      toast.error(t`Select at least one page`);
      return;
    }
    setIsLoading(true);
    try {
      const deviceScale = Math.max(1, window.devicePixelRatio || 1);
      const files: File[] = [];
      for (const page of chosen) {
        const source = pdfs.current[page.fileIndex];
        if (!source) continue;
        const canvas = await renderPage(source.pdf, page.pageNumber, BASE_SCALE * deviceScale);
        const stem = source.name.replace(/\.pdf$/i, "");
        const file = await pageFile(canvas, `${stem} - page ${page.pageNumber}`, maxBytes);
        if (!file) {
          toast.error(t`Page ${page.pageNumber} of ${source.name} is too large to attach`);
          continue;
        }
        files.push(keepFullResolution(file));
      }
      if (files.length) onAddFiles(files);
      await closePdfs();
      setPreviews([]);
      onOpenChange(false);
    } catch {
      toast.error(t`Failed to add drawings`);
    } finally {
      setIsLoading(false);
    }
  }

  const groups = Array.from(new Map(previews.map((p) => [p.fileIndex, p.fileName])).entries());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,60rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t`Add drawings`}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              multiple
              onChange={(event) => void handleSelectPdf(event.target.files)}
              className="hidden"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
            >
              {isLoading ? t`Loading…` : t`Select Drawing(s)`}
            </Button>
            <span className="text-xs text-muted-foreground">
              {t`Accepted: PDF. Select a file to preview and choose pages.`}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="h-2 w-64 overflow-hidden rounded-full bg-accent">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(selectedCount / maxPages) * 100}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {t`${selectedCount} / ${maxPages} pages selected`}
            </span>
          </div>

          {previews.length === 0 ? (
            <div className="rounded border py-10 text-center text-muted-foreground">
              <p className="text-sm">{t`No drawings selected`}</p>
              <p className="text-xs">{t`Click "Select PDF" to choose a document`}</p>
            </div>
          ) : (
            <ScrollArea className="h-[50vh] rounded border">
              {groups.map(([fileIndex, name], groupIndex) => (
                <div
                  key={`group-${fileIndex}`}
                  className={`p-3 ${groupIndex % 2 === 0 ? "bg-card" : "bg-muted"} ${groupIndex > 0 ? "border-t border-muted" : ""}`}
                >
                  <div className="mb-2 truncate text-xs font-medium text-muted-foreground">
                    {name}
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    {previews
                      .filter((p) => p.fileIndex === fileIndex)
                      .map((p) => (
                        <button
                          key={`${fileIndex}-${p.pageNumber}`}
                          type="button"
                          onClick={() => toggleSelect(fileIndex, p.pageNumber)}
                          aria-pressed={p.selected}
                          className={`group relative overflow-hidden rounded border ${p.selected ? "ring-2 ring-success" : ""}`}
                          title={t`Page ${p.pageNumber}`}
                        >
                          <img
                            src={p.dataUrl}
                            alt={t`Page ${p.pageNumber}`}
                            className="h-48 w-full bg-card object-contain"
                          />
                          <div className="absolute top-1 left-1 rounded bg-overlay px-1 text-xs text-white">
                            {p.pageNumber}
                          </div>
                          {p.selected ? <div className="absolute inset-0 bg-success/20" /> : null}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </ScrollArea>
          )}

          <div className="rounded border border-green-200 bg-green-50 p-2 text-xs text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200">
            <p>
              <span className="font-medium">{t`Note:`}</span>{" "}
              {t`Selected pages will be converted to images and added to your message.`}
            </p>
            <p className="mt-1">
              <span className="font-medium">{t`Tip:`}</span>{" "}
              {t`Uploading drawings here turns pages into images the AI can visually inspect. The regular file upload is for text extraction only and does not provide visual understanding of drawings.`}
            </p>
            <p className="mt-1 text-red-700 dark:text-red-300">
              <span className="font-medium">{t`Warning:`}</span>{" "}
              {t`Intended use is to add no more than ${MAX_DRAWING_PAGES} drawing pages at a time. Please select only the most relevant pages.`}
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t`Cancel`}
            </Button>
            <Button onClick={() => void handleAdd()} disabled={isLoading || selectedCount === 0}>
              {t`Add drawings`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Evolve's PDF button beside the message box: opens Add drawings. */
export function DrawingsButton({
  disabled,
  maxPages,
  maxBytes,
  onAddFiles,
}: {
  disabled?: boolean;
  maxPages: number;
  maxBytes: number;
  onAddFiles: (files: File[]) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="outline"
              size="icon"
              aria-label={t`Add PDF drawings`}
              disabled={disabled || maxPages < 1}
              onClick={() => setOpen(true)}
              className="size-8 shrink-0 rounded-full"
            />
          }
        >
          <span className="grid h-4 w-4 place-items-center rounded-sm bg-muted-foreground/80 text-[9px] leading-none font-bold text-background">
            PDF
          </span>
        </TooltipTrigger>
        <TooltipContent>{t`Add PDF drawings as images`}</TooltipContent>
      </Tooltip>
      {open ? (
        <DrawingsDialog
          open={open}
          onOpenChange={setOpen}
          maxPages={maxPages}
          maxBytes={maxBytes}
          onAddFiles={onAddFiles}
        />
      ) : null}
    </>
  );
}
