import { PDF_LIMITS } from "@rakazo/app-kit/pdf";
import type {
  AppFocus,
  AppInit,
  AppLive,
  AppLocation,
  AppPickMessage,
  AppRequestMessage,
} from "@rakazo/app-kit/protocol";
import {
  APP_CALL_OPS,
  APP_COMMENT_OPS,
  APP_EVENT,
  APP_GESTURE_OPS,
  APP_MAPS_PATH,
  APP_PICK,
  APP_RESPONSE,
  APP_WRITE_OPS,
  MAX_UPLOAD_BASE64,
  readAppRequest,
  requestRef,
  UPLOAD_MIMES,
} from "@rakazo/app-kit/protocol";
import { useExternalLinkOpener } from "@rakazo/chat-ui/web";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { AppSource } from "../../lib/app-host";
import { downloadName, saveFile } from "../../lib/app-host";
import { appLocationDecision, appWriteDecision } from "../../lib/app-write-rule";
import { readTheme, subscribeTheme } from "../../lib/pages";
import { SandboxedHtmlViewer } from "../SandboxedHtmlViewer";

/** How often an open app asks whether its data changed elsewhere. */
const POLL_MS = 3000;
/** How often a copy that takes deltas checks, which also keeps the viewer's presence fresh. */
const LIVE_POLL_MS = 2000;
/** Files an app may hand the person, each with the endings it may be saved under; nothing that would run when opened. */
const DOWNLOAD_TYPES = new Map<string, readonly string[]>([
  ["text/csv", ["csv"]],
  ["text/plain", ["txt", "log"]],
  ["text/markdown", ["md", "markdown"]],
  ["application/json", ["json"]],
  ["text/calendar", ["ics"]],
]);
const MAX_DOWNLOAD = 5_000_000;

export type AppPick = { loc: string; tag: string; text: string };

/** A visual edit shown in the running app before it is saved. */
export type AppPatch = {
  loc: string;
  remove: string[];
  add: string[];
  texts: Array<{ from: string; to: string }>;
};

/**
 * An app built by the App Studio, in the same sandboxed viewer as pages. The app has no network:
 * it asks this host for its tables, saves and pictures, and the host answers through `source` as
 * the person looking. Writes are refused unless that person may edit; downloads, exports and links
 * need a click inside the frame first, each click usable once. For a colleague, the app saves only
 * while they are using it and removes rows only just after a click, so opening it changes nothing.
 */
