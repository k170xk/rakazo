/**
 * The host side of Evolve PDF Studio's workplace contract (js/core/host-brug.js in the app): the
 * framed app asks this page to open, save and list files over postMessage, and the studio answers
 * from the documents API. Only messages from that frame and this origin count, and replies go only
 * to it, so no other page or frame can read or save a file through it.
 */

import type { PdfAppContext } from "./context";
import { selectionCapture } from "./context";

/** Where the hosted bundle is served; built by infra/sandboxes/computer/ocsc/pdf-studio/build-app.sh. */
export const PDF_STUDIO_APP = "/pdf-studio/index.html";
/** A file the bundle always has, read to confirm it is installed before it is framed. */
const PDF_STUDIO_PROBE = "/pdf-studio/mcp-tools.json";

/** A refusal the app shows; `code` is one the contract names (alleen_lezen, te_groot, quotum…). */
export class PdfHostError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PdfHostError";
  }
}

/** A handler's answer; `transfer` moves the bytes to the frame instead of copying them. */
export type PdfHostAnswer = { value: unknown; transfer?: Transferable[] };

export type PdfHostRequest = { soort: string } & Record<string, unknown>;

export type PdfHostHandlers = Record<
  string,
  (request: PdfHostRequest) => Promise<PdfHostAnswer | unknown>
>;

function isAnswer(value: unknown): value is PdfHostAnswer {
  return Boolean(value) && typeof value === "object" && "value" in (value as object);
}

/** The app's request in `data`, or null when it is a reply or not a request at all. */
export function readRequest(data: unknown): (PdfHostRequest & { id: number }) | null {
  if (!data || typeof data !== "object") return null;
  const message = data as Record<string, unknown>;
  if (message.werkplek !== 1 || "antwoord" in message) return null;
  if (typeof message.id !== "number" || typeof message.soort !== "string") return null;
  return message as PdfHostRequest & { id: number };
}

/** Answers the framed app's requests until the returned function is called. */
export function attachPdfHost(options: {
  target: Window;
  frame: () => HTMLIFrameElement | null;
  handlers: PdfHostHandlers;
}): () => void {
  const { target, frame, handlers } = options;
  const origin = target.location.origin;
  const onMessage = async (event: MessageEvent) => {
    const source = frame()?.contentWindow;
    if (!source || event.source !== source || event.origin !== origin) return;
    const request = readRequest(event.data);
    if (!request) return;
    const reply = (fields: Record<string, unknown>, transfer: Transferable[] = []) =>
      source.postMessage({ werkplek: 1, antwoord: request.id, ...fields }, origin, transfer);
    const handler = Object.hasOwn(handlers, request.soort) ? handlers[request.soort] : undefined;
    if (!handler) {
      reply({ ok: false, fout: `Unknown request: ${request.soort}`, code: "onbekende_soort" });
      return;
    }
    try {
      const result = await handler(request);
      if (isAnswer(result)) reply({ ok: true, waarde: result.value ?? null }, result.transfer);
      else reply({ ok: true, waarde: result ?? null });
    } catch (error) {
      reply({
        ok: false,
        fout: error instanceof Error ? error.message : String(error),
        code: error instanceof PdfHostError ? error.code : "fout",
      });
    }
  };
  target.addEventListener("message", onMessage);
  return () => target.removeEventListener("message", onMessage);
}

export type PdfStudioTheme = "light" | "dark";

/**
 * The `#ouder=…&app=pdf&bestand=…` link that starts the bundle connected to this page; `thema`
 * gives it Evolve's light or dark mode before its first paint.
 */
export function pdfStudioSrc(origin: string, file: string, theme?: PdfStudioTheme): string {
  const hash = new URLSearchParams({ ouder: origin, app: "pdf", bestand: file });
  if (theme) hash.set("thema", theme);
  return `${PDF_STUDIO_APP}#${hash}`;
}

/** The app's side of the contract: `openaecHost` set up by its bridge (js/core/site-host.js). */
type FramedHost = Window & { Event: typeof Event; openaecHost?: { thema?: string } | null };

/**
 * Switches the running app to Evolve's mode. Only the theme on the bridge's own `openaecHost` is
 * changed: that object carries open and save, so it is never replaced. Before the bridge exists
 * the `thema` in the link applies.
 */
export function sendAppTheme(frame: HTMLIFrameElement | null, theme: PdfStudioTheme): boolean {
  const win = frame?.contentWindow as FramedHost | null;
  try {
    const host = win?.openaecHost;
    if (!win || !host || typeof host !== "object") return false;
    host.thema = theme;
    win.dispatchEvent(new win.Event("openaec-host-preferences"));
    return true;
  } catch {
    return false;
  }
}

let installed: Promise<boolean> | null = null;

/**
 * Whether this server serves the bundle. A missing bundle falls through to the app's own page,
 * which must never be framed in its place.
 */
export function pdfStudioInstalled(): Promise<boolean> {
  installed ??= fetch(PDF_STUDIO_PROBE, { credentials: "same-origin" })
    .then(async (response) => {
      if (!response.ok || !response.headers.get("content-type")?.includes("json")) return false;
      return Array.isArray(await response.json());
    })
    .catch(() => false)
    .then((ok) => {
      if (!ok) installed = null;
      return ok;
    });
  return installed;
}

/** The parts of `window.__OPDS_APP__` and the app's page the studio reads. */
type FramedApp = {
  __OPDS_APP__?: { run: (tool: string, input?: object) => Promise<unknown> };
  document: Document;
};

