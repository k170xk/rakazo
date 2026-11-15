import type { CSSProperties, HTMLAttributes, PointerEvent } from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export type ColumnEdge = "start" | "end";

export type ColumnResizeOptions = {
  storageKey: string;
  cssVariable: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  /** Width left for the rest of the studio, so a column cannot cover the canvas. */
  minRemainder: number;
  /** The chat grows from its end edge; a panel on the other side grows from its start edge. */
  edge: ColumnEdge;
  /** Width already taken by the column on the other side. */
  reserved?: number;
};

const published = new Map<string, number>();
const listeners = new Set<() => void>();

function publishWidth(key: string, width: number) {
  if (published.get(key) === width) return;
  published.set(key, width);
  for (const listener of listeners) listener();
}

/** The live width of a column, including while its edge is being dragged. */
export function usePublishedColumnWidth(storageKey: string, fallback: number) {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => published.get(storageKey) ?? fallback,
    () => fallback,
  );
}

export function maximumColumnWidth(
  viewportWidth: number,
  options: Pick<ColumnResizeOptions, "minWidth" | "maxWidth" | "minRemainder"> & {
    reserved?: number;
  },
) {
  return Math.max(
    options.minWidth,
    Math.min(options.maxWidth, viewportWidth - options.minRemainder - (options.reserved ?? 0)),
  );
}

export function clampColumnWidth(
  width: number,
  viewportWidth: number,
  options: Pick<ColumnResizeOptions, "minWidth" | "maxWidth" | "minRemainder"> & {
    reserved?: number;
  },
) {
  return Math.round(
    Math.max(options.minWidth, Math.min(maximumColumnWidth(viewportWidth, options), width)),
  );
}

/** How far a drag moves the column. The start edge grows when the pointer moves toward the start. */
export function columnResizeDelta(
  startX: number,
  clientX: number,
  edge: ColumnEdge,
  textDirection: 1 | -1,
) {
  const sign = edge === "end" ? 1 : -1;
  return (clientX - startX) * textDirection * sign;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readWidth(options: ColumnResizeOptions) {
  try {
    const saved = Number(storage()?.getItem(options.storageKey));
    return Number.isFinite(saved) && saved >= options.minWidth
      ? clampColumnWidth(saved, Number.POSITIVE_INFINITY, options)
      : options.defaultWidth;
  } catch {
    return options.defaultWidth;
  }
}

function writeWidth(options: ColumnResizeOptions, width: number) {
  if (!Number.isFinite(width)) return;
  try {
    storage()?.setItem(
      options.storageKey,
      String(clampColumnWidth(width, Number.POSITIVE_INFINITY, options)),
    );
  } catch {
    // Keep resizing usable when storage is unavailable.
  }
}

function textDirection(): 1 | -1 {
  return document.documentElement.dir === "rtl" ? -1 : 1;
}

/** A vertical edge that remembers its column's width on this browser. */
export function useColumnResize(options: ColumnResizeOptions) {
  const reserved = options.reserved ?? 0;
  const limits = { ...options, reserved };
  const [preferredWidth, setPreferredWidth] = useState(() => readWidth(options));
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    width: number;
    direction: 1 | -1;
  } | null>(null);
  const width = clampColumnWidth(dragWidth ?? preferredWidth, viewportWidth, limits);

  useEffect(() => {
    publishWidth(options.storageKey, width);
  }, [options.storageKey, width]);

  useEffect(() => {
    function resize() {
      setViewportWidth(window.innerWidth);
    }
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  function commit(next: number) {
    const clamped = clampColumnWidth(next, window.innerWidth, {
      ...options,
      reserved,
    });
    setPreferredWidth(clamped);
    writeWidth(options, clamped);
  }

  function release(event: PointerEvent<HTMLElement>) {
    drag.current = null;
    setDragWidth(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function widthAt(clientX: number) {
    const current = drag.current;
    if (!current) return width;
    return clampColumnWidth(
      current.width + columnResizeDelta(current.startX, clientX, options.edge, current.direction),
      window.innerWidth,
      { ...options, reserved },
    );
  }

  const handleProps: HTMLAttributes<HTMLElement> = {
    role: "separator",
    tabIndex: 0,
    "aria-orientation": "vertical",
    "aria-valuemin": options.minWidth,
    "aria-valuemax": maximumColumnWidth(viewportWidth, limits),
    "aria-valuenow": width,
    onPointerDown(event) {
      if (event.button !== 0 || drag.current) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        width,
        direction: textDirection(),
      };
      setDragWidth(width);
    },
    onPointerMove(event) {
      if (drag.current?.pointerId !== event.pointerId) return;
      setDragWidth(widthAt(event.clientX));
    },
    onPointerUp(event) {
      if (drag.current?.pointerId !== event.pointerId) return;
      commit(widthAt(event.clientX));
      release(event);
    },
    onPointerCancel(event) {
      if (drag.current?.pointerId !== event.pointerId) return;
      release(event);
    },
    onLostPointerCapture() {
      if (!drag.current) return;
      drag.current = null;
      setDragWidth(null);
    },
    onKeyDown(event) {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const step = columnResizeDelta(
          0,
          event.key === "ArrowRight" ? 32 : -32,
          options.edge,
          textDirection(),
        );
        commit(width + step);
      } else if (event.key === "Home") {
        event.preventDefault();
        commit(options.minWidth);
      } else if (event.key === "End") {
        event.preventDefault();
        commit(maximumColumnWidth(window.innerWidth, { ...options, reserved }));
      }
    },
  };

  return {
    width,
    resizing: dragWidth !== null,
    handleProps,
    style: { [options.cssVariable]: `${width}px` } as CSSProperties,
  };
}

export const columnResizeHandleClass =
  "absolute inset-y-0 z-30 m-0 hidden h-full w-2 border-0 cursor-col-resize touch-none select-none hover:bg-sidebar-border focus-visible:bg-sidebar-border focus-visible:outline-none sm:block";
