import type { AppInit, AppPickMessage, AppRequestMessage } from "@rakazo/app-kit/protocol";
import {
  APP_EVENT,
  APP_GESTURE_OPS,
  APP_PICK,
  APP_RESPONSE,
  APP_WRITE_OPS,
  MAX_UPLOAD_BASE64,
  readAppRequest,
  UPLOAD_MIMES,
} from "@rakazo/app-kit/protocol";
import { useExternalLinkOpener } from "@rakazo/chat-ui/web";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { AppSource } from "../../lib/app-host";
import { saveFile } from "../../lib/app-host";
import { readTheme, subscribeTheme } from "../../lib/pages";
import { SandboxedHtmlViewer } from "../SandboxedHtmlViewer";

/** How often an open app asks whether its data changed elsewhere. */
const POLL_MS = 3000;
/** Files an app may hand the person; nothing that would run when opened. */
const DOWNLOAD_TYPES = new Set([
  "text/csv",
  "text/plain",
  "text/markdown",
  "application/json",
  "text/calendar",
]);
const MAX_DOWNLOAD = 5_000_000;

export type AppPick = { loc: string; tag: string; text: string };

/**
 * An app built by the App Studio, in the same sandboxed viewer as pages. The app has no network:
 * it asks this host for its tables, saves and pictures, and the host answers through `source` as
 * the person looking. Writes are refused unless that person may edit; downloads, exports and links
 * need a click inside the frame first, each click usable once.
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
}) {
  const { open, dialog } = useExternalLinkOpener();
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "dark" as const);
  const post = useRef<((message: object) => void) | null>(null);
  const known = useRef<{ revision: number; canEdit: boolean } | null>(null);
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
  });
  latest.current = { source, onPick, onProblem, onChange, onReady, title, app, theme, picking };

  const refresh = useCallback(async () => {
    const current = known.current;
    if (!current || !post.current) return;
    const revision = await latest.current.source.revision().catch(() => current.revision);
    if (revision === current.revision) return;
    const data = await latest.current.source.load().catch(() => null);
    if (!data || !post.current) return;
    known.current = { revision: data.revision, canEdit: data.viewer.canEdit };
    post.current({
      type: APP_EVENT,
      event: "tables",
      revision: data.revision,
      tables: data.tables,
      ...(data.icon ? { icon: data.icon } : {}),
    });
    latest.current.onChange?.(data.revision);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (refreshSignal !== undefined) void refresh();
  }, [refreshSignal, refresh]);
  useEffect(() => {
    post.current?.({ type: APP_EVENT, event: "theme", theme });
  }, [theme]);
  useEffect(() => {
    post.current?.({ type: APP_EVENT, event: "select", enabled: picking });
  }, [picking]);

  const handle = useCallback(
    async (request: AppRequestMessage, gesture: unknown, focused: boolean): Promise<unknown> => {
      const { source } = latest.current;
      if (APP_WRITE_OPS.has(request.op) && request.op !== "state.set" && !known.current?.canEdit) {
        throw new Error("You can view this app but not change its data.");
      }
      if (APP_GESTURE_OPS.has(request.op)) {
        if (!focused || typeof gesture !== "string" || gesture === usedGesture.current) {
          throw new Error("Click the button again to do that.");
        }
        usedGesture.current = gesture;
      }
      switch (request.op) {
        case "init": {
          const data = await source.load();
          known.current = { revision: data.revision, canEdit: data.viewer.canEdit };
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
            features: [
              "export",
              "assets",
              ...(data.viewer.canEdit ? ["uploads"] : []),
              ...(source.ask ? ["ai"] : []),
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
          return source.update(String(request.table), String(request.id), objectOf(request.patch));
        case "rows.remove":
          await source.remove(String(request.table), String(request.id));
          return null;
        case "state.set":
          return source.setState(String(request.key), request.value);
        case "asset":
          return source.asset(String(request.id));
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
          if (!DOWNLOAD_TYPES.has(mime) || text.length > MAX_DOWNLOAD) {
            throw new Error("That file can't be downloaded from an app.");
          }
          saveFile(String(request.filename), mime, text, false);
          return null;
        }
        case "open": {
          const url = safeUrl(request.url);
          if (!url) throw new Error("Only web links can be opened.");
          open(url);
          return null;
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

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
