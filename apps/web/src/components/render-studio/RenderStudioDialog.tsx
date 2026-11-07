import { useLingui } from "@lingui/react/macro";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
  toast,
} from "@rakazo/ui-web";
import {
  Brush,
  Download,
  Eraser,
  GitCompareArrows,
  Info,
  Lasso,
  Maximize2,
  MessageSquarePlus,
  MousePointer2,
  Play,
  Square as RectIcon,
  Settings2,
  Sparkles,
  Type,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CompareSlider } from "./CompareSlider";
import type { MaskShape, RenderVersion, StudioQuality, StudioSize, StudioTool } from "./mask";
import {
  blobToDataUrl,
  buildMarkupPng,
  dataUrlToBlob,
  editableImage,
  MARKUP_COLOUR_NAME,
  pickBestSize,
  resizeTo,
} from "./mask";
import { RenderLoader } from "./RenderLoader";
import type { StageCanvasHandle } from "./StageCanvas";
import { StageCanvas } from "./StageCanvas";

export type RenderRequest = {
  image: string;
  markup: string | null;
  prompt: string;
  size: StudioSize;
  quality: StudioQuality;
};

const MODEL_LABEL = "OCSC Vision Intelligence";

/**
 * Render Studio: mark an area of a picture with a lasso, rectangle or brush, describe the change,
 * and the image model edits only that area. Every render is a new version that can be edited again.
 */
