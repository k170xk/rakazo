import { ArrowUpRight, Eraser, Pencil, Square, Type, Undo2 } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { uploadImage, useAsset, useCanUpload } from "../sdk/index.js";
import { Button } from "./basic.js";
import { cn } from "./cn.js";
import { AssetImage } from "./media.js";
import { Dialog, toast } from "./overlay.js";

type Point = [number, number];
type Tool = "pen" | "arrow" | "box" | "text";
/** A mark in picture coordinates (0 to 1 across and down), so it draws at any size. */
type Mark = { tool: Tool; color: string; points: Point[]; text?: string };

const MARK_COLORS = ["#EF4444", "#FACC15", "#22C55E", "#3B82F6", "#FFFFFF", "#111827"];
const SIGNATURE_INK = "#111827";

function drawMarks(
  context: CanvasRenderingContext2D,
  marks: Mark[],
  width: number,
  height: number,
) {
  const unit = Math.max(width, height) / 400;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const mark of marks) {
    const points = mark.points.map(([x, y]) => [x * width, y * height] as Point);
    const first = points[0];
    if (!first) continue;
    context.strokeStyle = mark.color;
    context.fillStyle = mark.color;
    context.lineWidth = unit * (mark.tool === "pen" ? 2.2 : 2.6);
    if (mark.tool === "text") {
      const size = unit * 11;
      context.font = `600 ${size}px system-ui, sans-serif`;
      context.lineWidth = size / 5;
      context.strokeStyle = mark.color === "#111827" ? "#FFFFFF" : "#000000";
      context.strokeText(mark.text ?? "", first[0], first[1]);
      context.fillText(mark.text ?? "", first[0], first[1]);
      continue;
    }
    const last = points[points.length - 1] ?? first;
    context.beginPath();
    if (mark.tool === "box") {
      context.rect(first[0], first[1], last[0] - first[0], last[1] - first[1]);
    } else if (mark.tool === "arrow") {
      const angle = Math.atan2(last[1] - first[1], last[0] - first[0]);
      const head = unit * 9;
      context.moveTo(first[0], first[1]);
      context.lineTo(last[0], last[1]);
      context.moveTo(
        last[0] - head * Math.cos(angle - 0.45),
        last[1] - head * Math.sin(angle - 0.45),
      );
      context.lineTo(last[0], last[1]);
      context.lineTo(
        last[0] - head * Math.cos(angle + 0.45),
        last[1] - head * Math.sin(angle + 0.45),
      );
    } else {
      context.moveTo(first[0], first[1]);
      for (let i = 1; i < points.length - 1; i++) {
        const [x, y] = points[i]!;
        const [nx, ny] = points[i + 1]!;
        context.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
      }
      context.lineTo(last[0], last[1]);
    }
    context.stroke();
  }
}

function canvasFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(new File([blob], name, { type: "image/png" })) : reject()),
      "image/png",
    ),
  );
}

/** Pointer drawing on a canvas that keeps its marks in 0-1 coordinates. */
function useMarkCanvas(
  shape: { aspect: number } | { height: number },
  redraw: (context: CanvasRenderingContext2D, w: number, h: number) => void,
) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  // The canvas comes and goes (signing again, a dialog opening), so its box is watched afresh.
  const watched = useRef<{ element: Element; observer?: ResizeObserver } | null>(null);
  useLayoutEffect(() => {
    const element = canvas.current?.parentElement ?? null;
    if (element === (watched.current?.element ?? null)) return;
    watched.current?.observer?.disconnect();
    watched.current = null;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    watched.current = { element, ...(observer ? { observer } : {}) };
  });
  useEffect(() => () => watched.current?.observer?.disconnect(), []);
  const height = "height" in shape ? shape.height : Math.round(width / shape.aspect);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context || !width) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.round(width * ratio);
    element.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    redraw(context, width, height);
  });
  const at = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect();
    return [
      Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1),
      Math.min(Math.max((event.clientY - box.top) / box.height, 0), 1),
    ];
  };
  return { canvas, width, height, at };
}

