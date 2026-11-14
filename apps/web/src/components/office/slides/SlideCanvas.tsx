import { useLingui } from "@lingui/react/macro";
import type { SlideData } from "@office-kit/pptx";
import { getShapeText } from "@office-kit/pptx";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Box, Deck, Handle } from "./deck";
import {
  canEditText,
  canMoveShape,
  findShape,
  HANDLES,
  movedBox,
  resizedBox,
  setShapeBox,
  setText,
  shapeBox,
} from "./deck";
import { slideSvg } from "./render";

export type ShapePick = { id: number; nested: boolean };

type Drag = {
  pointerId: number;
  handle: Handle | null;
  startX: number;
  startY: number;
  start: Box;
  moved: boolean;
};

const DRAG_THRESHOLD_PX = 3;

const handleClass: Record<Handle, string> = {
  nw: "-left-1.5 -top-1.5 cursor-nwse-resize",
  n: "left-1/2 -top-1.5 -translate-x-1/2 cursor-ns-resize",
  ne: "-right-1.5 -top-1.5 cursor-nesw-resize",
  e: "-right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize",
  se: "-right-1.5 -bottom-1.5 cursor-nwse-resize",
  s: "left-1/2 -bottom-1.5 -translate-x-1/2 cursor-ns-resize",
  sw: "-left-1.5 -bottom-1.5 cursor-nesw-resize",
  w: "-left-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize",
};