export function RenderStudioDialog({
  open,
  onOpenChange,
  sourceImageUrl,
  sourceName,
  render,
  onSaveToChat,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceImageUrl: string | null;
  sourceName?: string;
  /** Runs one edit and returns the result as a PNG data URL. */
  render: (request: RenderRequest) => Promise<string>;
  /** Attaches a render to the chat's message box. */
  onSaveToChat?: (file: File) => void;
}) {
  const { t } = useLingui();
  const [captureBlob, setCaptureBlob] = useState<Blob | null>(null);
  const [captureUrl, setCaptureUrl] = useState<string | null>(null);
  const [captureSize, setCaptureSize] = useState<{ w: number; h: number } | null>(null);
  const [captureShapes, setCaptureShapes] = useState<MaskShape[]>([]);
  const [renders, setRenders] = useState<RenderVersion[]>([]);
  const [activeRenderId, setActiveRenderId] = useState<string | null>(null);
  const [renderShapes, setRenderShapes] = useState<MaskShape[]>([]);
  const [renderSize, setRenderSize] = useState<{ w: number; h: number } | null>(null);
  const [editSource, setEditSource] = useState<"capture" | "render">("capture");
  const [tool, setTool] = useState<StudioTool>("lasso");
  const [brushRadius, setBrushRadius] = useState(28);
  const [compareMode, setCompareMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quality, setQuality] = useState<StudioQuality>("medium");
  const [extraPrompt, setExtraPrompt] = useState("");
  const captureStageRef = useRef<StageCanvasHandle>(null);
  const renderStageRef = useRef<StageCanvasHandle>(null);
  const urls = useRef<string[]>([]);

  const activeRender = useMemo(
    () => renders.find((item) => item.id === activeRenderId) ?? null,
    [renders, activeRenderId],
  );
  const versionOf = (id: string | null) => renders.find((item) => item.id === id)?.version;

  const objectUrl = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urls.current.push(url);
    return url;
  }, []);

  useEffect(() => {
    if (!open || !sourceImageUrl) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(sourceImageUrl, { credentials: "same-origin" });
        if (!response.ok) throw new Error(String(response.status));
        const blob = await editableImage(await response.blob());
        if (cancelled) return;
        setCaptureBlob(blob);
        setCaptureUrl(objectUrl(blob));
      } catch {
        if (!cancelled) toast.error(t`Could not load this image into Render Studio.`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sourceImageUrl, objectUrl, t]);

  useEffect(() => {
    if (open) return;
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current = [];
    setCaptureBlob(null);
    setCaptureUrl(null);
    setCaptureSize(null);
    setCaptureShapes([]);
    setRenders([]);
    setActiveRenderId(null);
    setRenderShapes([]);
    setEditSource("capture");
    setBusy(false);
    setCompareMode(false);
    setExtraPrompt("");
  }, [open]);

  const shapesNow = editSource === "capture" ? captureShapes : renderShapes;

  const onRender = useCallback(async () => {
    if (busy) return;
    const sourceBlob = editSource === "capture" ? captureBlob : (activeRender?.blob ?? captureBlob);
    const sourceSize = editSource === "capture" ? captureSize : (renderSize ?? captureSize);
    if (!sourceBlob || !sourceSize) {
      toast.error(t`No source image`);
      return;
    }
    const instruction = extraPrompt.trim();
    if (!instruction) {
      toast.error(t`Describe the edit you want`);
      return;
    }
    setBusy(true);
    try {
      const markup = shapesNow.length
        ? await buildMarkupPng(sourceSize.w, sourceSize.h, shapesNow)
        : null;
      const prompt = markup
        ? `Edit only inside the area(s) marked in ${MARKUP_COLOUR_NAME}. Leave everything outside them pixel-identical, and remove the ${MARKUP_COLOUR_NAME} marks from the finished image. Edit instruction: ${instruction}`
        : instruction;
      // Every render keeps the original's size: the closest model size, scaled back exactly.
      const canonical = captureSize ?? sourceSize;
      const result = await render({
        image: await blobToDataUrl(sourceBlob),
        markup: markup ? await blobToDataUrl(markup) : null,
        prompt,
        size: pickBestSize(canonical.w, canonical.h),
        quality,
      });
      const blob = await resizeTo(await dataUrlToBlob(result), canonical.w, canonical.h);
      const version = renders.length + 1;
      const next: RenderVersion = {
        id: crypto.randomUUID(),
        url: objectUrl(blob),
        blob,
        prompt,
        hadMask: Boolean(markup),
        version,
        parentRenderId: editSource === "render" ? (activeRender?.id ?? null) : null,
      };
      setRenders((current) => [...current, next]);
      setActiveRenderId(next.id);
      setRenderShapes([]);
      if (editSource === "capture") setCaptureShapes([]);
      setEditSource("render");
      toast.success(t`Render v${version} ready`);
    } catch (error) {
      toast.error((error instanceof Error ? error.message : String(error)).slice(0, 200));
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    editSource,
    captureBlob,
    activeRender,
    captureSize,
    renderSize,
    shapesNow,
    extraPrompt,
    quality,
    renders.length,
    render,
    objectUrl,
    t,
  ]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (target?.tagName === "SELECT" || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "h") setTool("pan");
      else if (key === "v") setTool("lasso");
      else if (key === "m") setTool("rect");
      else if (key === "b") setTool("brush");
      else if (key === "r") void onRender();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onRender]);

  function fileName(version: number) {
    const base = (sourceName ?? "image").replace(/\.[a-z0-9]+$/i, "");
    return `${base}-render-v${version}.png`;
  }

  function onDownload() {
    if (!activeRender) return;
    const link = document.createElement("a");
    link.href = activeRender.url;
    link.download = fileName(activeRender.version);
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function onSave() {
    if (!activeRender || !onSaveToChat) return;
    onSaveToChat(
      new File([activeRender.blob], fileName(activeRender.version), { type: "image/png" }),
    );
    toast.success(t`Render v${activeRender.version} added to your message`);
    onOpenChange(false);
  }

  const clearMasks = () => (editSource === "capture" ? setCaptureShapes([]) : setRenderShapes([]));
  const activeStageRef = editSource === "capture" ? captureStageRef : renderStageRef;
  const nextVersion = renders.length + 1;

  const steps: { n: number; done: boolean; icon: ReactNode; title: string; body: string }[] = [
    {
      n: 1,
      done: shapesNow.length > 0,
      icon: <MousePointer2 className="size-4" />,
      title: t`Mark the area`,
      body: t`Use Lasso, Rect or Brush to outline what should change. Optional — skip to edit the whole image.`,
    },
    {
      n: 2,
      done: Boolean(extraPrompt.trim()),
      icon: <Type className="size-4" />,
      title: t`Describe the change`,
      body: t`Type a clear, specific instruction in the box below.`,
    },
    {
      n: 3,
      done: renders.length > 0,
      icon: <Play className="size-4" />,
      title: t`Render`,
      body: t`${MODEL_LABEL} edits only inside your mask and saves a new version.`,
    },
  ];

  const toolButtons: { value: StudioTool; label: string; icon: ReactNode }[] = [
    { value: "lasso", label: t`Lasso`, icon: <Lasso className="size-3.5" /> },
    { value: "rect", label: t`Rect`, icon: <RectIcon className="size-3.5" /> },
    { value: "brush", label: t`Brush`, icon: <Brush className="size-3.5" /> },
  ];

  return (
    <Dialog
      open={open}
      disablePointerDismissal
      onOpenChange={(next, details) => {
        if (!next && details?.reason === "escape-key") return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[90vh] w-[1400px] max-w-[95vw] flex-col gap-1 overflow-hidden border-border bg-background p-0 text-foreground sm:max-w-[95vw]"
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-muted/40 px-4">
          <div className="flex items-center gap-2">
            <Wand2 className="size-4 text-primary" />
            <DialogTitle className="text-sm font-semibold tracking-wide">
              {t`Render Studio`}
            </DialogTitle>
            <Badge variant="outline" className="ms-2 text-[10px]">
              {MODEL_LABEL}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <Popover>
              <PopoverTrigger
                render={
                  <Button variant="ghost" size="sm" className="h-8">
                    <Settings2 className="me-1 size-4" /> {t`Output`}
                  </Button>
                }
              />
              <PopoverContent className="w-72">
                <div className="space-y-3">
                  <div className="rounded border border-border bg-muted/40 p-2 text-[11px] text-muted-foreground">
                    {captureSize
                      ? t`Output size is locked to the original image (${captureSize.w} × ${captureSize.h}px). Every render inherits this size — no resizing, no cropping.`
                      : t`Output size is locked to the original image. Every render inherits this size — no resizing, no cropping.`}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="render-studio-quality" className="text-xs">
                      {t`Quality`}
                    </Label>
                    <select
                      id="render-studio-quality"
                      value={quality}
                      onChange={(event) => setQuality(event.target.value as StudioQuality)}
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="low">{t`Low (fastest)`}</option>
                      <option value="medium">{t`Medium`}</option>
                      <option value="high">{t`High (slow)`}</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="render-studio-brush" className="text-xs">
                      {t`Brush radius: ${brushRadius}px`}
                    </Label>
                    <input
                      id="render-studio-brush"
                      type="range"
                      min={4}
                      max={120}
                      step={2}
                      value={brushRadius}
                      onChange={(event) => setBrushRadius(Number(event.target.value))}
                      className="w-full accent-primary"
                    />
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => setCompareMode((value) => !value)}
              disabled={!activeRender}
            >
              <GitCompareArrows className="me-1 size-4" /> {compareMode ? t`Split` : t`Compare`}
            </Button>
            {onSaveToChat ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={onSave}
                disabled={!activeRender}
              >
                <MessageSquarePlus className="me-1.5 size-4" /> {t`Add to chat`}
              </Button>
            ) : null}
            <Button
              size="sm"
              className="h-8 font-semibold"
              onClick={onDownload}
              disabled={!activeRender}
            >
              <Download className="me-1.5 size-4" /> {t`Download PNG`}
            </Button>
            <div className="mx-1 h-6 w-px bg-border" />
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-muted-foreground hover:text-foreground"
              onClick={() => onOpenChange(false)}
            >
              <X className="me-1 size-4" /> {t`Close`}
            </Button>
          </div>
        </div>

        <div className="shrink-0 border-b border-border bg-primary/5 px-4 py-3">
          <div className="mb-2 flex items-center gap-1.5">
            <Info className="size-3.5 text-primary" />
            <span className="text-[10px] font-semibold tracking-wider text-foreground uppercase">
              {t`New · Granular Editing — follow the 3 steps below`}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {steps.map((step) => (
              <div
                key={step.n}
                className={`flex items-start gap-2.5 rounded-md border p-2.5 transition-colors ${
                  step.done ? "border-primary/60 bg-primary/10" : "border-border bg-background"
                }`}
              >
                <span
                  className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    step.done ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                  }`}
                >
                  {step.n}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    {step.icon}
                    <span>{step.title}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 bg-muted/30">
            {compareMode && activeRender && captureUrl ? (
              <CompareSlider beforeUrl={captureUrl} afterUrl={activeRender.url} />
            ) : (
              <div className="grid h-full grid-cols-2">
                {/* biome-ignore lint/a11y/noStaticElementInteractions: picking the side to edit; the version strip offers the same by keyboard. */}
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: as above. */}
                <div
                  className="relative border-e border-border"
                  onClick={() => setEditSource("capture")}
                >
                  <StageCanvas
                    ref={captureStageRef}
                    imageUrl={captureUrl}
                    shapes={captureShapes}
                    onShapesChange={setCaptureShapes}
                    tool={tool}
                    editable={editSource === "capture"}
                    accent="capture"
                    brushRadius={brushRadius}
                    label={t`ORIGINAL (v0)`}
                    onImageSize={(w, h) => setCaptureSize({ w, h })}
                  />
                  {editSource === "capture" ? (
                    <div className="absolute top-2 right-2 rounded bg-amber-500 px-2 py-1 text-[10px] font-bold tracking-wider text-white shadow">
                      {t`EDITING THIS · NEXT → v${nextVersion}`}
                    </div>
                  ) : null}
                </div>
                {/* biome-ignore lint/a11y/noStaticElementInteractions: as above. */}
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: as above. */}
                <div
                  className="relative"
                  onClick={() => {
                    if (activeRender) setEditSource("render");
                  }}
                >
                  <StageCanvas
                    ref={renderStageRef}
                    imageUrl={activeRender?.url ?? null}
                    shapes={renderShapes}
                    onShapesChange={setRenderShapes}
                    tool={tool}
                    editable={editSource === "render" && Boolean(activeRender)}
                    accent="render"
                    brushRadius={brushRadius}
                    label={
                      activeRender
                        ? activeRender.parentRenderId
                          ? t`VERSION v${activeRender.version} (from v${versionOf(activeRender.parentRenderId) ?? 0})`
                          : t`VERSION v${activeRender.version} (from original)`
                        : t`NO RENDERS YET`
                    }
                    onImageSize={(w, h) => setRenderSize({ w, h })}
                  />
                  {editSource === "render" && activeRender ? (
                    <div className="absolute top-2 right-2 rounded bg-amber-500 px-2 py-1 text-[10px] font-bold tracking-wider text-white shadow">
                      {t`EDITING v${activeRender.version} · NEXT → v${nextVersion}`}
                    </div>
                  ) : null}
                  {busy ? <RenderLoader modelLabel={MODEL_LABEL} presetLabel={t`Edit`} /> : null}
                </div>
              </div>
            )}
          </div>

          {renders.length > 0 ? (
            <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-border bg-muted/30 px-3 py-2">
              <div className="me-3 flex shrink-0 flex-col">
                <span className="text-[10px] tracking-wider text-muted-foreground uppercase">
                  {t`Version history`}
                </span>
                <span className="text-[11px] font-semibold">
                  {activeRender
                    ? t`Editing v${activeRender.version} → next will be v${nextVersion}`
                    : t`Editing original → first render will be v1`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveRenderId(null);
                  setEditSource("capture");
                  setCompareMode(false);
                }}
                className={`relative h-14 w-20 shrink-0 overflow-hidden rounded border ${
                  !activeRenderId && editSource === "capture"
                    ? "border-amber-500 ring-2 ring-amber-400/50"
                    : "border-border hover:border-foreground/30"
                }`}
                title={t`Original source image`}
              >
                {captureUrl ? (
                  <img src={captureUrl} alt={t`Original`} className="h-full w-full object-cover" />
                ) : null}
                <span className="absolute right-0 bottom-0 left-0 bg-background/85 px-1 text-center text-[9px] font-semibold text-foreground">
                  {t`ORIGINAL`}
                </span>
              </button>
              {renders.map((item) => {
                const isActive = item.id === activeRenderId && editSource === "render";
                const parent = versionOf(item.parentRenderId);
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => {
                      setActiveRenderId(item.id);
                      setEditSource("render");
                      setCompareMode(false);
                    }}
                    className={`relative h-14 w-20 shrink-0 overflow-hidden rounded border ${
                      isActive
                        ? "border-amber-500 ring-2 ring-amber-400/50"
                        : "border-border hover:border-foreground/30"
                    }`}
                    title={`v${item.version}${parent ? ` (from v${parent})` : ` (${t`from original`})`}${item.hadMask ? ` · ${t`masked`}` : ""}`}
                  >
                    <img src={item.url} alt="" className="h-full w-full object-cover" />
                    <span className="absolute right-0 bottom-0 left-0 bg-background/85 px-1 text-center text-[9px] font-semibold text-foreground">
                      v{item.version}
                    </span>
                    {item.hadMask ? (
                      <span className="absolute top-0 right-0 rounded-bl bg-amber-500 px-1 text-[8px] font-bold text-white">
                        {t`MASK`}
                      </span>
                    ) : null}
                    {isActive ? (
                      <span className="absolute top-0 left-0 rounded-br bg-amber-500 px-1 text-[8px] font-bold text-white">
                        {t`EDITING`}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="flex h-12 shrink-0 items-center gap-1 border-t border-border bg-muted/20 px-3">
            <div className="flex h-8 items-center rounded-lg bg-muted p-0.5">
              {toolButtons.map((item) => (
                <button
                  type="button"
                  key={item.value}
                  aria-pressed={tool === item.value}
                  onClick={() => setTool(item.value)}
                  className={`flex h-7 items-center gap-1 rounded-md px-2 text-xs ${
                    tool === item.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              className="ms-1 h-8 font-semibold"
              onClick={() => {
                activeStageRef.current?.commitDraft();
                setTool("pan");
              }}
              title={t`Finish drawing — locks the current mask and deactivates the tool`}
            >
              <Sparkles className="me-1 size-3.5" /> {t`Done`}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => {
                activeStageRef.current?.cancelDraft();
                setTool("pan");
              }}
              title={t`Cancel the in-progress shape and deactivate the tool (Esc)`}
            >
              <X className="me-1 size-3.5" /> {t`Cancel`}
            </Button>
            <Button variant="ghost" size="sm" className="h-8" onClick={clearMasks}>
              <Eraser className="me-1 size-3.5" /> {t`Clear mask`}
            </Button>
            <div className="mx-2 h-6 w-px bg-border" />
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t`Zoom out`}
              onClick={() => activeStageRef.current?.zoomOut()}
            >
              <ZoomOut className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t`Fit to screen`}
              onClick={() => activeStageRef.current?.fit()}
            >
              <Maximize2 className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t`Zoom in`}
              onClick={() => activeStageRef.current?.zoomIn()}
            >
              <ZoomIn className="size-4" />
            </Button>
            <div className="mx-2 h-6 w-px bg-border" />
            <span className="truncate text-[10px] text-muted-foreground">
              {editSource === "capture" ? t`Editing ORIGINAL` : t`Editing RENDER`}
              {t` · Shift-drag or middle-mouse to pan · V lasso · M rect · B brush · Enter/Done commits · Esc cancels`}
            </span>
          </div>

          <div className="grid shrink-0 grid-cols-12 gap-3 border-t border-border bg-card p-3">
            <div className="col-span-9">
              <Label
                htmlFor="render-studio-prompt"
                className="flex items-center gap-2 text-[10px] tracking-wider text-muted-foreground uppercase"
              >
                <span>{t`Step 2 — Describe the edit`}</span>
                {shapesNow.length > 0 ? (
                  <span className="font-semibold tracking-normal text-amber-600 normal-case">
                    {t`Mask active — only the marked area will change`}
                  </span>
                ) : (
                  <span className="tracking-normal text-muted-foreground/80 normal-case">
                    {t`No mask — the whole image will be edited. Tip: draw a mask above for granular edits.`}
                  </span>
                )}
              </Label>
              <Textarea
                id="render-studio-prompt"
                value={extraPrompt}
                onChange={(event) => setExtraPrompt(event.target.value)}
                placeholder={t`Describe the change — e.g. remove the car in the foreground, change the wall colour to sage green, add soft afternoon light`}
                rows={2}
                className="mt-1 resize-none text-sm"
              />
            </div>
            <div className="col-span-3 flex flex-col justify-end gap-1">
              <span className="text-[10px] tracking-wider text-muted-foreground uppercase">
                {t`Step 3`}
              </span>
              <Button
                onClick={() => void onRender()}
                disabled={busy || !captureUrl || !extraPrompt.trim()}
                className="h-11 w-full font-semibold"
              >
                <Sparkles className="me-2 size-4" />
                {busy ? t`Rendering…` : t`Render v${nextVersion}`}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