export function AppFrame({
  document: html,
  title,
  app,
  source,
  picking = false,
  onPick,
  onProblem,
  onChange,
  refreshSignal,
  onReady,
  maps = false,
  patch = null,
  selectedLoc = null,
}: {
  document: string;
  title: string;
  app: { id: string; version: number };
  source: AppSource;
  /** The Studio's element picker: clicks select a source line instead of acting. */
  picking?: boolean;
  onPick?: (pick: AppPick) => void;
  /** An error the app threw while running, for the Studio to show and offer to fix. */
  onProblem?: (message: string) => void;
  /** The app's data changed (here or elsewhere). */
  onChange?: (revision: number) => void;
  /** Changes whenever the host learns the data moved on, so the app reads it at once. */
  refreshSignal?: number;
  /** The app answered its first request, so it has drawn. */
  onReady?: () => void;
  /** Map tiles and place search, for a signed-in viewer (the server refuses anyone else). */
  maps?: boolean;
  /** A visual edit to show at once, before it is saved. */
  patch?: AppPatch | null;
  /** The element the Studio is editing, outlined in the app. */
  selectedLoc?: string | null;
}) {
  const { open, dialog } = useExternalLinkOpener();
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "dark" as const);
  const post = useRef<((message: object) => void) | null>(null);
  const known = useRef<{
    revision: number;
    canEdit: boolean;
    colleague: boolean;
    /** The workspace open when the app last started; null without workspaces or for "all". */
    workspace: string | null;
  } | null>(null);
  /** The app's kit understands delta and presence events (it said so in init). */
  const takesDeltas = useRef(false);
  /** The row the viewer has open, sent with each live check. */
  const focus = useRef<AppFocus | null>(null);
  /**
   * Set once an app shows someone other than its owner Evolve data. The owner wrote the app, so
   * from then on it may not save, comment, share presence or open links as them: nothing they
   * could see in Evolve can leave through the app.
   */
  const sawEvolve = useRef(false);
  const liveBroken = useRef(false);
  const clickedAt = useRef(0);
  const sharedLocation = useRef(false);
  const usedGesture = useRef<string | null>(null);
  const ready = useRef(false);
  const latest = useRef({
    source,
    onPick,
    onProblem,
    onChange,
    onReady,
    title,
    app,
    theme,
    picking,
    maps,
  });
  latest.current = {
    source,
    onPick,
    onProblem,
    onChange,
    onReady,
    title,
    app,
    theme,
    picking,
    maps,
  };

  const reload = useCallback(async () => {
    const data = await latest.current.source.load().catch(() => null);
    if (!data || !post.current) return;
    const workspace = data.workspace?.current?.id ?? null;
    if (known.current && workspace !== known.current.workspace) {
      known.current = { ...known.current, workspace };
      post.current({ type: APP_EVENT, event: "workspace" });
      return;
    }
    known.current = {
      revision: data.revision,
      canEdit: data.viewer.canEdit,
      colleague: isColleague(data.viewer.role),
      workspace,
    };
    post.current({
      type: APP_EVENT,
      event: "tables",
      revision: data.revision,
      tables: data.tables,
      ...(data.icon ? { icon: data.icon } : {}),
    });
    latest.current.onChange?.(data.revision);
  }, []);

  /** A live check: who is here and what changed, sent to the app as a delta when it takes them. */
  const checkLive = useCallback(async (): Promise<boolean> => {
    const current = known.current;
    const call = latest.current.source.call;
    if (!current || !post.current || !call || liveBroken.current) return false;
    let live: AppLive;
    try {
      live = (await call({
        op: "live",
        since: current.revision,
        focus: sawEvolve.current ? null : focus.current,
      })) as AppLive;
    } catch (error) {
      // An older server without the route: go back to reading everything on a timer.
      if (error instanceof Error && /\b404\b|Not found/.test(error.message))
        liveBroken.current = true;
      return liveBroken.current ? false : true;
    }
    if (!post.current || known.current !== current) return true;
    if (live.workspace !== undefined && live.workspace !== current.workspace) {
      known.current = { ...current, workspace: live.workspace };
      post.current({ type: APP_EVENT, event: "workspace" });
      return true;
    }
    post.current({ type: APP_EVENT, event: "presence", people: live.presence });
    if (live.revision === current.revision) return true;
    if (live.full || !live.delta || !takesDeltas.current) {
      await reload();
      return true;
    }
    known.current = { ...current, revision: live.revision };
    post.current({ type: APP_EVENT, event: "delta", delta: live.delta });
    latest.current.onChange?.(live.revision);
    return true;
  }, [reload]);

  const refresh = useCallback(async () => {
    const current = known.current;
    if (!current || !post.current) return;
    if (await checkLive()) return;
    const revision = await latest.current.source.revision().catch(() => current.revision);
    if (revision === current.revision) return;
    await reload();
  }, [checkLive, reload]);

  useEffect(() => {
    let checking = false;
    const live = Boolean(source.call);
    const timer = setInterval(
      () => {
        if (checking || document.visibilityState !== "visible") return;
        checking = true;
        void refresh().finally(() => {
          checking = false;
        });
      },
      live ? LIVE_POLL_MS : POLL_MS,
    );
    return () => clearInterval(timer);
  }, [refresh, source.call]);
  useEffect(() => {
    if (refreshSignal !== undefined) void refresh();
  }, [refreshSignal, refresh]);
  useEffect(() => {
    post.current?.({ type: APP_EVENT, event: "theme", theme });
  }, [theme]);
  useEffect(() => {
    post.current?.({ type: APP_EVENT, event: "select", enabled: picking });
  }, [picking]);
  useEffect(() => {
    if (patch) post.current?.({ type: APP_EVENT, event: "patch", ...patch });
  }, [patch]);
  useEffect(() => {
    post.current?.({ type: APP_EVENT, event: "selected", loc: selectedLoc });
  }, [selectedLoc]);

  const handle = useCallback(
    async (request: AppRequestMessage, gesture: unknown, focused: boolean): Promise<unknown> => {
      const { source } = latest.current;
      if (typeof gesture === "string" && focused) clickedAt.current = Date.now();
      const decision = appWriteDecision({
        op: request.op,
        canEdit: known.current?.canEdit === true,
        colleague: known.current?.colleague === true,
        focused,
        msSinceClick: Date.now() - clickedAt.current,
      });
      if (decision === "skip") return false;
      if (decision !== "ok") throw new Error(decision);
      if (
        sawEvolve.current &&
        (APP_WRITE_OPS.has(request.op) || APP_COMMENT_OPS.has(request.op) || request.op === "open")
      ) {
        if (request.op === "state.set") return false;
        throw new Error(
          "This app showed you Evolve data, so it can't save, comment or open links this time. Reopen it to make changes.",
        );
      }
      if (APP_GESTURE_OPS.has(request.op)) {
        if (!focused || typeof gesture !== "string" || gesture === usedGesture.current) {
          throw new Error("Click the button again to do that.");
        }
        usedGesture.current = gesture;
      }
      switch (request.op) {
        case "init": {
          takesDeltas.current = Array.isArray(request.accepts) && request.accepts.includes("delta");
          const data = await source.load();
          known.current = {
            revision: data.revision,
            canEdit: data.viewer.canEdit,
            colleague: isColleague(data.viewer.role),
            workspace: data.workspace?.current?.id ?? null,
          };
          const init: AppInit = {
            app: {
              id: latest.current.app.id,
              title: latest.current.title,
              version: latest.current.app.version,
              ...(data.icon ? { icon: data.icon } : {}),
            },
            viewer: data.viewer,
            theme: latest.current.theme,
            tables: data.tables as AppInit["tables"],
            state: data.state,
            revision: data.revision,
            ...(data.workspace ? { workspace: data.workspace } : {}),
            features: [
              "export",
              "assets",
              "pdf",
              ...("geolocation" in navigator ? ["location"] : []),
              ...(data.viewer.canEdit ? ["uploads"] : []),
              ...(source.ask ? ["ai"] : []),
              ...(latest.current.maps ? ["maps"] : []),
              ...(source.call
                ? [
                    "live",
                    "query",
                    ...(data.viewer.role === "visitor"
                      ? []
                      : ["comments", "history", "services", "evolve"]),
                  ]
                : []),
            ],
          };
          if (latest.current.picking) {
            queueMicrotask(() =>
              post.current?.({ type: APP_EVENT, event: "select", enabled: true }),
            );
          }
          return init;
        }
        case "rows.insert":
          return source.insert(String(request.table), objectOf(request.row));
        case "rows.update":
          return source.update(String(request.table), requestRef(request), objectOf(request.patch));
        case "rows.remove":
          await source.remove(String(request.table), requestRef(request));
          return null;
        case "state.set":
          return source.setState(String(request.key), request.value);
        case "asset":
          return source.asset(requestRef(request));
        case "upload": {
          const mime = String(request.mime);
          const base64 = String(request.base64);
          if (!UPLOAD_MIMES.has(mime) || !base64 || base64.length > MAX_UPLOAD_BASE64) {
            throw new Error("That photo can't be added.");
          }
          return source.upload(String(request.name).slice(0, 120) || "photo.jpg", mime, base64);
        }
        case "ai.ask": {
          if (!source.ask) throw new Error("AI answers are not available here.");
          return source.ask(String(request.prompt).slice(0, 8000), request.json === true);
        }
        case "export": {
          const format = request.format === "csv" ? "csv" : "xlsx";
          const file = await source.exportTable(String(request.table), format);
          saveFile(file.filename, file.mime, file.base64, true);
          return null;
        }
        case "download": {
          const mime = String(request.mime).split(";")[0]?.trim().toLowerCase() ?? "";
          const text = String(request.text);
          const endings = DOWNLOAD_TYPES.get(mime);
          if (!endings || text.length > MAX_DOWNLOAD) {
            throw new Error("That file can't be downloaded from an app.");
          }
          saveFile(downloadName(String(request.filename), endings), mime, text, false);
          return null;
        }
        case "pdf": {
          if (JSON.stringify(request.document ?? null).length > PDF_LIMITS.bytes) {
            throw new Error("That report is too large to print; use fewer or smaller pictures.");
          }
          const { buildAppPdf } = await import("../../lib/app-pdf");
          const file = await buildAppPdf({
            document: request.document,
            filename: request.filename,
            asset: source.asset,
            maps: latest.current.maps,
          });
          saveFile(file.filename, "application/pdf", file.base64, true);
          return null;
        }
        case "location": {
          const allowed = appLocationDecision({
            focused,
            msSinceClick: Date.now() - clickedAt.current,
            shared: sharedLocation.current,
          });
          if (allowed !== "ok") throw new Error(allowed);
          const here = await currentPosition();
          sharedLocation.current = true;
          return here;
        }
        case "open": {
          const url = safeUrl(request.url);
          if (!url) throw new Error("Only web links can be opened.");
          open(url);
          return null;
        }
        case "map.tile": {
          if (!latest.current.maps) throw new Error("Maps are not available here.");
          const square = [request.z, request.x, request.y].map(Number);
          if (!square.every(Number.isInteger)) throw new Error("That is not part of a map.");
          const response = await fetch(
            `${APP_MAPS_PATH}/tile/${encodeURIComponent(String(request.style))}/${square.join("/")}`,
            { credentials: "same-origin", referrerPolicy: "no-referrer" },
          );
          if (!response.ok) throw new Error("That part of the map isn't available.");
          const blob = await response.blob();
          return { mime: blob.type || "image/png", base64: await blobBase64(blob) };
        }
        case "presence.set": {
          focus.current = sawEvolve.current ? null : readFocus(request.focus);
          return null;
        }
        case "map.find": {
          if (!latest.current.maps) throw new Error("Place search is not available here.");
          const response = await fetch(
            `${APP_MAPS_PATH}/find?q=${encodeURIComponent(String(request.query).slice(0, 200))}`,
            { credentials: "same-origin", referrerPolicy: "no-referrer" },
          );
          const body = (await response.json().catch(() => null)) as {
            places?: unknown;
            error?: unknown;
          } | null;
          if (!response.ok) {
            throw new Error(typeof body?.error === "string" ? body.error : "Place search failed.");
          }
          return Array.isArray(body?.places) ? body.places : [];
        }
        default: {
          if (!APP_CALL_OPS.has(request.op) || request.op === "live" || !source.call)
            throw new Error("That is not available here.");
          if (request.op === "evolve.read" && known.current?.colleague) {
            sawEvolve.current = true;
            focus.current = null;
          }
          const { type: _type, id: _id, ref: _ref, ...body } = request;
          return source.call(body);
        }
      }
    },
    [open],
  );

  const receive = useCallback(
    (data: unknown, answer: (message: object) => void, focused: boolean) => {
      post.current = answer;
      if (!data || typeof data !== "object") return;
      const type = (data as { type?: unknown }).type;
      if (type === APP_PICK) {
        const pick = data as AppPickMessage;
        if (latest.current.picking) {
          latest.current.onPick?.({ loc: pick.loc, tag: pick.tag, text: pick.text });
        }
        return;
      }
      if (type === "ocsc-app:error") {
        latest.current.onProblem?.(String((data as { message?: unknown }).message));
        return;
      }
      const request = readAppRequest(data);
      if (!request) return;
      const gesture = (data as { gesture?: unknown }).gesture;
      handle(request, gesture, focused).then(
        (result) => {
          answer({ type: APP_RESPONSE, id: request.id, ok: true, result });
          if (!ready.current) {
            ready.current = true;
            latest.current.onReady?.();
          }
        },
        (error: unknown) =>
          answer({
            type: APP_RESPONSE,
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : "Something went wrong.",
          }),
      );
    },
    [handle],
  );

  return (
    <>
      <SandboxedHtmlViewer
        html={html}
        title={title}
        className="bg-transparent"
        onFrameMessage={receive}
      />
      {dialog}
    </>
  );
}

