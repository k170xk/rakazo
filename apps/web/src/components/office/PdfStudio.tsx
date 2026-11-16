import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { DocumentStudioSelected, DocumentVersion } from "@rakazo/contracts";
import { DOCUMENT_LIST_MAX_LIMIT } from "@rakazo/contracts";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  Download,
  FilePenLine,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Share,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { readTheme, subscribeTheme } from "../../lib/pages";
import { useSpaceQueries } from "../../lib/query";
import { formatRelativeTime } from "../../lib/relative-time";
import { selectedSpaceId } from "../../lib/rpc";
import { useBoundSpaceId } from "../../lib/space-rpc";
import { errorCode } from "../../lib/user-error";
import {
  control,
  pill,
  StudioFrame,
  StudioHint,
  StudioMoreMenu,
  useStudioDock,
} from "../studio/StudioFrame";
import { StudioSwitcherDelete } from "../studio/StudioSwitcherDelete";
import { setStudioBeforeSend, setStudioSelectionImage } from "../studio/studio-send";
import { documentDockPage } from "./context";
import { pdfEditingSoon } from "./pdf/editing-soon";
import { DocumentLoadOverlay, DocumentLoadPanel } from "./DocumentLoadPanel";
import { useDocumentBotId } from "./document-bot";
import { DOCUMENT_LOAD_ATTEMPTS } from "./document-load";
import { HistoryButton, VersionHistoryPanel } from "./history/VersionHistory";
import {
  isPhoneScreen,
  MARKUP_JSON_MAX,
  noteKey,
  pdfDetail,
  pdfSelection,
  pdfWhere,
} from "./pdf/context";
import { pdfHistory } from "./pdf/history";
import type { PdfAppState, PdfHostHandlers } from "./pdf/host";
import {
  attachPdfHost,
  captureSelection,
  fitAppPage,
  PdfHostError,
  pdfStudioInstalled,
  pdfStudioSrc,
  pressAppSave,
  readAppState,
  sendAppTheme,
} from "./pdf/host";
import { prepareDocumentStudioSend } from "./prepare-document-studio-send";
import type { OfficeStudioProps } from "./registry";
import { uploadNewDocument } from "./upload-document";
import { useDeleteOfficeDocument } from "./use-delete-document";
import { useDocumentLoad } from "./use-document-load";
import { useDocumentUpload } from "./use-document-upload";
import { useLiveDraft } from "./use-live-draft";
import type { SaveResult } from "./word/save-queue";
import { fetchDownload, uploadDocumentVersion } from "./word/upload";
import type { VersionRow } from "./word/versions";
import { versionRows, withSavedVersion } from "./word/versions";

/** The open PDF as loaded, and the history around it. */
type OpenPdf = {
  rootArtifactId: string;
  name: string;
  artifactId: string;
  version: number;
  versions: DocumentVersion[];
  /** Changes only when a file is loaded, so the person's own saves never reload the app. */
  loaded: number;
};

type Latest = { artifactId: string; version: number; name: string; versions: DocumentVersion[] };

type SaveState = "saving" | "saved" | "failed" | null;

/** The app must say hello and open the file within this long, or the studio offers a retry. */
const START_TIMEOUT_MS = 60_000;
/** How long closing or switching waits for the app to save unsaved markups. */
const SAVE_WAIT_MS = 30_000;
const STATE_POLL_MS = 2000;
const FLASH_MS = 4000;
const SELECTED_MARKUPS_READ = 5;

function displayName(name: string): string {
  return name.replace(/\.pdf$/i, "");
}

