import type { DocumentFormat } from "@rakazo/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

/** How many opens of each studio type show the welcome before it stops on its own. */
export const STUDIO_WELCOME_LIMIT = 10;

export type StudioWelcomeKind = DocumentFormat | "todo" | "apps" | "board";

type WelcomeStorage = Pick<Storage, "getItem" | "setItem">;

const OFF = "off";

export const studioWelcomeKey = (userId: string, kind: StudioWelcomeKind) =>
  `rakazo:studio-welcome:v1:${userId}:${kind}`;

function defaultStorage(): WelcomeStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Opens that have shown the welcome so far, or null once the person turned it off. */
export function readWelcomeOpens(
  userId: string,
  kind: StudioWelcomeKind,
  storage: WelcomeStorage | null = defaultStorage(),
): number | null {
  try {
    const saved = storage?.getItem(studioWelcomeKey(userId, kind)) ?? null;
    if (saved === OFF) return null;
    const opens = Number(saved);
    return Number.isInteger(opens) && opens > 0 ? opens : 0;
  } catch {
    return 0;
  }
}

/** Shows the welcome for this open when it is still due, and counts the open. */
export function claimWelcomeOpen(
  userId: string,
  kind: StudioWelcomeKind,
  storage: WelcomeStorage | null = defaultStorage(),
): boolean {
  const opens = readWelcomeOpens(userId, kind, storage);
  if (opens === null || opens >= STUDIO_WELCOME_LIMIT) return false;
  try {
    storage?.setItem(studioWelcomeKey(userId, kind), String(opens + 1));
  } catch {
    // Storage blocked: the welcome shows again next time, which is harmless.
  }
  return true;
}

export function turnOffWelcome(
  userId: string,
  kind: StudioWelcomeKind,
  storage: WelcomeStorage | null = defaultStorage(),
): void {
  try {
    storage?.setItem(studioWelcomeKey(userId, kind), OFF);
  } catch {
    // Storage blocked: nothing to remember it in.
  }
}

export type StudioWelcomeState = {
  open: boolean;
  close: () => void;
  dontShowAgain: () => void;
};

/**
 * Decides once per opened studio instance whether to show the welcome. An open while the
 * assistant is working is skipped and not counted, and a run that starts hides the welcome.
 */
export function useStudioWelcome({
  userId,
  kind,
  instanceId,
  ready,
  running,
  storage,
}: {
  userId: string | undefined;
  kind: StudioWelcomeKind;
  instanceId: string;
  /** The studio has mounted, so the welcome stacks over it. */
  ready: boolean;
  running: boolean;
  storage?: WelcomeStorage | null;
}): StudioWelcomeState {
  const [open, setOpen] = useState(false);
  const decided = useRef<string | null>(null);
  const openKey = `${kind}:${instanceId}`;

  useEffect(() => {
    if (!userId || !ready || decided.current === openKey) return;
    decided.current = openKey;
    setOpen(!running && claimWelcomeOpen(userId, kind, storage ?? defaultStorage()));
  }, [userId, ready, running, openKey, kind, storage]);

  useEffect(() => {
    if (running) setOpen(false);
  }, [running]);

  const close = useCallback(() => setOpen(false), []);
  const dontShowAgain = useCallback(() => {
    if (userId) turnOffWelcome(userId, kind, storage ?? defaultStorage());
    setOpen(false);
  }, [userId, kind, storage]);

  return { open, close, dontShowAgain };
}