function readFocus(value: unknown): AppFocus | null {
  const focus = value as Partial<AppFocus> | null;
  return focus && typeof focus.table === "string" && typeof focus.rowId === "string"
    ? { table: focus.table.slice(0, 40), rowId: focus.rowId.slice(0, 64) }
    : null;
}

/** Someone viewing another person's app through its link, not the owner or the Studio. */
function isColleague(role: AppInit["viewer"]["role"]): boolean {
  return role === "member" || role === "visitor";
}

async function blobBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let text = "";
  for (let at = 0; at < buffer.length; at += 0x8000) {
    text += String.fromCharCode(...buffer.subarray(at, at + 0x8000));
  }
  return btoa(text);
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function currentPosition(): Promise<AppLocation> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords, timestamp }) =>
        resolve({
          lat: coords.latitude,
          lon: coords.longitude,
          accuracy: Math.round(coords.accuracy),
          ...(coords.altitude !== null ? { altitude: coords.altitude } : {}),
          ...(coords.heading !== null && Number.isFinite(coords.heading)
            ? { heading: coords.heading }
            : {}),
          at: new Date(timestamp).toISOString(),
        }),
      (error) =>
        reject(
          new Error(
            error.code === error.PERMISSION_DENIED
              ? "Location is turned off for this site. Allow it in the browser's settings."
              : "Your location couldn't be found. Try again outside or near a window.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 10_000 },
    );
  });
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}