function bytesOf(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function ownBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function sameState(a: PdfAppState | null, b: PdfAppState | null): boolean {
  return (
    a?.currentPage === b?.currentPage &&
    a?.pageCount === b?.pageCount &&
    a?.selected.join() === b?.selected.join() &&
    noteKey(a?.context ?? null) === noteKey(b?.context ?? null)
  );
}

/**
 * PDFs full screen beside the chat, in Evolve PDF Studio. The app is framed from this origin and
 * reads and saves the file only through this page: every save is a new version of the person's
 * own file, and the assistant's markups arrive as new versions too.
 */
export default function PdfStudio({
  rootArtifactId,
  onClose,
  onOpenDocument,
  onEmpty,
}: OfficeStudioProps) {
  const { t } = useLingui();
  const [phone] = useState(() => isPhoneScreen());
  const queries = useSpaceQueries();
  const editingSoon = pdfEditingSoon(useQuery(queries.me.queryOptions()).data);
  const queryClient = useQueryClient();
  const documentBot = useDocumentBotId();
  const spaceId = useBoundSpaceId() ?? selectedSpaceId();
  const dock = useStudioDock();
  const { session, running } = dock;

  const [doc, setDoc] = useState<OpenPdf | null>(null);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [broken, setBroken] = useState(false);
  const [opened, setOpened] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [newer, setNewer] = useState<number | null>(null);
  const [flash, setFlash] = useState<number | null>(null);

  const frame = useRef<HTMLIFrameElement | null>(null);
  const latest = useRef<Latest | null>(null);
  const bytes = useRef<ArrayBuffer | null>(null);
  const turnRef = useRef(0);
  const appState = useRef<PdfAppState | null>(null);
  const selectedNote = useRef<DocumentStudioSelected | null>(null);
  const saveWaiters = useRef<((saved: boolean) => void)[]>([]);
  const owner = useRef<Promise<{ botId: string | null; groupId: string | null }> | null>(null);
  const timers = useRef({ start: 0, flash: 0 });
  const { loadState, loadBytes, markReady, markOpenFailed } = useDocumentLoad("pdf", () =>
    queries.documents.get.call({ rootArtifactId }),
  );

  useEffect(() => {
    let live = true;
    void pdfStudioInstalled().then((ok) => {
      if (live) setInstalled(ok);
    });
    return () => {
      live = false;
    };
  }, []);

  const publishNote = useCallback(() => {
    const now = latest.current;
    if (!session || !now) return;
    const state = appState.current;
    const where = pdfWhere(state?.context ?? null);
    const focus =
      state?.currentPage && state.pageCount
        ? {
            where: where ?? `page ${state.currentPage} of ${state.pageCount}`,
            short: t`Page ${state.currentPage}`,
            detail: pdfDetail(state.context) ?? undefined,
          }
        : undefined;
    session.dock.set({
      page: documentDockPage({
        kind: "pdf",
        name: now.name,
        rootArtifactId,
        artifactId: now.artifactId,
        version: now.version,
        focus,
        selected: selectedNote.current,
      }),
    });
  }, [session, rootArtifactId, t]);

  const load = useCallback(
    async (reason: "open" | "newer" | "reload") => {
      const loaded = await loadBytes();
      if (!loaded) return;
      const { detail, turn } = loaded;
      const shown = latest.current?.version ?? 0;
      latest.current = {
        artifactId: detail.latest.artifactId,
        version: detail.latest.version,
        name: detail.name,
        versions: detail.versions,
      };
      bytes.current = loaded.bytes;
      turnRef.current = turn;
      appState.current = null;
      selectedNote.current = null;
      setOpened(false);
      setNewer(null);
      setBroken(false);
      setDoc({
        rootArtifactId: detail.rootArtifactId,
        name: detail.name,
        artifactId: detail.latest.artifactId,
        version: detail.latest.version,
        versions: detail.versions,
        loaded: turn,
      });
      publishNote();
      if (reason !== "open" && detail.latest.version > shown) {
        window.clearTimeout(timers.current.flash);
        setFlash(detail.latest.version);
        timers.current.flash = window.setTimeout(() => setFlash(null), FLASH_MS);
      }
    },
    [loadBytes, publishNote],
  );

  useEffect(() => {
    latest.current = null;
    bytes.current = null;
    owner.current = null;
    setDoc(null);
    setFlash(null);
    void load("open");
  }, [rootArtifactId, load]);

  useEffect(
    () => () => {
      window.clearTimeout(timers.current.start);
      window.clearTimeout(timers.current.flash);
      for (const resolve of saveWaiters.current.splice(0)) resolve(false);
    },
    [],
  );

  const settleWaiters = (saved: boolean) => {
    for (const resolve of saveWaiters.current.splice(0)) resolve(saved);
  };

  const refusal = (code: string, message: string | null | undefined) =>
    code === "STORAGE_FULL"
      ? new PdfHostError(
          "quotum",
          t`There's no room to save this PDF. Free up storage and try again.`,
        )
      : code === "PAYLOAD_TOO_LARGE"
        ? new PdfHostError("te_groot", t`This PDF is over the upload limit, so it wasn't saved.`)
        : new PdfHostError("fout", message || t`This PDF wasn't saved. Try again.`);

  /** A new family from the app's bytes; the studio then opens it. */
  async function saveAsNew(fileBytes: Uint8Array, name: string) {
    const result = await uploadNewDocument({
      format: "pdf",
      file: new Blob([ownBuffer(fileBytes)], { type: "application/pdf" }),
      name,
      spaceId,
      ...documentBot,
    });
    if (result.kind !== "created") throw refusal(result.code, result.message);
    await queryClient.invalidateQueries({ queryKey: queries.documents.list.key() });
    const detail = await queries.documents.get
      .call({ rootArtifactId: result.created.rootArtifactId })
      .catch(() => null);
    return { rootArtifactId: result.created.rootArtifactId, name: detail?.name ?? name };
  }

  async function saveFromApp(file: unknown, raw: unknown) {
    const fileBytes = bytesOf(raw);
    if (!fileBytes) throw new PdfHostError("fout", t`There was nothing to save.`);
    const now = latest.current;
    if (!now || file !== rootArtifactId) {
      throw new PdfHostError("alleen_lezen", t`This file can't be saved here.`);
    }
    setSaveState("saving");
    let result: SaveResult;
    try {
      result = await uploadDocumentVersion({
        rootArtifactId,
        format: "pdf",
        bytes: fileBytes,
        baseVersion: now.version,
        clientNonce: crypto.randomUUID(),
        spaceId,
      });
    } catch {
      setSaveState("failed");
      settleWaiters(false);
      throw new PdfHostError(
        "fout",
        t`Evolve couldn't be reached, so nothing was saved. Check your connection and save again.`,
      );
    }
    if (result.kind === "saved") {
      const row = {
        artifactId: result.artifactId,
        version: result.version,
        size: fileBytes.byteLength,
        createdAt: new Date().toISOString(),
      };
      latest.current = {
        ...now,
        artifactId: result.artifactId,
        version: result.version,
        versions: withSavedVersion(now.versions, row),
      };
      bytes.current = ownBuffer(fileBytes);
      setDoc((prev) =>
        prev
          ? {
              ...prev,
              artifactId: result.artifactId,
              version: result.version,
              versions: withSavedVersion(prev.versions, row),
            }
          : prev,
      );
      setSaveState("saved");
      setNewer(null);
      settleWaiters(true);
      publishNote();
      void queryClient.invalidateQueries({ queryKey: queries.documents.list.key() });
      return {
        bestand: rootArtifactId,
        naam: now.name,
        versie: result.version,
        conflict: false,
        melding: null,
        vergrendeld: null,
      };
    }
    if (result.kind === "conflict") {
      // A newer version (usually the assistant's) arrived first; keep both instead of losing either.
      try {
        const copy = await saveAsNew(fileBytes, now.name);
        setSaveState("saved");
        settleWaiters(true);
        toast(
          t`A newer version of this PDF arrived while you worked, so your markups were saved as a copy: ${displayName(copy.name)}.`,
        );
        window.setTimeout(() => onOpenDocument(copy.rootArtifactId), 0);
        return {
          bestand: copy.rootArtifactId,
          naam: copy.name,
          versie: 1,
          conflict: true,
          melding: null,
          vergrendeld: null,
        };
      } catch (error) {
        setSaveState("failed");
        settleWaiters(false);
        throw error;
      }
    }
    setSaveState("failed");
    settleWaiters(false);
    throw refusal(result.code, result.message);
  }

  async function saveAsFromApp(name: unknown, raw: unknown) {
    const fileBytes = bytesOf(raw);
    if (!fileBytes) throw new PdfHostError("fout", t`There was nothing to save.`);
    const asked =
      typeof name === "string" && name.trim() ? name.trim() : (latest.current?.name ?? "");
    const wanted = /\.pdf$/i.test(asked) ? asked : `${asked || t`Untitled PDF`}.pdf`;
    const copy = await saveAsNew(fileBytes, wanted);
    toast.success(t`Saved as ${displayName(copy.name)}.`);
    window.setTimeout(() => onOpenDocument(copy.rootArtifactId), 0);
    return {
      bestand: copy.rootArtifactId,
      naam: copy.name,
      versie: 1,
      hernoemd: copy.name !== wanted,
    };
  }

  async function openForApp(file: unknown, version: unknown) {
    const now = latest.current;
    const current = bytes.current;
    if (!now || !current) throw new PdfHostError("niet_gevonden", t`This PDF isn't loaded yet.`);
    if (version !== undefined && version !== null) {
      const number = Number(version);
      const row = now.versions.find((item) => item.version === number);
      if (!Number.isInteger(number) || !row) {
        throw new PdfHostError("versie_ongeldig", t`That version of the PDF doesn't exist.`);
      }
      const { url } = await queries.artifacts.downloadToken.call({ artifactId: row.artifactId });
      const old = await fetchDownload(url);
      return {
        value: {
          bestand: rootArtifactId,
          naam: now.name,
          versie: number,
          alleen_lezen: true,
          bytes: old,
        },
        transfer: [old],
      };
    }
    if (typeof file === "string" && file && file !== rootArtifactId) {
      // Another of their PDFs, picked in the app: the studio opens it in its place.
      void switchTo(file);
      return new Promise(() => {});
    }
    const copy = current.slice(0);
    return {
      value: {
        bestand: rootArtifactId,
        naam: now.name,
        versie: now.version,
        alleen_lezen: false,
        bytes: copy,
      },
      transfer: [copy],
    };
  }

  const host = useRef<PdfHostHandlers>({});
  host.current = {
    hallo: async () => ({ soorten: ["opslaan_als"] }),
    open: (request) => openForApp(request.bestand, request.versie),
    opslaan: (request) => saveFromApp(request.bestand, request.bytes),
    opslaan_als: (request) => saveAsFromApp(request.naam, request.bytes),
    lijst: async () => {
      const listed = await queries.documents.list.call({
        format: "pdf",
        limit: DOCUMENT_LIST_MAX_LIMIT,
      });
      return listed.items.map((item) => ({
        id: item.rootArtifactId,
        name: item.name,
        modified: item.updatedAt,
        soort: "bestand",
        schrijfbaar: true,
      }));
    },
    versies: async () =>
      (latest.current?.versions ?? []).map((row) => ({
        version: String(row.version),
        modified: row.createdAt,
        author: row.source === "assistant" ? t`Assistant` : row.source === "studio" ? t`You` : "",
      })),
    geopend: async () => {
      window.clearTimeout(timers.current.start);
      markReady(turnRef.current);
      setOpened(true);
      sendAppTheme(frame.current, readTheme());
      fitAppPage(frame.current);
      return true;
    },
    melding: async (request) => {
      const text = typeof request.tekst === "string" ? request.tekst.trim() : "";
      if (!text) return true;
      if (request.toon === "succes") toast.success(text);
      else if (request.toon === "info") toast(text);
      else if (request.toon === "waarschuwing") toast.warning(text);
      else toast.error(text);
      return true;
    },
  };

  useEffect(
    () =>
      attachPdfHost({
        target: window,
        frame: () => frame.current,
        handlers: Object.fromEntries(
          ["hallo", "open", "opslaan", "opslaan_als", "lijst", "versies", "geopend", "melding"].map(
            (kind) => [kind, (request) => host.current[kind]!(request)],
          ),
        ) as PdfHostHandlers,
      }),
    [],
  );

  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "dark" as const);
  useEffect(() => {
    sendAppTheme(frame.current, theme);
  }, [theme]);

  // Until the app opens the file, a slow or missing start offers a retry instead of a blank frame.
  const loadedTurn = doc?.loaded;
  useEffect(() => {
    if (loadedTurn === undefined) return;
    window.clearTimeout(timers.current.start);
    timers.current.start = window.setTimeout(() => {
      markOpenFailed(loadedTurn);
      setBroken(true);
    }, START_TIMEOUT_MS);
    return () => window.clearTimeout(timers.current.start);
  }, [loadedTurn, markOpenFailed]);

  /** Saves unsaved markups through the app's own Save; true when nothing is left unsaved. */
  const saveNow = useCallback(async (): Promise<boolean> => {
    const state = await readAppState(frame.current);
    if (!state?.modified) return true;
    const saved = new Promise<boolean>((resolve) => saveWaiters.current.push(resolve));
    if (!pressAppSave(frame.current)) {
      settleWaiters(false);
      return false;
    }
    return Promise.race([
      saved,
      new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), SAVE_WAIT_MS)),
    ]);
  }, []);

  // Markups save themselves once the person pauses: each save is a version in the history, so any
  // earlier state can be restored. A save waits while they drag or type, and while a newer version
  // from the assistant is waiting, so it never forks the file into a copy on its own.
  const autosaved = useRef({
    seen: null as string | null,
    failed: null as string | null,
    busy: false,
  });
  const newerRef = useRef<number | null>(null);
  newerRef.current = newer;

  // The page and selection the person is on, for the chat beside the studio.
  useEffect(() => {
    if (!opened) return;
    let live = true;
    const autosave = (state: PdfAppState | null) => {
      const memo = autosaved.current;
      const revision = state?.revision ?? null;
      const settledSince = revision !== null && revision === memo.seen;
      memo.seen = revision;
      if (!state?.modified || state.editing || memo.busy || newerRef.current !== null) return;
      if (!settledSince || revision === memo.failed) return;
      memo.busy = true;
      void saveNow().then((saved) => {
        memo.busy = false;
        memo.failed = saved ? null : revision;
      });
    };
    const read = async () => {
      if (document.visibilityState !== "visible") return;
      const next = await readAppState(frame.current);
      if (!live) return;
      autosave(next);
      if (sameState(next, appState.current)) return;
      appState.current = next;
      selectedNote.current = await selectedMarkups(next);
      if (live) publishNote();
    };
    const selectedMarkups = async (
      state: PdfAppState | null,
    ): Promise<DocumentStudioSelected | null> => {
      if (state?.context) {
        const selection = pdfSelection(state.context);
        if (!selection) return null;
        if (selection.kind === "text") {
          return { what: "text", label: t`Text`, content: selection.content, imageAttached: true };
        }
        return {
          what: selection.count === 1 ? "markup" : "markups",
          label: plural(selection.count, { one: "# markup", other: "# markups" }),
          content: selection.content,
          imageAttached: true,
        };
      }
      const ids = state?.selected ?? [];
      if (ids.length === 0) return null;
      const app = (
        frame.current?.contentWindow as unknown as {
          __OPDS_APP__?: { run: (tool: string, input?: object) => Promise<unknown> };
        } | null
      )?.__OPDS_APP__;
      const details = await Promise.all(
        ids
          .slice(0, SELECTED_MARKUPS_READ)
          .map((id) => app?.run("pdf_get_annotation", { id }).catch(() => null) ?? null),
      );
      return {
        what: ids.length === 1 ? "markup" : "markups",
        label: plural(ids.length, { one: "# markup", other: "# markups" }),
        content: details
          .filter(Boolean)
          .map((detail) => JSON.stringify(detail).slice(0, MARKUP_JSON_MAX))
          .join("\n"),
      };
    };
    void read();
    const timer = window.setInterval(() => void read(), STATE_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [opened, publishNote, saveNow, t]);

  // A picture of the selected markups or text goes with the next message, so the assistant sees
  // the drawing around them and not only their coordinates.
  useEffect(() => {
    if (!session) return;
    return setStudioSelectionImage(session, () =>
      captureSelection(frame.current, appState.current?.context ?? null),
    );
  }, [session]);

  /** Saves before leaving this PDF; false when the person chose to stay because it didn't save. */
  async function settle(): Promise<boolean> {
    if (await saveNow()) return true;
    return window.confirm(t`Your latest markups couldn't be saved. Leave this PDF anyway?`);
  }

  // The assistant's versions arrive here. Unsaved markups are never thrown away for them.
  const { revision } = useLiveDraft({
    rootArtifactId,
    enabled: doc !== null,
    running,
    shownVersion: doc?.version,
    parse: async (data) => data,
  });
  const newest = revision.data?.version;
  useEffect(() => {
    const shown = latest.current?.version;
    if (newest === undefined || shown === undefined || newest <= shown) return;
    let live = true;
    void readAppState(frame.current).then((state) => {
      if (!live) return;
      if (state?.modified) setNewer(newest);
      else void load("newer");
    });
    return () => {
      live = false;
    };
  }, [newest, load]);

  // The chat saves this PDF, then attaches its newest version, before each message.
  useEffect(() => {
    if (!session) return;
    return setStudioBeforeSend(session, async () => {
      owner.current ??= queries.artifacts.meta
        .call({ artifactId: rootArtifactId })
        .then((meta) => ({ botId: meta.botId, groupId: meta.groupId }));
      return prepareDocumentStudioSend({
        flush: async () => {
          const saved = await saveNow();
          return {
            status: saved ? "saved" : "refused",
            dirty: false,
            baseVersion: latest.current?.version ?? 1,
            detail: null,
          };
        },
        getLatest: () => latest.current,
        publishNote,
        owner: () => owner.current!,
      });
    });
  }, [session, queries, rootArtifactId, publishNote, saveNow]);

  const list = useQuery({
    ...queries.documents.list.queryOptions({ input: { format: "pdf", limit: 30 } }),
    refetchInterval: 15_000,
  });
  const documents = list.data?.items ?? [];

  const deleteDocument = useDeleteOfficeDocument({
    currentId: rootArtifactId,
    documents,
    settle: async () => {
      await saveNow();
    },
    onOpenDocument,
    onEmpty,
  });

  async function close() {
    setBusy(true);
    if (!(await settle())) {
      setBusy(false);
      return;
    }
    onClose();
  }

  async function switchTo(id: string) {
    if (id === rootArtifactId) return;
    setBusy(true);
    const leave = await settle();
    setBusy(false);
    if (leave) onOpenDocument(id);
  }

  async function create() {
    setBusy(true);
    try {
      if (!(await settle())) return;
      const created = await queries.documents.create.call({
        format: "pdf",
        title: t`Untitled PDF`,
        ...documentBot,
      });
      await queryClient.invalidateQueries({ queryKey: queries.documents.list.key() });
      onOpenDocument(created.rootArtifactId);
    } catch (error) {
      toast.error(
        errorCode(error) === "STORAGE_FULL"
          ? t`There's no room for a new PDF. Free up storage and try again.`
          : t`Couldn't make a new PDF.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    try {
      await saveNow();
      const now = latest.current;
      if (!now) return;
      const { url } = await queries.artifacts.downloadToken.call({ artifactId: now.artifactId });
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.rel = "noopener";
      anchor.download = now.name;
      anchor.click();
    } catch {
      toast.error(t`Couldn't download the PDF.`);
    }
  }

  async function openHistory(next: boolean) {
    setHistoryOpen(next);
    if (!next) return;
    try {
      const detail = await queries.documents.get.call({ rootArtifactId });
      if (latest.current) latest.current = { ...latest.current, versions: detail.versions };
      setDoc((prev) => (prev ? { ...prev, versions: detail.versions } : prev));
    } catch {
      // The list already shown stays; it refreshes the next time it opens.
    }
  }

  async function restore(row: VersionRow) {
    setRestoring(row.version);
    try {
      if (!(await saveNow())) {
        toast.error(t`Save your markups first, then restore.`);
        return;
      }
      const now = latest.current;
      if (!now) return;
      const { url } = await queries.artifacts.downloadToken.call({ artifactId: row.artifactId });
      const old = new Uint8Array(await fetchDownload(url));
      const result = await uploadDocumentVersion({
        rootArtifactId,
        format: "pdf",
        bytes: old,
        baseVersion: now.version,
        clientNonce: crypto.randomUUID(),
        spaceId,
      });
      if (result.kind === "saved") {
        toast.success(t`Version ${row.version} is now the newest version.`);
        setHistoryOpen(false);
        await load("reload");
      } else if (result.kind === "conflict") {
        toast(
          t`A newer version arrived first, so it has been loaded. Restore again if you still want the older one.`,
        );
        await load("reload");
      } else {
        toast.error(t`Couldn't restore that version.`);
      }
    } catch {
      toast.error(t`Couldn't restore that version.`);
    } finally {
      setRestoring(null);
    }
  }

  const rows = useMemo(() => (doc ? versionRows(doc.versions, doc.version) : []), [doc]);
  const title = doc ? displayName(doc.name) : t`PDFs`;
  const statusText =
    saveState === "saving"
      ? t`Saving…`
      : saveState === "saved"
        ? t`Saved`
        : saveState === "failed"
          ? t`Not saved`
          : null;
  const loadFailed = loadState.status === "error" && !doc;
  const uploader = useDocumentUpload("pdf", onOpenDocument, async () => {
    await saveNow();
  });
  const src = useMemo(
    () => pdfStudioSrc(window.location.origin, rootArtifactId, readTheme()),
    [rootArtifactId],
  );

  const downloadButton = (
    <Button size="sm" onClick={() => void download()} data-testid="pdf-error-download">
      <Download className="size-4" />
      <Trans>Download .pdf</Trans>
    </Button>
  );

  return (
    <StudioFrame
      testId="pdf-studio"
      title={title}
      paneLabel={title}
      product={t`Evolve PDF`}
      onClose={() => void close()}
      closeLabel={t`Close PDF`}
      dock={dock}
      dockLift={phone ? "0px" : "2.25rem"}
      workingLabel={t`Working on your PDF…`}
      start={
        <>
          <DropdownMenu>
            <StudioHint label={t`Start a blank PDF, or upload one.`}>
              <DropdownMenuTrigger
                data-testid="pdf-new"
                disabled={busy || uploader.busy}
                aria-label={t`New PDF`}
                className={`${control} size-8 sm:size-[35px] disabled:opacity-40`}
              >
                {busy || uploader.busy ? (
                  <Loader2 className="size-[18px] animate-spin" strokeWidth={1.7} />
                ) : (
                  <Plus className="size-4 sm:size-[18px]" strokeWidth={1.7} />
                )}
              </DropdownMenuTrigger>
            </StudioHint>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onClick={() => void create()}>
                <Plus className="size-4" />
                <Trans>New blank PDF</Trans>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={uploader.choose}>
                <Upload className="size-4" />
                <Trans>Upload a .pdf file</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {uploader.input}
          <DropdownMenu>
            <StudioHint label={t`Open another PDF.`}>
              <DropdownMenuTrigger
                data-testid="pdf-switcher"
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-w-0 max-w-[38vw] gap-1.5 font-medium sm:max-w-[320px]"
                  />
                }
              >
                <FilePenLine className="size-4 shrink-0 text-foreground/70" strokeWidth={1.8} />
                <span className="truncate">{title}</span>
                <ChevronDown className="size-3.5 shrink-0 opacity-65" />
              </DropdownMenuTrigger>
            </StudioHint>
            <DropdownMenuContent align="start" className="w-80">
              {documents.length === 0 ? (
                <DropdownMenuItem disabled>
                  <Trans>No other PDFs yet</Trans>
                </DropdownMenuItem>
              ) : null}
              {documents.map((item) => (
                <DropdownMenuItem
                  key={item.rootArtifactId}
                  onClick={() => void switchTo(item.rootArtifactId)}
                  className="flex items-center gap-2"
                >
                  <FilePenLine className="size-4 shrink-0 text-foreground/60" strokeWidth={1.8} />
                  <span className="min-w-0 flex-1 truncate">{displayName(item.name)}</span>
                  <span className="shrink-0 text-[12px] text-muted-foreground">
                    {formatRelativeTime(item.updatedAt)}
                  </span>
                  {item.rootArtifactId === rootArtifactId ? (
                    <Check className="size-4 shrink-0 text-primary" />
                  ) : null}
                  <StudioSwitcherDelete
                    label={t`Delete ${displayName(item.name)}`}
                    onDelete={() =>
                      void deleteDocument(item.rootArtifactId, displayName(item.name))
                    }
                  />
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={busy || uploader.busy} onClick={uploader.choose}>
                <Upload className="size-4" />
                <Trans>Upload a .pdf file</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
      actions={
        <>
          {statusText ? (
            <span
              className="shrink-0 text-[12px] text-muted-foreground max-sm:hidden"
              data-testid="pdf-save-status"
              aria-live="polite"
            >
              {statusText}
            </span>
          ) : null}
          <StudioMoreMenu>
            <DropdownMenuItem disabled={!doc} onClick={() => void openHistory(true)}>
              <History className="size-4" strokeWidth={1.8} />
              <Trans>History</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!doc && !loadFailed} onClick={() => void download()}>
              <Download className="size-4" />
              <Trans>Download .pdf</Trans>
            </DropdownMenuItem>
          </StudioMoreMenu>
          <HistoryButton
            open={historyOpen}
            disabled={!doc}
            className="max-sm:hidden"
            onOpenChange={(next) => void openHistory(next)}
          />
        </>
      }
      share={
        <DropdownMenu>
          <StudioHint label={t`Download a copy of this PDF.`}>
            <DropdownMenuTrigger
              disabled={!doc && !loadFailed}
              data-testid="pdf-share"
              aria-label={t`Share`}
              className={`${pill} disabled:opacity-40 max-sm:hidden`}
            >
              <Share className="size-4" strokeWidth={1.8} />
              <span className="max-sm:sr-only">
                <Trans>Share</Trans>
              </span>
            </DropdownMenuTrigger>
          </StudioHint>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => void download()}>
              <Download className="size-4" />
              <Trans>Download .pdf</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      {installed === false ? (
        <MessagePanel
          message={t`Evolve PDF Studio isn't installed on this server yet. Download the PDF, or ask the assistant to mark it up.`}
          actions={latest.current ? downloadButton : null}
        />
      ) : broken && !loadFailed ? (
        <MessagePanel
          message={t`This PDF couldn't be opened here. Try again, download it, or ask the assistant to mark it up.`}
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => void load("reload")}>
                <RefreshCw className="size-4" />
                <Trans>Try again</Trans>
              </Button>
              {latest.current ? downloadButton : null}
            </>
          }
        />
      ) : !doc || installed === null ? (
        <DocumentLoadPanel
          state={
            loadState.status === "idle"
              ? {
                  status: "loading",
                  phase: "fetching",
                  received: 0,
                  total: null,
                  attempt: 1,
                  attempts: DOCUMENT_LOAD_ATTEMPTS,
                }
              : loadState
          }
          fileLabel={t`PDF`}
          onRetry={() => void load("open")}
          secondary={latest.current ? downloadButton : null}
        />
      ) : (
        <div className="flex size-full flex-col">
          {editingSoon ? <PdfEditingSoon /> : null}
          <div
            className={`relative min-h-0 flex-1 ring-inset transition-shadow duration-700 ${
              flash !== null ? "ring-2 ring-primary" : ""
            }`}
          >
          <iframe
            key={doc.loaded}
            ref={frame}
            title={t`Evolve PDF Studio`}
            src={src}
            allow="clipboard-read; clipboard-write; fullscreen"
            className="block size-full border-0"
            data-testid="pdf-studio-frame"
          />
          <DocumentLoadOverlay state={loadState} />
          {newer !== null ? (
            <div className="absolute inset-x-0 top-12 flex justify-center px-3">
              <span className="flex flex-wrap items-center justify-center gap-2 rounded-2xl bg-background/95 px-3 py-1.5 text-[12px] font-medium text-foreground shadow-sm ring-1 ring-border">
                <Trans>
                  Version {newer} arrived. Save your markups as a copy, or load it and leave them.
                </Trans>
                <Button size="xs" variant="outline" onClick={() => void load("reload")}>
                  <Trans>Load version {newer}</Trans>
                </Button>
              </span>
            </div>
          ) : running ? (
            <div className="pointer-events-none absolute inset-x-0 top-12 flex justify-center">
              <span className="flex items-center gap-1.5 rounded-full bg-background/95 px-3 py-1 text-[12px] font-medium text-primary shadow-sm ring-1 ring-border">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                <Trans>The assistant is marking up a copy…</Trans>
              </span>
            </div>
          ) : flash !== null ? (
            <div className="pointer-events-none absolute inset-x-0 top-12 flex justify-center">
              <span
                className="rounded-full bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground shadow-sm"
                aria-live="polite"
              >
                <Trans>Updated to version {flash}</Trans>
              </span>
            </div>
          ) : null}
          {historyOpen ? (
            <VersionHistoryPanel
              format={pdfHistory}
              rows={rows}
              restoring={restoring}
              onRestore={(row) => void restore(row)}
              onClose={() => setHistoryOpen(false)}
            />
          ) : null}
          </div>
        </div>
      )}
    </StudioFrame>
  );
}

function PdfEditingSoon() {
  return (
    <p
      data-testid="pdf-editing-soon"
      className="shrink-0 border-b border-border bg-muted/70 px-4 py-2 text-center text-[13px] text-foreground"
    >
      <Trans>Editing PDFs is coming soon with OCSC Intelligence.</Trans>
    </p>
  );
}

function MessagePanel({ message, actions }: { message: string; actions: React.ReactNode }) {
  return (
    <div className="grid size-full place-items-center p-6" data-testid="office-load-error">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <p className="text-[14px] text-muted-foreground">{message}</p>
        <div className="flex flex-wrap justify-center gap-2">{actions}</div>
      </div>
    </div>
  );
}
