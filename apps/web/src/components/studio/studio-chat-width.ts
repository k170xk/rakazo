import { BOTS_SIDEBAR_DEFAULT_WIDTH, BOTS_SIDEBAR_MIN_WIDTH } from "../../lib/bots-sidebar-pref";
import {
  clampColumnWidth,
  maximumColumnWidth,
  useColumnResize,
  usePublishedColumnWidth,
} from "./column-resize";

/** Studio chats open at the agents sidebar's default width. */
export const STUDIO_CHAT_DEFAULT_WIDTH = BOTS_SIDEBAR_DEFAULT_WIDTH;
export const STUDIO_CHAT_MIN_WIDTH = BOTS_SIDEBAR_MIN_WIDTH;
export const STUDIO_CHAT_MAX_WIDTH = 720;
/** The canvas beside the chat stays usable while the chat grows. */
const MIN_CANVAS_WIDTH = 360;
const STORAGE_KEY = "rakazo:studio-chat-width";

function chatLimits(reserved = 0) {
  return {
    minWidth: STUDIO_CHAT_MIN_WIDTH,
    maxWidth: STUDIO_CHAT_MAX_WIDTH,
    minRemainder: MIN_CANVAS_WIDTH,
    reserved,
  };
}

export function maximumStudioChatWidth(viewportWidth: number, reserved = 0): number {
  return maximumColumnWidth(viewportWidth, chatLimits(reserved));
}

export function clampStudioChatWidth(
  width: number,
  viewportWidth = Number.POSITIVE_INFINITY,
  reserved = 0,
) {
  return clampColumnWidth(width, viewportWidth, chatLimits(reserved));
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

/** One width for the App Studio, whiteboard, and to-do chats, remembered on this browser. */
/** The chat's current width, including while its edge is being dragged. */
export function usePublishedStudioChatWidth() {
  return usePublishedColumnWidth(STORAGE_KEY, STUDIO_CHAT_DEFAULT_WIDTH);
}

export function useStudioChatResize(reserved = 0) {
  return useColumnResize({
    storageKey: STORAGE_KEY,
    cssVariable: "--studio-chat-width",
    defaultWidth: STUDIO_CHAT_DEFAULT_WIDTH,
    minWidth: STUDIO_CHAT_MIN_WIDTH,
    maxWidth: STUDIO_CHAT_MAX_WIDTH,
    minRemainder: MIN_CANVAS_WIDTH,
    edge: "end",
    reserved,
  });
}
