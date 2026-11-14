import type { CSSProperties, HTMLAttributes, PointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { BOTS_SIDEBAR_DEFAULT_WIDTH, BOTS_SIDEBAR_MIN_WIDTH } from "../../lib/bots-sidebar-pref";

/** Studio chats open at the agents sidebar's default width. */
export const STUDIO_CHAT_DEFAULT_WIDTH = BOTS_SIDEBAR_DEFAULT_WIDTH;
export const STUDIO_CHAT_MIN_WIDTH = BOTS_SIDEBAR_MIN_WIDTH;
export const STUDIO_CHAT_MAX_WIDTH = 720;
/** The canvas beside the chat stays usable while the chat grows. */
const MIN_CANVAS_WIDTH = 360;
const STORAGE_KEY = "rakazo:studio-chat-width";

export function maximumStudioChatWidth(viewportWidth: number): number {
  return Math.max(
    STUDIO_CHAT_MIN_WIDTH,
    Math.min(STUDIO_CHAT_MAX_WIDTH, viewportWidth - MIN_CANVAS_WIDTH),
  );
}

export function clampStudioChatWidth(width: number, viewportWidth = Number.POSITIVE_INFINITY) {
  return Math.round(
    Math.max(STUDIO_CHAT_MIN_WIDTH, Math.min(maximumStudioChatWidth(viewportWidth), width)),
  );
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readStudioChatWidth(): number {
  try {
    const saved = Number(storage()?.getItem(STORAGE_KEY));
    return Number.isFinite(saved) && saved >= STUDIO_CHAT_MIN_WIDTH
      ? clampStudioChatWidth(saved)
      : STUDIO_CHAT_DEFAULT_WIDTH;
  } catch {
    return STUDIO_CHAT_DEFAULT_WIDTH;
  }
}

export function writeStudioChatWidth(width: number): void {
  if (!Number.isFinite(width)) return;
  try {
    storage()?.setItem(STORAGE_KEY, String(clampStudioChatWidth(width)));
  } catch {
    // Keep resizing usable when storage is unavailable.
  }
}

function direction() {
  return document.documentElement.dir === "rtl" ? -1 : 1;
}

/** One width for the App Studio, whiteboard, and to-do chats, remembered on this browser. */
export function useStudioChatResize() {
  const [preferredWidth, setPreferredWidth] = useState(readStudioChatWidth);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    width: number;
    direction: number;
  } | null>(null);
  const width = clampStudioChatWidth(dragWidth ?? preferredWidth, viewportWidth);

  useEffect(() => {
    function resize() {
      setViewportWidth(window.innerWidth);
    }
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  function commit(next: number) {
    const clamped = clampStudioChatWidth(next, window.innerWidth);
    setPreferredWidth(clamped);
    writeStudioChatWidth(clamped);
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
    return clampStudioChatWidth(
      current.width + (clientX - current.startX) * current.direction,
      window.innerWidth,
    );
  }

  const handleProps: HTMLAttributes<HTMLElement> = {
    role: "separator",
    tabIndex: 0,
    "aria-orientation": "vertical",
    "aria-valuemin": STUDIO_CHAT_MIN_WIDTH,
    "aria-valuemax": maximumStudioChatWidth(viewportWidth),
    "aria-valuenow": width,
    onPointerDown(event) {
      if (event.button !== 0 || drag.current) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        width,
        direction: direction(),
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
        const step = (event.key === "ArrowRight" ? 32 : -32) * direction();
        commit(width + step);
      } else if (event.key === "Home") {
        event.preventDefault();
        commit(STUDIO_CHAT_MIN_WIDTH);
      } else if (event.key === "End") {
        event.preventDefault();
        commit(maximumStudioChatWidth(window.innerWidth));
      }
    },
  };

  return {
    width,
    resizing: dragWidth !== null,
    handleProps,
    style: { "--studio-chat-width": `${width}px` } as CSSProperties,
  };
}
