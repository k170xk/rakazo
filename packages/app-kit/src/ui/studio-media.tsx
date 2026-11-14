import {
  ArrowUpRight,
  Circle as CircleIcon,
  Download,
  Eraser,
  Expand,
  Highlighter,
  Maximize2,
  Minus,
  Pause,
  PenTool,
  Play,
  RotateCcw,
  RotateCw,
  Save,
  Square,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { PointerEvent as ReactPointerEvent, ReactNode, WheelEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { uploadImage, useAsset, useCanUpload } from "../sdk/index.js";
import { Button, Skeleton } from "./basic.js";
import { cn } from "./cn.js";
import { toast } from "./overlay.js";

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

const SPEEDS = [1, 1.25, 1.5, 2] as const;

/**
 * Sandboxed OCSC video player (`media-src data: blob:`) with custom scrubber, speed toggle,
 * poster support and clickable chapter timestamps for walkthroughs, briefings and inspections.
 */
export function VideoPlayer({
  asset,
  src,
  poster,
  title,
  chapters,
  autoPlay = false,
  loop = false,
  muted: initialMuted = false,
  className,
}: {
  asset?: string | null;
  src?: string | null;
  poster?: string | null;
  title?: ReactNode;
  chapters?: Array<{ time: number; label: string }>;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
  className?: string;
}) {
  const assetUrl = useAsset(asset);
  const posterUrl = useAsset(poster);
  const resolved = src ?? assetUrl;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(initialMuted);
  const [speedAt, setSpeedAt] = useState(0);

  const toggle = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  };

  const seek = (time: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(duration || time, time));
    setCurrent(el.currentTime);
  };

  const cycleSpeed = () => {
    const next = (speedAt + 1) % SPEEDS.length;
    setSpeedAt(next);
    if (videoRef.current) videoRef.current.playbackRate = SPEEDS[next]!;
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card",
        className,
      )}
    >
      <div className="group relative aspect-video w-full bg-black">
        {!resolved ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-white/70">
            <Play className="size-8 text-primary" />
            <span className="text-xs font-medium">
              {asset ? "Loading video…" : "Attach a video clip with app_asset"}
            </span>
          </div>
        ) : (
          <>
            {/* biome-ignore lint/a11y/useMediaCaption: user/agent clips inside sandbox carry no external VTT track */}
            <video
              ref={videoRef}
              src={resolved}
              poster={posterUrl ?? undefined}
              autoPlay={autoPlay}
              loop={loop}
              muted={muted}
              playsInline
              onClick={toggle}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
              className="h-full w-full cursor-pointer object-contain"
            />
            {!playing && (
              <button
                type="button"
                aria-label="Play video"
                onClick={toggle}
                className="absolute top-1/2 left-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-glow transition-transform duration-200 hover:scale-105"
              >
                <Play className="ml-0.5 size-6 fill-current" />
              </button>
            )}
            <div
              className="absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pt-8 pb-3 text-white"
              data-dense=""
            >
              <input
                type="range"
                aria-label="Seek video"
                min={0}
                max={duration || 100}
                step={0.1}
                value={current}
                onChange={(e) => seek(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer accent-[hsl(var(--primary))]"
              />
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={playing ? "Pause" : "Play"}
                    onClick={toggle}
                    className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-white/15"
                  >
                    {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                  </button>
                  <button
                    type="button"
                    aria-label={muted ? "Unmute" : "Mute"}
                    onClick={() => {
                      const next = !muted;
                      setMuted(next);
                      if (videoRef.current) videoRef.current.muted = next;
                    }}
                    className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-white/15"
                  >
                    {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                  </button>
                  <span className="font-medium tabular">
                    {clock(current)} / {clock(duration)}
                  </span>
                  {title && <span className="hidden truncate pl-2 text-white/80 sm:inline">{title}</span>}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={cycleSpeed}
                    className="rounded-md bg-white/15 px-2 py-1 font-semibold tabular hover:bg-white/25"
                  >
                    {SPEEDS[speedAt]}x
                  </button>
                  <button
                    type="button"
                    aria-label="Fullscreen"
                    onClick={() => void videoRef.current?.requestFullscreen?.().catch(() => {})}
                    className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-white/15"
                  >
                    <Maximize2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      {chapters && chapters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/70 px-3.5 py-2.5">
          {chapters.map((chapter) => {
            const active = current >= chapter.time && (!chapters.find((c) => c.time > chapter.time && current >= c.time));
            return (
              <button
                key={`${chapter.time}-${chapter.label}`}
                type="button"
                onClick={() => seek(chapter.time)}
                className={cn(
                  "inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
                  active
                    ? "bg-primary/15 text-primary ring-1 ring-inset ring-primary/30"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="tabular opacity-75">{clock(chapter.time)}</span>
                <span>{chapter.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Compact audio player for voice notes, site dictations and recorded briefings. */
export function AudioPlayer({
  asset,
  src,
  title,
  subtitle,
  className,
}: {
  asset?: string | null;
  src?: string | null;
  title?: ReactNode;
  subtitle?: ReactNode;
  className?: string;
}) {
  const assetUrl = useAsset(asset);
  const resolved = src ?? assetUrl;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const el = audioRef.current;
    if (!el || !resolved) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3.5 rounded-2xl border border-border/70 bg-card p-3.5 shadow-card",
        className,
      )}
    >
      {resolved && (
        // biome-ignore lint/a11y/useMediaCaption: short inline voice note player
        <audio
          ref={audioRef}
          src={resolved}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        />
      )}
      <button
        type="button"
        disabled={!resolved}
        aria-label={playing ? "Pause audio" : "Play audio"}
        onClick={toggle}
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform duration-150 hover:scale-105 disabled:opacity-40"
      >
        {playing ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4 fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        {(title || subtitle) && (
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            {title && <p className="truncate text-sm font-semibold">{title}</p>}
            {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
          </div>
        )}
        <div className="flex items-center gap-2.5">
          <input
            type="range"
            aria-label="Seek audio"
            min={0}
            max={duration || 100}
            step={0.1}
            value={current}
            disabled={!resolved}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (audioRef.current) audioRef.current.currentTime = next;
              setCurrent(next);
            }}
            className="h-1.5 flex-1 cursor-pointer accent-[hsl(var(--primary))]"
          />
          <span className="shrink-0 text-xs font-medium tabular text-muted-foreground">
            {clock(current)} / {clock(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Interactive pan, zoom (50%–500%) and 90°-rotate viewer for drawings, site photos and defects,
 * with optional multi-image filmstrip and fullscreen inspection mode.
 */
export function ImageViewer({
  asset,
  assets,
  initialIndex = 0,
  title,
  caption,
  height = 440,
  className,
}: {
  asset?: string | null;
  assets?: Array<{ id: string; title?: string; caption?: string }>;
  initialIndex?: number;
  title?: string;
  caption?: string;
  height?: number | string;
  className?: string;
}) {
  const list = useMemo(
    () => (assets?.length ? assets : asset ? [{ id: asset, title, caption }] : []),
    [assets, asset, title, caption],
  );
  const [index, setIndex] = useState(initialIndex);
  const current = list[index] ?? list[0] ?? null;
  const url = useAsset(current?.id);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const dragStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const reset = useCallback(() => {
    setScale(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    reset();
  }, [current?.id, reset]);

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey && scale === 1) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
    setScale((prev) => Math.min(5, Math.max(0.5, Number((prev * factor).toFixed(2)))));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scale <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    setOffset({
      x: dragStart.current.ox + (event.clientX - dragStart.current.x),
      y: dragStart.current.oy + (event.clientY - dragStart.current.y),
    });
  };

  const onPointerUp = () => {
    dragStart.current = null;
  };

  const stage = (full: boolean) => (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card",
        full && "fixed inset-4 z-[80] rounded-2xl shadow-2xl",
        className,
      )}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2"
        data-dense=""
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {current?.title ?? title ?? "Image viewer"}
          </p>
          {(current?.caption ?? caption) && (
            <p className="truncate text-xs text-muted-foreground">{current?.caption ?? caption}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Zoom out"
            onClick={() => setScale((s) => Math.max(0.5, Number((s - 0.25).toFixed(2))))}
          >
            <ZoomOut />
          </Button>
          <span className="w-12 text-center text-xs font-semibold tabular text-muted-foreground">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Zoom in"
            onClick={() => setScale((s) => Math.min(5, Number((s + 0.25).toFixed(2))))}
          >
            <ZoomIn />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Rotate 90 degrees"
            onClick={() => setRotation((r) => (r + 90) % 360)}
          >
            <RotateCw />
          </Button>
          <Button variant="ghost" size="sm" onClick={reset}>
            Reset
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={full ? "Exit fullscreen" : "Fullscreen"}
            onClick={() => setFullscreen(!full)}
          >
            <Expand />
          </Button>
        </div>
      </div>
      <div
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={full ? undefined : { height }}
        className={cn(
          "relative flex flex-1 items-center justify-center overflow-hidden bg-muted/40 bg-dots select-none",
          scale > 1 && "cursor-grab active:cursor-grabbing",
        )}
      >
        {!current ? (
          <p className="text-sm text-muted-foreground">No image selected</p>
        ) : !url ? (
          <Skeleton className="h-3/4 w-3/4 rounded-xl" />
        ) : (
          <img
            src={url}
            alt={current.title ?? ""}
            draggable={false}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`,
            }}
            className="max-h-full max-w-full object-contain transition-transform duration-150 ease-out"
          />
        )}
      </div>
      {list.length > 1 && (
        <div className="flex gap-2 overflow-x-auto border-t border-border/70 bg-card p-2.5">
          {list.map((item, i) => (
            <ViewerThumb
              key={`${item.id}-${i}`}
              id={item.id}
              active={i === index}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <>
      {stage(false)}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {fullscreen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[75] bg-black/70 backdrop-blur-xs"
                onClick={() => setFullscreen(false)}
              >
                <div onClick={(e) => e.stopPropagation()}>{stage(true)}</div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

function ViewerThumb({
  id,
  active,
  onClick,
}: {
  id: string;
  active: boolean;
  onClick: () => void;
}) {
  const url = useAsset(id);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "size-14 shrink-0 overflow-hidden rounded-lg border-2 transition-all",
        active ? "border-primary ring-2 ring-primary/25" : "border-transparent opacity-70 hover:opacity-100",
      )}
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="block h-full w-full bg-muted" />
      )}
    </button>
  );
}

type SketchTool = "pen" | "highlighter" | "line" | "arrow" | "rect" | "circle" | "eraser";
type SketchStroke = {
  tool: SketchTool;
  color: string;
  width: number;
  points: Array<[number, number]>;
};

const SKETCH_COLORS = [
  { name: "OCSC Green", value: "#76BF43" },
  { name: "Ink", value: "#1e293b" },
  { name: "Redline", value: "#dc2626" },
  { name: "Amber", value: "#d97706" },
  { name: "Teal", value: "#0d9488" },
] as const;

function drawStroke(ctx: CanvasRenderingContext2D, stroke: SketchStroke) {
  if (!stroke.points.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (stroke.tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0,0,0,1)";
    ctx.lineWidth = stroke.width * 4;
  } else if (stroke.tool === "highlighter") {
    ctx.globalAlpha = 0.32;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width * 4.5;
  } else {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
  }
  const [startX, startY] = stroke.points[0]!;
  const [endX, endY] = stroke.points[stroke.points.length - 1]!;

  if (stroke.tool === "pen" || stroke.tool === "highlighter" || stroke.tool === "eraser") {
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    for (const [x, y] of stroke.points.slice(1)) ctx.lineTo(x, y);
    ctx.stroke();
  } else if (stroke.tool === "line" || stroke.tool === "arrow") {
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    if (stroke.tool === "arrow") {
      const angle = Math.atan2(endY - startY, endX - startX);
      const head = Math.max(10, stroke.width * 3.5);
      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(endX - head * Math.cos(angle - Math.PI / 6), endY - head * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(endX, endY);
      ctx.lineTo(endX - head * Math.cos(angle + Math.PI / 6), endY - head * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    }
  } else if (stroke.tool === "rect") {
    ctx.strokeRect(startX, startY, endX - startX, endY - startY);
  } else if (stroke.tool === "circle") {
    const rx = Math.abs(endX - startX) / 2;
    const ry = Math.abs(endY - startY) / 2;
    ctx.beginPath();
    ctx.ellipse((startX + endX) / 2, (startY + endY) / 2, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Multi-tool engineering & site sketch pad with pen, highlighter, shapes, arrows, eraser,
 * dot/engineering grid or background photo, undo/redo, and one-click save to an app asset id.
 */
export function SketchPad({
  value,
  onChange,
  backgroundAsset,
  grid = "dots",
  height = 360,
  readOnly = false,
  label,
  className,
}: {
  /** Saved picture asset id (optional). */
  value?: string | null;
  /** Called with the uploaded picture asset id when Save sketch is clicked. */
  onChange?: (assetId: string) => void;
  /** Optional photo/drawing underlay to sketch over. */
  backgroundAsset?: string | null;
  grid?: "dots" | "grid" | "plain";
  height?: number;
  readOnly?: boolean;
  label?: ReactNode;
  className?: string;
}) {
  const canUpload = useCanUpload();
  const savedUrl = useAsset(value);
  const bgUrl = useAsset(backgroundAsset);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<SketchTool>("pen");
  const [color, setColor] = useState<string>(SKETCH_COLORS[0]!.value);
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [strokes, setStrokes] = useState<SketchStroke[]>([]);
  const [undone, setUndone] = useState<SketchStroke[]>([]);
  const [active, setActive] = useState<SketchStroke | null>(null);
  const [saving, setSaving] = useState(false);

  const redraw = useCallback(
    (list: SketchStroke[], current: SketchStroke | null) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const stroke of list) drawStroke(ctx, stroke);
      if (current) drawStroke(ctx, current);
    },
    [],
  );

  useEffect(() => {
    redraw(strokes, active);
  }, [strokes, active, redraw]);

  const pointOf = (event: ReactPointerEvent<HTMLCanvasElement>): [number, number] => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) / (rect.width || 1)) * canvas.width,
      ((event.clientY - rect.top) / (rect.height || 1)) * canvas.height,
    ];
  };

  const start = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (readOnly) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const pt = pointOf(event);
    setActive({ tool, color, width: strokeWidth, points: [pt, pt] });
  };

  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!active) return;
    const pt = pointOf(event);
    setActive((prev) =>
      prev
        ? {
            ...prev,
            points:
              prev.tool === "pen" || prev.tool === "highlighter" || prev.tool === "eraser"
                ? [...prev.points, pt]
                : [prev.points[0]!, pt],
          }
        : null,
    );
  };

  const finish = () => {
    if (!active) return;
    setStrokes((prev) => [...prev, active]);
    setUndone([]);
    setActive(null);
  };

  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !onChange) return;
    setSaving(true);
    try {
      const out = document.createElement("canvas");
      out.width = canvas.width;
      out.height = canvas.height;
      const ctx = out.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, out.width, out.height);
      if (bgUrl) {
        const img = new Image();
        img.src = bgUrl;
        await img.decode().catch(() => {});
        if (img.width) ctx.drawImage(img, 0, 0, out.width, out.height);
      }
      ctx.drawImage(canvas, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not export sketch.");
      const id = await uploadImage(new File([blob], "sketch.png", { type: "image/png" }));
      onChange(id);
      toast.success("Sketch saved");
    } catch (error) {
      toast.error("Couldn't save sketch", error instanceof Error ? error.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const tools: Array<{ id: SketchTool; label: string; icon: ReactNode }> = [
    { id: "pen", label: "Pen", icon: <PenTool className="size-4" /> },
    { id: "highlighter", label: "Highlight", icon: <Highlighter className="size-4" /> },
    { id: "line", label: "Line", icon: <Minus className="size-4 -rotate-45" /> },
    { id: "arrow", label: "Arrow", icon: <ArrowUpRight className="size-4" /> },
    { id: "rect", label: "Box", icon: <Square className="size-4" /> },
    { id: "circle", label: "Circle", icon: <CircleIcon className="size-4" /> },
    { id: "eraser", label: "Eraser", icon: <Eraser className="size-4" /> },
  ];

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card",
        className,
      )}
    >
      {!readOnly && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-2"
          data-dense=""
        >
          <div className="flex flex-wrap items-center gap-1">
            {label && <span className="mr-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</span>}
            {tools.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-label={item.label}
                title={item.label}
                aria-pressed={tool === item.id}
                onClick={() => setTool(item.id)}
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-lg transition-colors",
                  tool === item.id
                    ? "bg-primary/15 text-primary ring-1 ring-inset ring-primary/30"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item.icon}
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-border" />
            {SKETCH_COLORS.map((swatch) => (
              <button
                key={swatch.value}
                type="button"
                aria-label={swatch.name}
                title={swatch.name}
                onClick={() => setColor(swatch.value)}
                style={{ backgroundColor: swatch.value }}
                className={cn(
                  "size-6 rounded-full border-2 transition-transform",
                  color === swatch.value ? "scale-110 border-foreground" : "border-transparent opacity-80 hover:opacity-100",
                )}
              />
            ))}
            <span className="mx-1 h-5 w-px bg-border" />
            {([2, 4, 7] as const).map((w) => (
              <button
                key={w}
                type="button"
                aria-label={`Stroke ${w}px`}
                onClick={() => setStrokeWidth(w)}
                className={cn(
                  "inline-flex size-7 items-center justify-center rounded-md",
                  strokeWidth === w ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <span
                  className="rounded-full bg-foreground"
                  style={{ width: w + 3, height: w + 3 }}
                />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Undo"
              disabled={!strokes.length}
              onClick={() => {
                const last = strokes.at(-1);
                if (!last) return;
                setStrokes((s) => s.slice(0, -1));
                setUndone((u) => [...u, last]);
              }}
            >
              <Undo2 />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Redo"
              disabled={!undone.length}
              onClick={() => {
                const next = undone.at(-1);
                if (!next) return;
                setUndone((u) => u.slice(0, -1));
                setStrokes((s) => [...s, next]);
              }}
            >
              <RotateCcw className="-scale-x-100" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Clear sketch"
              disabled={!strokes.length}
              onClick={() => {
                setStrokes([]);
                setUndone([]);
              }}
            >
              <Trash2 />
            </Button>
            {onChange && canUpload && (
              <Button size="sm" icon={<Save />} loading={saving} onClick={() => void save()}>
                Save sketch
              </Button>
            )}
            {!onChange && strokes.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                icon={<Download />}
                onClick={() => {
                  const url = canvasRef.current?.toDataURL("image/png");
                  if (!url) return;
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "sketch.png";
                  a.click();
                }}
              >
                PNG
              </Button>
            )}
          </div>
        </div>
      )}
      <div
        style={{ height }}
        className={cn(
          "relative w-full overflow-hidden bg-surface",
          grid === "dots" && "bg-dots",
          grid === "grid" && "bg-grid",
        )}
      >
        {(bgUrl ?? (strokes.length === 0 ? savedUrl : null)) && (
          <img
            src={(bgUrl ?? savedUrl)!}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-90"
          />
        )}
        <canvas
          ref={canvasRef}
          width={1200}
          height={Math.round((height / 360) * 600)}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
          className={cn(
            "relative h-full w-full touch-none",
            !readOnly && "cursor-crosshair",
          )}
        />
      </div>
    </div>
  );
}

/**
 * Resizable two-pane workspace on wide screens (stacks cleanly on phones) — great for master/detail
 * registers, map + site list, or drawing viewer + inspection checklist.
 */
export function SplitPane({
  left,
  right,
  defaultRatio = 0.42,
  minRatio = 0.24,
  maxRatio = 0.76,
  className,
}: {
  left: ReactNode;
  right: ReactNode;
  defaultRatio?: number;
  minRatio?: number;
  maxRatio?: number;
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(defaultRatio);
  const dragging = useRef(false);

  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
  };
  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !boxRef.current) return;
    const rect = boxRef.current.getBoundingClientRect();
    const next = (event.clientX - rect.left) / (rect.width || 1);
    setRatio(Math.min(maxRatio, Math.max(minRatio, next)));
  };
  const onUp = () => {
    dragging.current = false;
  };

  return (
    <div
      ref={boxRef}
      style={{ ["--split-left" as string]: `${Math.round(ratio * 1000) / 10}%` }}
      className={cn(
        "flex flex-col gap-4 lg:grid lg:grid-cols-[var(--split-left)_12px_minmax(0,1fr)] lg:gap-0",
        className,
      )}
    >
      <div className="min-w-0">{left}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="group hidden cursor-col-resize items-center justify-center lg:flex"
      >
        <span className="h-12 w-1 rounded-full bg-border transition-colors group-hover:bg-primary" />
      </div>
      <div className="min-w-0">{right}</div>
    </div>
  );
}