/** The slide being edited: its picture, the selected shape's frame, and typing over a text box. */
export function SlideCanvas({
  deck,
  slide,
  rev,
  readOnly,
  pick,
  zoom = 1,
  onPick,
  onChanged,
}: {
  deck: Deck;
  slide: SlideData;
  rev: number;
  readOnly: boolean;
  pick: ShapePick | null;
  /** Size relative to fitting the slide in the space; above 1 the slide scrolls. */
  zoom?: number;
  onPick: (pick: ShapePick | null) => void;
  /** A shape on this slide was moved, resized or retyped. */
  onChanged: () => void;
}) {
  const { t } = useLingui();
  const outer = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<Box | null>(null);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);

  const svg = useMemo(() => slideSvg(deck, slide), [deck, slide, rev]);

  useLayoutEffect(() => {
    const el = outer.current;
    if (!el) return;
    const measure = () => {
      const scale = Math.min(el.clientWidth / deck.width, el.clientHeight / deck.height) * zoom;
      setFit({ w: Math.floor(deck.width * scale), h: Math.floor(deck.height * scale) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [deck, zoom]);

  // A new slide, a reload or the studio locking ends any edit under way.
  useEffect(() => {
    setEditing(null);
    setDrag(null);
    setPreview(null);
  }, [slide, deck, readOnly]);

  const shape = pick ? findShape(slide, pick.id) : null;
  const box = shape ? shapeBox(deck, shape) : null;
  const movable = !readOnly && shape !== null && pick !== null && canMoveShape(shape, pick.nested);
  const shown = preview ?? box;
  const perEmu = fit.w > 0 ? fit.w / deck.width : 0;
  const toPx = (b: Box) => ({
    left: b.x * perEmu,
    top: b.y * perEmu,
    width: Math.max(b.w * perEmu, 2),
    height: Math.max(b.h * perEmu, 2),
  });

  function startEditing(id: number) {
    const target = findShape(slide, id);
    if (readOnly || !target || !canEditText(target)) return;
    setEditing({ id, text: getShapeText(target) });
  }

  function commitText() {
    const now = editing;
    setEditing(null);
    if (!now || readOnly) return;
    const target = findShape(slide, now.id);
    if (!target || getShapeText(target) === now.text) return;
    setText(target, now.text);
    onChanged();
  }

  function pickAt(target: EventTarget | null): ShapePick | null {
    const el = target instanceof Element ? target.closest("[data-pptx-shape-id]") : null;
    const id = Number(el?.getAttribute("data-pptx-shape-id"));
    if (!el || !Number.isFinite(id)) return null;
    const parent = el.parentElement?.closest("[data-pptx-shape-id]") ?? null;
    return { id, nested: parent !== null && outer.current?.contains(parent) === true };
  }

  function onSlideClick(event: ReactMouseEvent) {
    if (editing) {
      commitText();
      return;
    }
    const next = pickAt(event.target);
    if (next && pick && next.id === pick.id && !movable) startEditing(next.id);
    else onPick(next);
  }

  function beginDrag(event: ReactPointerEvent, handle: Handle | null) {
    if (!movable || !box || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    setDrag({
      pointerId: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      start: box,
      moved: false,
    });
  }

  function moveDrag(event: ReactPointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId || perEmu === 0) return;
    const px = event.clientX - drag.startX;
    const py = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(px, py) < DRAG_THRESHOLD_PX) return;
    if (!drag.moved) setDrag({ ...drag, moved: true });
    const dx = px / perEmu;
    const dy = py / perEmu;
    setPreview(
      drag.handle
        ? resizedBox(drag.start, drag.handle, dx, dy)
        : movedBox(drag.start, dx, dy, deck),
    );
  }

  function endDrag(event: ReactPointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const result = preview;
    setDrag(null);
    setPreview(null);
    if (!drag.moved) {
      if (!drag.handle && pick) startEditing(pick.id);
      return;
    }
    if (shape && result) {
      setShapeBox(shape, result);
      onChanged();
    }
  }

  const editBox = editing
    ? (() => {
        const target = findShape(slide, editing.id);
        return target ? shapeBox(deck, target) : null;
      })()
    : null;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: clicking beside the slide only clears the selection.
    // biome-ignore lint/a11y/noStaticElementInteractions: see above.
    <div
      ref={outer}
      className={`relative grid size-full min-h-0 min-w-0 place-items-[safe_center] ${
        zoom > 1 ? "overflow-auto" : ""
      }`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onPick(null);
      }}
    >
      <div
        className="relative bg-white shadow-sm ring-1 ring-border"
        style={{ width: fit.w, height: fit.h }}
        data-testid="slides-canvas"
      >
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: shapes are also reachable from the text editor and the slide rail. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the slide picture is drawn from the file. */}
        <div
          className={`size-full overflow-hidden [&>svg]:block [&>svg]:size-full ${
            readOnly ? "" : "cursor-default"
          }`}
          onClick={onSlideClick}
          onDoubleClick={(event) => {
            const next = pickAt(event.target);
            if (next) startEditing(next.id);
          }}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: the SVG is drawn locally from the deck, with no scripts.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        {shown && !editing ? (
          <div
            className={`absolute border-2 border-primary ${
              movable ? "cursor-move" : "pointer-events-none border-dashed"
            }`}
            style={toPx(shown)}
            onPointerDown={(event) => beginDrag(event, null)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={() => {
              setDrag(null);
              setPreview(null);
            }}
            data-testid="slides-selection"
          >
            {movable
              ? HANDLES.map((handle) => (
                  <span
                    key={handle}
                    className={`absolute size-3 rounded-sm border border-primary bg-background ${handleClass[handle]}`}
                    onPointerDown={(event) => beginDrag(event, handle)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                  />
                ))
              : null}
          </div>
        ) : null}
        {editing && editBox ? (
          <textarea
            // biome-ignore lint/a11y/noAutofocus: typing starts where the person clicked.
            autoFocus
            aria-label={t`Text box`}
            data-testid="slides-text-editor"
            value={editing.text}
            onChange={(event) => setEditing({ ...editing, text: event.target.value })}
            onBlur={commitText}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setEditing(null);
              } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                commitText();
              }
            }}
            className="absolute resize-none rounded-sm bg-background/95 p-1 text-[14px] leading-snug text-foreground shadow-md outline-none ring-2 ring-primary"
            style={{
              ...toPx(editBox),
              minWidth: 160,
              minHeight: 48,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
