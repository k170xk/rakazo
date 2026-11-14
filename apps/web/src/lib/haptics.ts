/**
 * Haptic feedback in the iOS and Android apps, through the native Haptics plugin that the
 * Capacitor shell injects into the page. Browsers have no bridge, so every call is a no-op there.
 */

type HapticsBridge = {
  isPluginAvailable?: (name: string) => boolean;
  nativePromise?: (plugin: string, method: string, options?: object) => Promise<unknown>;
};

export type HapticKind = "tap" | "press" | "select" | "step" | "success" | "warning" | "error";

/** Thinking steps can arrive in bursts; a tick more often than this feels like buzzing. */
export const STEP_GAP_MS = 1_500;
/** Two haptics this close together blur into one, so the later one is dropped. */
const MIN_GAP_MS = 60;

const SELECTOR =
  '[role="switch"],[role="tab"],[role="checkbox"],[role="radio"],[role="option"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],input[type="checkbox"],input[type="radio"]';

const HAPTIC_EVENT = "rakazo:haptic";

let last = 0;
let lastStep = 0;
let selectionStarted = false;

function bridge(): HapticsBridge | undefined {
  const cap = (globalThis as { Capacitor?: HapticsBridge }).Capacitor;
  return cap?.isPluginAvailable?.("Haptics") ? cap : undefined;
}

function send(cap: HapticsBridge, method: string, options?: object) {
  void cap.nativePromise?.("Haptics", method, options)?.catch(() => undefined);
}

/** Plays one haptic; returns whether it was played. */
export function haptic(kind: HapticKind, now = Date.now()): boolean {
  const cap = bridge();
  if (!cap) return false;
  if (now - last < MIN_GAP_MS) return false;
  if (kind === "step") {
    if (now - lastStep < STEP_GAP_MS) return false;
    lastStep = now;
  }
  last = now;
  switch (kind) {
    case "tap":
      send(cap, "impact", { style: "LIGHT" });
      break;
    case "press":
      send(cap, "impact", { style: "MEDIUM" });
      break;
    case "select":
    case "step":
      // Both platforms ignore selectionChanged until a selection has started.
      if (!selectionStarted) {
        selectionStarted = true;
        send(cap, "selectionStart");
      }
      send(cap, "selectionChanged");
      break;
    case "success":
      send(cap, "notification", { type: "SUCCESS" });
      break;
    case "warning":
      send(cap, "notification", { type: "WARNING" });
      break;
    case "error":
      send(cap, "notification", { type: "ERROR" });
      break;
  }
  return true;
}

/** The haptic for a live event in the open chat, if it deserves one. */
export function eventHaptic(type: string): HapticKind | undefined {
  switch (type) {
    case "agent.tool.called":
      return "step";
    case "run.completed":
      return "success";
    case "run.waiting_input":
      return "warning";
    case "run.failed":
      return "error";
    default:
      return undefined;
  }
}

/** Plays the haptic for a new event in the chat on screen; history and background tabs stay still. */
export function chatEventHaptic(event: { type: string; seq: number }, cursor: number) {
  if (event.seq <= cursor || document.visibilityState !== "visible") return;
  const kind = eventHaptic(event.type);
  if (kind) haptic(kind);
}

function explicitHaptic(element: Element): HapticKind | undefined {
  const marked = element.closest("[data-haptic]");
  if (!marked || marked.getAttribute("aria-disabled") === "true" || marked.hasAttribute("disabled"))
    return undefined;
  const kind = marked.getAttribute("data-haptic");
  if (kind === "tap" || kind === "press" || kind === "select") return kind;
  return undefined;
}

/**
 * Ticks for switches, tabs, checkboxes, menus and pickers across the app, and for controls
 * marked `data-haptic`. A `rakazo:haptic` event covers gestures that are not clicks, such as
 * picking up a shape on the whiteboard. Returns a cleanup.
 */
export function installSelectionHaptics(doc: Document = document): () => void {
  if (!bridge()) return () => undefined;
  const onClick = (event: Event) => {
    if (!(event.target instanceof Element)) return;
    const marked = explicitHaptic(event.target);
    if (marked) {
      haptic(marked);
      return;
    }
    const target = event.target.closest(SELECTOR);
    if (target && target.getAttribute("aria-disabled") !== "true") haptic("select");
  };
  const onChange = (event: Event) => {
    if (event.target instanceof HTMLSelectElement) haptic("select");
  };
  const onSignal = (event: Event) => {
    const kind = (event as CustomEvent<unknown>).detail;
    if (kind === "tap" || kind === "press" || kind === "select") haptic(kind);
  };
  doc.addEventListener("click", onClick, true);
  doc.addEventListener("change", onChange, true);
  doc.defaultView?.addEventListener(HAPTIC_EVENT, onSignal);
  return () => {
    doc.removeEventListener("click", onClick, true);
    doc.removeEventListener("change", onChange, true);
    doc.defaultView?.removeEventListener(HAPTIC_EVENT, onSignal);
  };
}

export function resetHapticsForTest() {
  last = 0;
  lastStep = 0;
  selectionStarted = false;
}