function framedApp(frame: HTMLIFrameElement | null) {
  return (frame?.contentWindow as unknown as FramedApp | null)?.__OPDS_APP__;
}

export type PdfAppState = {
  pageCount: number;
  currentPage: number | null;
  modified: boolean;
  selected: string[];
  /** Changes with every edit, so a save can wait until the person stops changing things. */
  revision: string | null;
  /** True while they drag, type in a box or have an editor open; a save then waits. */
  editing: boolean;
  /** The full view for the chat; null from an older app without `pdf_context`. */
  context: PdfAppContext | null;
};

/** The open tab's page, selection, view and unsaved state; null before a PDF is open. */
export async function readAppState(frame: HTMLIFrameElement | null): Promise<PdfAppState | null> {
  const app = framedApp(frame);
  if (!app) return null;
  const context = (await app.run("pdf_context").catch(() => null)) as
    | (PdfAppContext & { ok?: boolean })
    | null;
  if (context?.ok && context.page?.number) {
    return {
      pageCount: context.document?.pageCount ?? 0,
      currentPage: context.page.number,
      modified: Boolean(context.document?.modified),
      selected: (context.selected ?? []).map((markup) => String(markup.id)),
      revision: context.document?.revision ?? null,
      editing: Boolean(context.editing),
      context,
    };
  }
  const stand = (await app.run("pdf_stand").catch(() => null)) as {
    tabs?: {
      active?: boolean;
      pageCount?: number;
      currentPage?: number | null;
      modified?: boolean;
    }[];
    selectedAnnotations?: unknown[];
  } | null;
  const tab = stand?.tabs?.find((row) => row.active) ?? stand?.tabs?.[0];
  if (!tab) return null;
  return {
    pageCount: tab.pageCount ?? 0,
    currentPage: tab.currentPage ?? null,
    modified: Boolean(tab.modified),
    selected: (stand?.selectedAnnotations ?? []).map(String),
    revision: null,
    editing: false,
    context: null,
  };
}

/** A PNG of the selected markups or text with some room around them; null without a selection. */
export async function captureSelection(
  frame: HTMLIFrameElement | null,
  context: PdfAppContext | null,
): Promise<File | null> {
  const app = framedApp(frame);
  const region = selectionCapture(context);
  if (!app || !region) return null;
  const answer = (await app.run("pdf_capture_region", region).catch(() => null)) as {
    ok?: boolean;
    image_base64?: string;
  } | null;
  if (!answer?.ok || !answer.image_base64) return null;
  const binary = atob(answer.image_base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], "pdf-selection.png", { type: "image/png" });
}

/** Shows the whole page, as Bluebeam does when a drawing opens. */
export function fitAppPage(frame: HTMLIFrameElement | null): void {
  void framedApp(frame)?.run("pdf_fit_page").catch(() => null);
}

/** Presses the app's own Save button; false when it has none or it is off (read-only). */
export function pressAppSave(frame: HTMLIFrameElement | null): boolean {
  const page = (frame?.contentWindow as unknown as FramedApp | null)?.document;
  const button = page?.querySelector<HTMLButtonElement>(
    'button.quick-access-btn[title$="(Ctrl+S)"]',
  );
  if (!button || button.disabled) return false;
  button.click();
  return true;
}

const QUIET_SAVE_CLASS = "evolve-quiet-save";
const QUIET_SAVE_STYLE_ID = "evolve-quiet-save-style";
/** After this long a save shows the app's own progress box again, so a slow save never looks frozen. */
export const QUIET_SAVE_MS = 2000;

/**
 * Makes the app's "Saving PDF…" box invisible while an autosave runs; the returned function shows
 * it again. The box stays in place, transparent, because it is what stops a markup being drawn
 * mid-save: the app marks the document saved when the save ends, so that markup would be lost.
 */
export function hideAppSaveProgress(frame: HTMLIFrameElement | null): () => void {
  const page = (frame?.contentWindow as unknown as FramedApp | null)?.document;
  if (!page?.documentElement) return () => {};
  if (!page.getElementById(QUIET_SAVE_STYLE_ID)) {
    const style = page.createElement("style");
    style.id = QUIET_SAVE_STYLE_ID;
    style.textContent =
      `html.${QUIET_SAVE_CLASS} .loading-overlay{background:transparent!important;cursor:progress}` +
      `html.${QUIET_SAVE_CLASS} .loading-overlay>*{visibility:hidden!important}`;
    page.head.append(style);
  }
  const root = page.documentElement;
  root.classList.add(QUIET_SAVE_CLASS);
  const timer = window.setTimeout(() => root.classList.remove(QUIET_SAVE_CLASS), QUIET_SAVE_MS);
  return () => {
    window.clearTimeout(timer);
    // The app closes its box a moment after Evolve hears the save finished; showing it again
    // before then would flash it.
    const overlay = page.querySelector(".loading-overlay");
    if (!overlay?.classList.contains("visible")) {
      root.classList.remove(QUIET_SAVE_CLASS);
      return;
    }
    const done = () => {
      observer.disconnect();
      window.clearTimeout(cap);
      root.classList.remove(QUIET_SAVE_CLASS);
    };
    const observer = new MutationObserver(() => {
      if (!overlay.classList.contains("visible")) done();
    });
    observer.observe(overlay, { attributes: true, attributeFilter: ["class"] });
    const cap = window.setTimeout(done, QUIET_SAVE_MS);
  };
}
