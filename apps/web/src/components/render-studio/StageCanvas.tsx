import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { cn } from "@rakazo/ui-web";
import type { MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent, Ref } from "react";
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { MaskPoint, MaskShape, StudioTool } from "./mask";

export interface StageCanvasHandle {
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  commitDraft: () => void;
  cancelDraft: () => void;
}

type Rect = { x: number; y: number; w: number; h: number };

const BG = "rgb(250, 250, 250)";
const CHECK_A = "rgb(241, 241, 243)";
const CHECK_B = "rgb(230, 230, 234)";
const ACTIVE_STROKE = "rgba(217, 119, 6, 0.95)";
const ACTIVE_FILL = "rgba(245, 158, 11, 0.22)";
const DONE = {
  capture: { stroke: "rgba(8, 145, 178, 0.95)", fill: "rgba(34, 211, 238, 0.18)" },
  render: { stroke: "rgba(37, 99, 235, 0.95)", fill: "rgba(59, 130, 246, 0.18)" },
};

/** One side of the studio: the picture with its mask shapes, drawn and edited on a canvas. */
export function StageCanvas({
  ref,
  imageUrl,
  shapes,
  onShapesChange,
  tool,
  editable,
  accent,
  brushRadius = 24,
  label,
  onImageSize,
}: {
  ref?: Ref<StageCanvasHandle>;
  imageUrl: string | null;
  shapes: MaskShape[];
  onShapesChange: (shapes: MaskShape[]) => void;
  tool: StudioTool;
  editable: boolean;
  accent: "capture" | "render";
  brushRadius?: number;
  label?: string;
  onImageSize?: (width: number, height: number) => void;
}) {
  const { t } = useLingui();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null);
  const [viewport, setViewport] = useState({ scale: 1, tx: 0, ty: 0 });
  const [cursor, setCursor] = useState<MaskPoint | null>(null);
  const [draftPolygon, setDraftPolygon] = useState<MaskPoint[] | null>(null);
  const [draftRect, setDraftRect] = useState<Rect | null>(null);
  const [draftBrush, setDraftBrush] = useState<MaskPoint[] | null>(null);
  const [panning, setPanning] = useState<{
    startX: number;
    startY: number;
    baseTx: number;
    baseTy: number;
  } | null>(null);
  const onImageSizeRef = useRef(onImageSize);
  onImageSizeRef.current = onImageSize;

  const fitToContainer = useCallback((size: { w: number; h: number }) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pad = 24;
    const scale = Math.max(
      Math.min((rect.width - pad) / size.w, (rect.height - pad) / size.h, 1),
      0.05,
    );
    setViewport({
      scale,
      tx: (rect.width - size.w * scale) / 2,
      ty: (rect.height - size.h * scale) / 2,
    });
  }, []);

  useEffect(() => {
    if (!imageUrl) {
      imageRef.current = null;
      setImageSize(null);
      return;
    }
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      const size = { w: image.naturalWidth, h: image.naturalHeight };
      setImageSize(size);
      onImageSizeRef.current?.(size.w, size.h);
      fitToContainer(size);
    };
    image.src = imageUrl;
  }, [imageUrl, fitToContainer]);

  const toScreen = (point: MaskPoint) => ({
    x: point.x * viewport.scale + viewport.tx,
    y: point.y * viewport.scale + viewport.ty,
  });
  const toImage = (point: MaskPoint) => ({
    x: (point.x - viewport.tx) / viewport.scale,
    y: (point.y - viewport.ty) / viewport.scale,
  });

  function commitPolygon(points: MaskPoint[]) {
    onShapesChange([...shapes, { type: "polygon", points }]);
  }

  function commitDraft() {
    if (draftPolygon && draftPolygon.length >= 3) commitPolygon(draftPolygon);
    if (draftRect) {
      const rect = normalizeRect(draftRect);
      if (rect.w > 2 && rect.h > 2) onShapesChange([...shapes, { type: "rect", ...rect }]);
    }
    if (draftBrush && draftBrush.length > 1) {
      onShapesChange([...shapes, { type: "brush", points: draftBrush, radius: brushRadius }]);
    }
    cancelDraft();
  }

  function cancelDraft() {
    setDraftPolygon(null);
    setDraftRect(null);
    setDraftBrush(null);
  }

  useImperativeHandle(ref, () => ({
    fit: () => {
      if (imageSize) fitToContainer(imageSize);
    },
    zoomIn: () => setViewport((view) => ({ ...view, scale: Math.min(view.scale * 1.2, 16) })),
    zoomOut: () => setViewport((view) => ({ ...view, scale: Math.max(view.scale / 1.2, 0.05) })),
    commitDraft,
    cancelDraft,
  }));

  useEffect(() => {
    draw();
  }, [
    imageSize,
    viewport,
    shapes,
    draftPolygon,
    draftRect,
    draftBrush,
    cursor,
    tool,
    editable,
    accent,
    brushRadius,
  ]);

  function draw() {
    const canvas = canvasRef.current;
    const rect = wrapRef.current?.getBoundingClientRect();
    const context = canvas?.getContext("2d");
    if (!canvas || !rect || !context) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = BG;
    context.fillRect(0, 0, rect.width, rect.height);
    const image = imageRef.current;
    if (!image || !imageSize) return;

    const width = imageSize.w * viewport.scale;
    const height = imageSize.h * viewport.scale;
    context.save();
    context.beginPath();
    context.rect(viewport.tx, viewport.ty, width, height);
    context.clip();
    for (let y = 0; y < height; y += 16) {
      for (let x = 0; x < width; x += 16) {
        context.fillStyle = (x / 16 + y / 16) % 2 === 0 ? CHECK_A : CHECK_B;
        context.fillRect(viewport.tx + x, viewport.ty + y, 16, 16);
      }
    }
    context.restore();
    context.drawImage(image, viewport.tx, viewport.ty, width, height);

    context.strokeStyle = DONE[accent].stroke;
    context.fillStyle = DONE[accent].fill;
    context.lineWidth = 1.5;
    for (const shape of shapes) drawShape(context, shape);

    context.strokeStyle = ACTIVE_STROKE;
    context.fillStyle = ACTIVE_FILL;
    context.lineWidth = 1.5;
    if (draftPolygon?.length) drawDraftPolygon(context, draftPolygon, rect);
    if (draftRect) drawShape(context, { type: "rect", ...draftRect });
    if (draftBrush?.length) {
      drawShape(context, { type: "brush", points: draftBrush, radius: brushRadius });
    }
    if (editable && tool === "brush" && cursor) {
      context.strokeStyle = ACTIVE_STROKE;
      context.fillStyle = "rgba(245, 158, 11, 0.15)";
      context.lineWidth = 1;
      context.beginPath();
      context.arc(cursor.x, cursor.y, brushRadius * viewport.scale, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }

  function tracePath(context: CanvasRenderingContext2D, points: readonly MaskPoint[]) {
    context.beginPath();
    points.forEach((point, index) => {
      const screen = toScreen(point);
      if (index === 0) context.moveTo(screen.x, screen.y);
      else context.lineTo(screen.x, screen.y);
    });
  }

  function drawShape(context: CanvasRenderingContext2D, shape: MaskShape) {
    if (shape.type === "polygon") {
      if (!shape.points.length) return;
      tracePath(context, shape.points);
      context.closePath();
      context.fill();
      context.stroke();
    } else if (shape.type === "rect") {
      const corner = toScreen({ x: shape.x, y: shape.y });
      context.beginPath();
      context.rect(corner.x, corner.y, shape.w * viewport.scale, shape.h * viewport.scale);
      context.fill();
      context.stroke();
    } else if (shape.points.length) {
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = shape.radius * 2 * viewport.scale;
      tracePath(context, shape.points);
      context.stroke();
    }
  }

  /** The lasso being drawn: hatched fill to the cursor, a rubber band and its vertices. */
  function drawDraftPolygon(context: CanvasRenderingContext2D, points: MaskPoint[], rect: DOMRect) {
    const preview = cursor && tool === "lasso" ? [...points, toImage(cursor)] : points;
    if (preview.length < 2) return;
    context.save();
    tracePath(context, preview);
    context.closePath();
    context.fillStyle = ACTIVE_FILL;
    context.fill();
    context.clip();
    context.strokeStyle = "rgba(217, 119, 6, 0.55)";
    context.lineWidth = 1;
    for (let x = -rect.height; x < rect.width; x += 8) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x + rect.height, rect.height);
      context.stroke();
    }
    context.restore();
    context.strokeStyle = ACTIVE_STROKE;
    context.lineWidth = 1.5;
    tracePath(context, points);
    context.stroke();
    const first = points[0];
    const last = points[points.length - 1];
    if (cursor && tool === "lasso" && first && last) {
      const lastScreen = toScreen(last);
      const firstScreen = toScreen(first);
      context.setLineDash([4, 4]);
      context.beginPath();
      context.moveTo(lastScreen.x, lastScreen.y);
      context.lineTo(cursor.x, cursor.y);
      context.lineTo(firstScreen.x, firstScreen.y);
      context.stroke();
      context.setLineDash([]);
    }
    for (const point of points) {
      const screen = toScreen(point);
      context.beginPath();
      context.arc(screen.x, screen.y, 3.5, 0, Math.PI * 2);
      context.fillStyle = ACTIVE_STROKE;
      context.fill();
    }
  }

  function screenPoint(event: ReactMouseEvent | ReactWheelEvent): MaskPoint {
    const rect = wrapRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }

  function onMouseDown(event: ReactMouseEvent) {
    const screen = screenPoint(event);
    const point = toImage(screen);
    if (event.button === 1 || event.shiftKey || tool === "pan" || !editable) {
      setPanning({ startX: screen.x, startY: screen.y, baseTx: viewport.tx, baseTy: viewport.ty });
      return;
    }
    if (tool === "lasso") {
      const first = draftPolygon?.[0];
      if (!draftPolygon || !first) {
        setDraftPolygon([point]);
        return;
      }
      const firstScreen = toScreen(first);
      if (
        draftPolygon.length >= 3 &&
        Math.hypot(firstScreen.x - screen.x, firstScreen.y - screen.y) < 10
      ) {
        commitPolygon(draftPolygon);
        setDraftPolygon(null);
      } else {
        setDraftPolygon([...draftPolygon, point]);
      }
    } else if (tool === "rect") {
      setDraftRect({ x: point.x, y: point.y, w: 0, h: 0 });
    } else if (tool === "brush") {
      setDraftBrush([point]);
    }
  }

  function onMouseMove(event: ReactMouseEvent) {
    const screen = screenPoint(event);
    setCursor(screen);
    if (panning) {
      setViewport((view) => ({
        ...view,
        tx: panning.baseTx + (screen.x - panning.startX),
        ty: panning.baseTy + (screen.y - panning.startY),
      }));
      return;
    }
    const point = toImage(screen);
    if (draftRect) {
      setDraftRect({ ...draftRect, w: point.x - draftRect.x, h: point.y - draftRect.y });
    } else if (draftBrush) {
      setDraftBrush([...draftBrush, point]);
    }
  }

  function onMouseUp() {
    if (panning) {
      setPanning(null);
      return;
    }
    if (draftRect) {
      const rect = normalizeRect(draftRect);
      if (rect.w > 2 && rect.h > 2) onShapesChange([...shapes, { type: "rect", ...rect }]);
      setDraftRect(null);
    } else if (draftBrush) {
      if (draftBrush.length > 1) {
        onShapesChange([...shapes, { type: "brush", points: draftBrush, radius: brushRadius }]);
      }
      setDraftBrush(null);
    }
  }

  function onWheel(event: ReactWheelEvent) {
    const screen = screenPoint(event);
    const before = toImage(screen);
    const scale = Math.max(0.05, Math.min(16, viewport.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
    setViewport({ scale, tx: screen.x - before.x * scale, ty: screen.y - before.y * scale });
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!editable) return;
      if (event.key === "Escape") {
        if (draftPolygon || draftRect || draftBrush) cancelDraft();
        else if (shapes.length) onShapesChange([]);
      } else if (event.key === "Enter" && draftPolygon && draftPolygon.length >= 3) {
        commitPolygon(draftPolygon);
        setDraftPolygon(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable, draftPolygon, draftRect, draftBrush, shapes]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => {
      if (imageSize) fitToContainer(imageSize);
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [imageSize, fitToContainer]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drawing masks is a pointer task; the toolbar covers the rest.
    <div
      ref={wrapRef}
      className={cn(
        "relative h-full w-full overflow-hidden select-none",
        editable &&
          "shadow-[inset_0_0_40px_rgba(245,158,11,0.15)] ring-2 ring-amber-400/70 ring-inset",
      )}
      style={{
        background: BG,
        cursor: !imageUrl ? "default" : tool === "pan" ? "grab" : "crosshair",
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => {
        setCursor(null);
        setPanning(null);
      }}
      onDoubleClick={() => {
        if (draftPolygon && draftPolygon.length >= 3) {
          commitPolygon(draftPolygon);
          setDraftPolygon(null);
        }
      }}
      onWheel={onWheel}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
      {label ? (
        <div className="absolute top-2 left-2 rounded bg-black/40 px-2 py-1 text-[10px] font-semibold tracking-wider text-white/80">
          {label}
        </div>
      ) : null}
      {editable && shapes.length > 0 ? (
        <div className="absolute bottom-2 left-2 rounded bg-black/50 px-2 py-1 text-[10px] text-amber-300">
          {plural(shapes.length, {
            one: "Mask active · # region · Render will target selection",
            other: "Mask active · # regions · Render will target selection",
          })}
        </div>
      ) : null}
      {!imageUrl ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-black/30">
          {t`No image`}
        </div>
      ) : null}
    </div>
  );
}

function normalizeRect(rect: Rect): Rect {
  return {
    x: rect.w < 0 ? rect.x + rect.w : rect.x,
    y: rect.h < 0 ? rect.y + rect.h : rect.y,
    w: Math.abs(rect.w),
    h: Math.abs(rect.h),
  };
}