/**
 * A signature box: sign with a finger, pen or mouse, then Save keeps it as a picture whose id
 * goes in an image column (and into a PDF signatures block as { asset: id }).
 */
export function SignaturePad({
  value,
  onChange,
  label = "Sign here",
  height = 170,
  disabled,
}: {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  label?: string;
  height?: number;
  disabled?: boolean;
}) {
  const canUpload = useCanUpload() && !disabled;
  const [signing, setSigning] = useState(!value);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [saving, setSaving] = useState(false);
  const { canvas, width, at } = useMarkCanvas({ height }, (context, w, h) =>
    drawMarks(context, marks, w, h),
  );

  if (value && !signing) {
    return (
      <div className="space-y-2">
        <div className="overflow-hidden rounded-xl border border-border bg-white p-2">
          <AssetImage asset={value} className="h-28 w-full object-contain" fit="contain" />
        </div>
        {canUpload && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setSigning(true)}>
              Sign again
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
              Remove
            </Button>
          </div>
        )}
      </div>
    );
  }
  if (!canUpload) return <p className="text-sm text-muted-foreground">Not signed</p>;

  const save = async () => {
    const out = document.createElement("canvas");
    out.width = 1200;
    out.height = Math.round((1200 * height) / Math.max(width, 1));
    const context = out.getContext("2d");
    if (!context) return;
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, out.width, out.height);
    drawMarks(context, marks, out.width, out.height);
    setSaving(true);
    try {
      onChange(await uploadImage(await canvasFile(out, "signature.png"), { longest: 1200 }));
      setMarks([]);
      setSigning(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The signature couldn't be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <div
        className="relative overflow-hidden rounded-xl border-2 border-dashed border-border bg-white"
        style={{ height }}
      >
        {!marks.length && (
          <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-neutral-400">
            {label}
          </span>
        )}
        <span className="pointer-events-none absolute right-6 bottom-8 left-6 border-b border-neutral-300" />
        <canvas
          ref={canvas}
          className="relative block touch-none"
          style={{ width: "100%", height }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setMarks((now) => [...now, { tool: "pen", color: SIGNATURE_INK, points: [at(event)] }]);
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const point = at(event);
            setMarks((now) => {
              const last = now[now.length - 1];
              if (!last) return now;
              return [...now.slice(0, -1), { ...last, points: [...last.points, point] }];
            });
          }}
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={save} loading={saving} disabled={!marks.length}>
          Save signature
        </Button>
        <Button
          size="sm"
          variant="outline"
          icon={<Eraser className="size-4" />}
          onClick={() => setMarks([])}
          disabled={!marks.length}
        >
          Clear
        </Button>
        {value && (
          <Button size="sm" variant="ghost" onClick={() => setSigning(false)}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

const TOOLS: Array<{ tool: Tool; label: string; icon: typeof Pencil }> = [
  { tool: "pen", label: "Draw", icon: Pencil },
  { tool: "arrow", label: "Arrow", icon: ArrowUpRight },
  { tool: "box", label: "Box", icon: Square },
  { tool: "text", label: "Text", icon: Type },
];

/**
 * Mark up a photo (draw, arrows, boxes, labels) in a dialog. Save keeps the marked-up copy as a
 * new picture and hands back its id; the original photo is left as it was.
 */
export function PhotoMarkup({
  photo,
  open,
  onClose,
  onSave,
  title = "Mark up photo",
}: {
  photo: string | null;
  open: boolean;
  onClose: () => void;
  onSave: (id: string) => void;
  title?: string;
}) {
  const url = useAsset(open ? photo : null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState(MARK_COLORS[0]!);
  const [typing, setTyping] = useState<{ at: Point; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMarks([]);
    setTyping(null);
    setImage(null);
    if (!url) return;
    const next = new Image();
    next.onload = () => setImage(next);
    next.src = url;
  }, [url]);

  const aspect = image ? image.naturalWidth / image.naturalHeight : 4 / 3;
  const { canvas, width, height, at } = useMarkCanvas({ aspect }, (context, w, h) => {
    if (image) context.drawImage(image, 0, 0, w, h);
    drawMarks(context, marks, w, h);
  });

  const commitText = () => {
    if (typing?.text.trim()) {
      setMarks((now) => [
        ...now,
        { tool: "text", color, points: [typing.at], text: typing.text.trim() },
      ]);
    }
    setTyping(null);
  };

  const save = async () => {
    if (!image) return;
    const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
    const out = document.createElement("canvas");
    out.width = Math.round(image.naturalWidth * scale);
    out.height = Math.round(image.naturalHeight * scale);
    const context = out.getContext("2d");
    if (!context) return;
    context.drawImage(image, 0, 0, out.width, out.height);
    drawMarks(context, marks, out.width, out.height);
    setSaving(true);
    try {
      onSave(await uploadImage(await canvasFile(out, "marked-up.png"), { longest: 2400 }));
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The marked-up photo couldn't be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={!image || !marks.length}>
            Save copy
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {TOOLS.map(({ tool: option, label, icon: Icon }) => (
            <button
              key={option}
              type="button"
              aria-label={label}
              title={label}
              aria-pressed={tool === option}
              onClick={() => setTool(option)}
              className={cn(
                "grid size-9 place-items-center rounded-lg border transition-colors [&_svg]:size-4",
                tool === option
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-muted",
              )}
            >
              <Icon />
            </button>
          ))}
          <span className="mx-1 h-6 w-px bg-border" />
          {MARK_COLORS.map((option) => (
            <button
              key={option}
              type="button"
              aria-label={`Colour ${option}`}
              aria-pressed={color === option}
              onClick={() => setColor(option)}
              className={cn(
                "size-7 rounded-full border border-black/15 transition-transform",
                color === option &&
                  "scale-110 ring-2 ring-primary ring-offset-2 ring-offset-background",
              )}
              style={{ background: option }}
            />
          ))}
          <span className="mx-1 h-6 w-px bg-border" />
          <Button
            size="sm"
            variant="outline"
            icon={<Undo2 className="size-4" />}
            onClick={() => setMarks((now) => now.slice(0, -1))}
            disabled={!marks.length}
          >
            Undo
          </Button>
        </div>
        <div
          className="relative w-full overflow-hidden rounded-xl bg-muted"
          style={{ minHeight: 200 }}
        >
          {!image && (
            <p className="p-8 text-center text-sm text-muted-foreground">Loading photo…</p>
          )}
          <canvas
            ref={canvas}
            className={cn("block touch-none", tool === "text" ? "cursor-text" : "cursor-crosshair")}
            style={{ width: "100%", height: image ? height : 0 }}
            onPointerDown={(event) => {
              if (!image) return;
              const point = at(event);
              if (tool === "text") {
                commitText();
                setTyping({ at: point, text: "" });
                return;
              }
              event.currentTarget.setPointerCapture(event.pointerId);
              setMarks((now) => [...now, { tool, color, points: [point, point] }]);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const point = at(event);
              setMarks((now) => {
                const last = now[now.length - 1];
                if (!last) return now;
                const points =
                  last.tool === "pen" ? [...last.points, point] : [last.points[0]!, point];
                return [...now.slice(0, -1), { ...last, points }];
              });
            }}
          />
          {typing && (
            <input
              autoFocus
              value={typing.text}
              placeholder="Type a label"
              onChange={(event) => setTyping({ ...typing, text: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitText();
                if (event.key === "Escape") setTyping(null);
              }}
              onBlur={commitText}
              className="absolute w-44 -translate-y-full rounded-md border border-border bg-background px-2 py-1 text-sm shadow-lg outline-none"
              style={{ left: typing.at[0] * width, top: typing.at[1] * height }}
            />
          )}
        </div>
      </div>
    </Dialog>
  );
}
