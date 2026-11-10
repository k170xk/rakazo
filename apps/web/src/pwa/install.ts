import { isStandalone } from "./standalone";

/** Chrome and Edge's install prompt, held until the person clicks Install. */
export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** Sent to the page framing the app, and the reply that says it can open the app on its own. */
export const FRAME_HELLO = "ocsc-intelligence:hello";
export const FRAME_HOST = "ocsc-intelligence:host";
export const FRAME_OPEN_STANDALONE = "ocsc-intelligence:open-standalone";

/**
 * What the banner offers: open the app outside the page framing it, install it through the
 * browser's prompt, or say where the browser keeps its own install command.
 */
export type InstallOffer = "open-standalone" | "prompt" | "ios" | "safari-mac" | null;

type InstallHost = Pick<Window, "document" | "matchMedia" | "addEventListener"> & {
  navigator: Navigator & { standalone?: boolean };
  self: unknown;
  top: unknown;
  rakazoDesktop?: unknown;
};

let held: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

/** Registered before React mounts, as Chrome may fire beforeinstallprompt straight after load. */
export function captureInstallPrompt(target: InstallHost = window): void {
  target.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    held = event as InstallPromptEvent;
    notify();
  });
  target.addEventListener("appinstalled", () => {
    held = null;
    installed = true;
    notify();
  });
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function heldInstallPrompt(): InstallPromptEvent | null {
  return installed ? null : held;
}

/** Shows the browser's install prompt; true when the person installed the app. */
export async function promptInstall(): Promise<boolean> {
  const event = held;
  if (!event) return false;
  held = null;
  notify();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === "accepted";
}

export function inFrame(target: { self: unknown; top: unknown } = window): boolean {
  try {
    return target.self !== target.top;
  } catch {
    return true;
  }
}

export function installOffer(target: InstallHost, prompt: InstallPromptEvent | null): InstallOffer {
  if (target.rakazoDesktop || isStandalone(target)) return null;
  if (inFrame(target)) return "open-standalone";
  if (prompt) return "prompt";
  const agent = target.navigator.userAgent;
  const apple =
    /iPhone|iPad|iPod/.test(agent) ||
    (/Macintosh/.test(agent) && target.navigator.maxTouchPoints > 1);
  const safari = /Safari\//.test(agent) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\//.test(agent);
  if (apple && safari) return "ios";
  // Safari 17 on macOS adds web apps to the Dock from its File menu.
  const version = Number(/Version\/(\d+)/.exec(agent)?.[1] ?? 0);
  if (/Macintosh/.test(agent) && safari && version >= 17) return "safari-mac";
  return null;
}

const DISMISSED_KEY = "ocsc-install-offer-dismissed";
/** A dismissed offer comes back after this long, in case the person changes their mind. */
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000;

export function offerDismissed(
  offer: Exclude<InstallOffer, null>,
  storage: Pick<Storage, "getItem"> = localStorage,
  now = Date.now(),
): boolean {
  try {
    const at = Number(storage.getItem(`${DISMISSED_KEY}:${offer}`));
    return Number.isFinite(at) && at > 0 && now - at < DISMISS_MS;
  } catch {
    return false;
  }
}

export function dismissOffer(
  offer: Exclude<InstallOffer, null>,
  storage: Pick<Storage, "setItem"> = localStorage,
  now = Date.now(),
): void {
  try {
    storage.setItem(`${DISMISSED_KEY}:${offer}`, String(now));
  } catch {
    // Private windows may refuse storage; the offer then just shows again next visit.
  }
}
