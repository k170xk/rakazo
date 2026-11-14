import { Trans, useLingui } from "@lingui/react/macro";
import { getCell } from "@office-kit/xlsx/worksheet";
import type { DocumentVersion } from "@rakazo/contracts";
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
  FileSpreadsheet,
  Loader2,
  Plus,
  RefreshCw,
  Share,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { formatRelativeTime } from "../../lib/relative-time";
import { selectedSpaceId } from "../../lib/rpc";
import { useBoundSpaceId } from "../../lib/space-rpc";
import { errorCode } from "../../lib/user-error";
import { control, pill, StudioFrame, useStudioDock } from "../studio/StudioFrame";
import { setStudioBeforeSend } from "../studio/studio-send";
import { documentDockPage } from "./context";
import { useDocumentBotId } from "./document-bot";
import { HistoryButton, VersionHistoryPanel } from "./history/VersionHistory";
import { cellRef } from "./sheet/address";
import type { SheetChipWords } from "./sheet/context";
import { sheetContext } from "./sheet/context";
import { workbookHistory } from "./sheet/history";
import type { SheetView } from "./sheet/SheetWorkbench";
import { SheetWorkbench } from "./sheet/SheetWorkbench";
import type { SavedExpectation, Workbook } from "./sheet/workbook";
import {
  cellView,
  changedCells,
  openWorkbook,
  rawInput,
  saveVerified,
  sheetTabs,
  worksheetOf,
} from "./sheet/workbook";
import { useDocumentUpload } from "./use-document-upload";
import { LiveDraftPill, useLiveDraft } from "./use-live-draft";
import { EditorBoundary } from "./word/EditorBoundary";
import type { SaveQueue, SaveQueueState } from "./word/save-queue";
import { createSaveQueue } from "./word/save-queue";
import { downloadTokenUrl, fetchDownload, uploadDocumentVersion } from "./word/upload";
import type { VersionRow } from "./word/versions";
import { versionRows, withSavedVersion } from "./word/versions";

export type SheetStudioProps = {
  rootArtifactId: string;
  onClose: () => void;
  onOpenDocument: (rootArtifactId: string) => void;
};

/** The open workbook as loaded, and the history around it. */
type OpenSheet = {
  rootArtifactId: string;
  name: string;
  artifactId: string;
  version: number;
  wb: Workbook;
  versions: DocumentVersion[];
  /** Changes only when a file is loaded, so the person's own saves never remount the grid. */
  loaded: number;
};

type Latest = { artifactId: string; version: number; name: string; versions: DocumentVersion[] };

const CLOSE_SAVE_WAIT_MS = 5000;
const FLASH_MS = 4000;
/** Cells re-read after each save to prove the file kept them; the newest edits win. */
const MAX_CHECKS = 2000;

function displayName(name: string): string {
  return name.replace(/\.xlsx$/i, "");
}

/**
 * Excel workbooks full screen beside the chat. The person edits the newest version; their edits
 * save as new versions a moment after they stop, and the assistant's arrive as new versions too.
 */
export default function SheetStudio({ rootArtifactId, onClose, onOpenDocument }: SheetStudioProps) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const documentBot = useDocumentBotId();
  const spaceId = useBoundSpaceId() ?? selectedSpaceId();
  const dock = useStudioDock();
  const { session, running } = dock;

  const [doc, setDoc] = useState<OpenSheet | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [broken, setBroken] = useState(false);
  const [saveState, setSaveState] = useState<SaveQueueState | null>(null);
  const [flash, setFlash] = useState<{
    version: number;
    sheet: string;
    cells: ReadonlySet<string>;
  } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const queue = useRef<SaveQueue | null>(null);
  const latest = useRef<Latest | null>(null);
  const workbook = useRef<Workbook | null>(null);
  const checks = useRef(new Map<string, SavedExpectation>());
  const view = useRef<SheetView | null>(null);
  const owner = useRef<Promise<{ botId: string | null; groupId: string | null }> | null>(null);
  const loadSeq = useRef(0);
  const timers = useRef({ note: 0, flash: 0 });

  const chipWords = useMemo<SheetChipWords>(
    () => ({ cells: (ref, count) => t`${ref} (${count} cells)` }),
    [t],
  );

  const publishNote = useCallback(() => {
    const now = latest.current;
    if (!session || !now) return;
    const at = view.current;
    const wb = workbook.current;
    const ws = at && wb ? worksheetOf(wb, at.sheet) : undefined;
    const context =
      at && wb && ws && at.range
        ? sheetContext(
            {
              sheet: at.sheet,
              sheetCount: sheetTabs(wb).filter((tab) => !tab.hidden).length,
              visible: at.visible ?? null,
              selection: at.range,
              read: (row, col) => {
                const cell = getCell(ws, row, col);
                if (!cell) return null;
                const raw = rawInput(wb, cell);
                return {
                  value: cellView(wb, cell).text,
                  formula: raw.startsWith("=") ? raw.slice(1) : null,
                };
              },
            },
            chipWords,
          )
        : { focus: undefined, selected: null };
    session.dock.set({
      page: documentDockPage({
        kind: "sheet",
        name: now.name,
        rootArtifactId,
        artifactId: now.artifactId,
        version: now.version,
        focus: context.focus,
        selected: context.selected,
      }),
    });
  }, [session, rootArtifactId, chipWords]);

  const load = useCallback(
    async (reason: "open" | "newer" | "reload") => {
      const seq = ++loadSeq.current;
      try {
        const detail = await queries.documents.get.call({ rootArtifactId });
        if (detail.format !== "xlsx") throw new Error("not a spreadsheet");
        const shown = latest.current?.version ?? 0;
        latest.current = {
          artifactId: detail.latest.artifactId,
          version: detail.latest.version,
          name: detail.name,
          versions: detail.versions,
        };
        const bytes = await fetchDownload(downloadTokenUrl(detail.latest.downloadToken));
        const wb = await openWorkbook(new Uint8Array(bytes));
        if (seq !== loadSeq.current) return;
        const before = workbook.current;
        workbook.current = wb;
        checks.current.clear();
        queue.current?.rebase(detail.latest.version);
        setDoc({
          rootArtifactId: detail.rootArtifactId,
          name: detail.name,
          artifactId: detail.latest.artifactId,
          version: detail.latest.version,
          wb,
          versions: detail.versions,
          loaded: seq,
        });
        setLoadError(false);
        setBroken(false);
        publishNote();
        if (reason !== "open" && detail.latest.version > shown) {
          const sheet = view.current?.sheet ?? "";
          window.clearTimeout(timers.current.flash);
          setFlash({
            version: detail.latest.version,
            sheet,
            cells: before && sheet ? changedCells(before, wb, sheet) : new Set(),
          });
          timers.current.flash = window.setTimeout(() => setFlash(null), FLASH_MS);
        }
      } catch {
        if (seq === loadSeq.current) setLoadError(true);
      }
    },
    [queries, rootArtifactId, publishNote],
  );

  const conflictText = t`A newer version of this spreadsheet was saved, so it has been loaded. Make your last change again.`;
  const latestCallbacks = useRef({ load, publishNote, conflictText });
  latestCallbacks.current = { load, publishNote, conflictText };

  // One save queue per file. Opening never writes; only edits in the grid queue a save.
  useEffect(() => {
    const saves = createSaveQueue({
      baseVersion: latest.current?.version ?? 1,
      serialize: async () => {
        const wb = workbook.current;
        return wb ? saveVerified(wb, [...checks.current.values()]) : null;
      },
      upload: ({ bytes, baseVersion, clientNonce }) =>
        uploadDocumentVersion({
          rootArtifactId,
          format: "xlsx",
          bytes,
          baseVersion,
          clientNonce,
          spaceId,
        }),
      onChange: setSaveState,
      onSaved: (saved) => {
        const now = latest.current;
        const row = {
          artifactId: saved.artifactId,
          version: saved.version,
          size: 0,
          createdAt: new Date().toISOString(),
        };
        if (now) {
          latest.current = {
            ...now,
            artifactId: saved.artifactId,
            version: saved.version,
            versions: withSavedVersion(now.versions, row),
          };
        }
        setDoc((prev) =>
          prev
            ? {
                ...prev,
                artifactId: saved.artifactId,
                version: saved.version,
                versions: withSavedVersion(prev.versions, row),
              }
            : prev,
        );
        latestCallbacks.current.publishNote();
        void queryClient.invalidateQueries({ queryKey: queries.documents.list.key() });
      },
      onConflict: () => {
        toast(latestCallbacks.current.conflictText);
        void latestCallbacks.current.load("reload");
      },
    });
    queue.current = saves;
    return () => {
      void saves.flush().finally(() => saves.dispose());
      if (queue.current === saves) queue.current = null;
    };
  }, [rootArtifactId, spaceId, queries, queryClient]);

  useEffect(() => {
    if (!rootArtifactId) return;
    latest.current = null;
    workbook.current = null;
    view.current = null;
    owner.current = null;
    checks.current.clear();
    setDoc(null);
    setFlash(null);
    void latestCallbacks.current.load("open");
  }, [rootArtifactId]);

  useEffect(
    () => () => {
      window.clearTimeout(timers.current.note);
      window.clearTimeout(timers.current.flash);
    },
    [],
  );

  // The assistant's versions arrive here, and while it works its live draft.
  const parseDraft = useCallback((bytes: ArrayBuffer) => openWorkbook(new Uint8Array(bytes)), []);
  const { revision, draft } = useLiveDraft({
    rootArtifactId,
    enabled: doc !== null,
    running,
    shownVersion: doc?.version,
    parse: parseDraft,
  });
  const newest = revision.data?.version;
  useEffect(() => {
    const shown = latest.current?.version;
    const saves = queue.current;
    if (newest === undefined || shown === undefined || newest <= shown || !saves) return;
    const now = saves.state();
    if (now.status === "saving") return;
    // Unsaved edits go first; the server then answers with a conflict and the newest version loads.
    if (now.dirty) void saves.flush();
    else void load("newer");
  }, [newest, load]);

  useEffect(() => {
    if (running && queue.current?.state().dirty) void queue.current.flush();
  }, [running]);

  // The chat saves this workbook, then attaches its newest version, before each message.
  useEffect(() => {
    if (!session) return;
    return setStudioBeforeSend(session, async () => {
      await queue.current?.flush();
      const now = latest.current;
      if (!now) return null;
      publishNote();
      owner.current ??= queries.artifacts.meta
        .call({ artifactId: rootArtifactId })
        .then((meta) => ({ botId: meta.botId, groupId: meta.groupId }));
      const { botId, groupId } = await owner.current;
      return {
        artifactId: now.artifactId,
        familyArtifactIds: now.versions.map((row) => row.artifactId),
        botId,
        groupId,
      };
    });
  }, [session, queries, rootArtifactId, publishNote]);

  useEffect(() => {
    const flushNow = () => void queue.current?.flush();
    window.addEventListener("pagehide", flushNow);
    return () => window.removeEventListener("pagehide", flushNow);
  }, []);

  const list = useQuery({
    ...queries.documents.list.queryOptions({ input: { format: "xlsx", limit: 30 } }),
    refetchInterval: 15_000,
  });
  const documents = list.data?.items ?? [];

  async function settle() {
    await Promise.race([
      queue.current?.flush(),
      new Promise((resolve) => window.setTimeout(resolve, CLOSE_SAVE_WAIT_MS)),
    ]);
  }

  async function close() {
    setBusy(true);
    await settle();
    onClose();
  }

  async function switchTo(id: string) {
    if (id === rootArtifactId) return;
    setBusy(true);
    await settle();
    setBusy(false);
    onOpenDocument(id);
  }

  async function create() {
    setBusy(true);
    try {
      await settle();
      const created = await queries.documents.create.call({
        format: "xlsx",
        title: t`Untitled spreadsheet`,
        ...documentBot,
      });
      await queryClient.invalidateQueries({ queryKey: queries.documents.list.key() });
      onOpenDocument(created.rootArtifactId);
    } catch (error) {
      const code = errorCode(error);
      toast.error(
        code === "PRECONDITION_FAILED"
          ? t`New spreadsheets can't be made here yet.`
          : code === "STORAGE_FULL"
            ? t`There's no room for a new spreadsheet. Free up storage and try again.`
            : t`Couldn't make a new spreadsheet.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    try {
      await settle();
      const now = latest.current;
      if (!now) return;
      const { url } = await queries.artifacts.downloadToken.call({ artifactId: now.artifactId });
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.rel = "noopener";
      anchor.download = now.name;
      anchor.click();
    } catch {
      toast.error(t`Couldn't download the spreadsheet.`);
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
      const settled = await queue.current?.flush();
      if (settled?.status === "conflict") return;
      const now = latest.current;
      if (!now) return;
      const { url } = await queries.artifacts.downloadToken.call({ artifactId: row.artifactId });
      const bytes = new Uint8Array(await fetchDownload(url));
      const result = await uploadDocumentVersion({
        rootArtifactId,
        format: "xlsx",
        bytes,
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

  const onEdit = useCallback((edited: SavedExpectation[]) => {
    const map = checks.current;
    for (const check of edited) {
      const key = `${check.sheet}!${cellRef(check.pos)}`;
      map.delete(key);
      map.set(key, check);
    }
    while (map.size > MAX_CHECKS) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
    queue.current?.edit();
  }, []);

  const onView = useCallback(
    (next: SheetView) => {
      view.current = next;
      window.clearTimeout(timers.current.note);
      timers.current.note = window.setTimeout(publishNote, 300);
    },
    [publishNote],
  );

  const rows = useMemo(() => (doc ? versionRows(doc.versions, doc.version) : []), [doc]);
  const title = doc ? displayName(doc.name) : t`Spreadsheets`;
  const locked = running || restoring !== null || saveState?.status === "conflict";

  const status = saveState?.status;
  const statusText =
    status === "saving"
      ? t`Saving…`
      : status === "saved"
        ? t`Saved`
        : status === "failed"
          ? t`Not saved. Trying again…`
          : status === "invalid" || status === "refused"
            ? t`Not saved`
            : status === "conflict"
              ? t`Loading the newest version…`
              : null;

  const notSavedBefore = useRef<string | null>(null);
  useEffect(() => {
    if (status !== "refused" && status !== "invalid") {
      notSavedBefore.current = null;
      return;
    }
    const key = `${status}:${saveState?.detail ?? ""}`;
    if (notSavedBefore.current === key) return;
    notSavedBefore.current = key;
    toast.error(
      status === "invalid"
        ? t`This change wasn't saved because the file didn't check out after saving. Make the change again or download the file.`
        : t`This change wasn't saved. There may be no room left, or the file is too large.`,
    );
  }, [status, saveState?.detail, t]);

  const failed = (loadError && !doc) || broken;
  const flashVersion = flash?.version;
  const uploader = useDocumentUpload("xlsx", onOpenDocument, settle);

  return (
    <StudioFrame
      testId="sheet-studio"
      title={title}
      paneLabel={title}
      onClose={() => void close()}
      closeLabel={t`Close spreadsheet`}
      dock={dock}
      dockLift="2.25rem"
      workingLabel={t`Working on your spreadsheet…`}
      start={
        <>
          <DropdownMenu>
            <DropdownMenuTrigger
              data-testid="sheet-new"
              disabled={busy || uploader.busy}
              aria-label={t`New spreadsheet`}
              title={t`New spreadsheet`}
              className={`${control} size-[35px] disabled:opacity-40`}
            >
              {busy || uploader.busy ? (
                <Loader2 className="size-[18px] animate-spin" strokeWidth={1.7} />
              ) : (
                <Plus className="size-[18px]" strokeWidth={1.7} />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onClick={() => void create()}>
                <Plus className="size-4" />
                <Trans>New spreadsheet</Trans>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={uploader.choose}>
                <Upload className="size-4" />
                <Trans>Upload a .xlsx file</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {uploader.input}
          <DropdownMenu>
            <DropdownMenuTrigger
              data-testid="sheet-switcher"
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-w-0 max-w-[38vw] gap-1.5 font-medium sm:max-w-[320px]"
                />
              }
            >
              <FileSpreadsheet className="size-4 shrink-0 text-foreground/70" strokeWidth={1.8} />
              <span className="truncate">{title}</span>
              <ChevronDown className="size-3.5 shrink-0 opacity-65" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-80">
              {documents.length === 0 ? (
                <DropdownMenuItem disabled>
                  <Trans>No other spreadsheets yet</Trans>
                </DropdownMenuItem>
              ) : null}
              {documents.map((item) => (
                <DropdownMenuItem
                  key={item.rootArtifactId}
                  onClick={() => void switchTo(item.rootArtifactId)}
                  className="flex items-center gap-2"
                >
                  <FileSpreadsheet
                    className="size-4 shrink-0 text-foreground/60"
                    strokeWidth={1.8}
                  />
                  <span className="min-w-0 flex-1 truncate">{displayName(item.name)}</span>
                  <span className="shrink-0 text-[12px] text-muted-foreground">
                    {formatRelativeTime(item.updatedAt)}
                  </span>
                  {item.rootArtifactId === rootArtifactId ? (
                    <Check className="size-4 shrink-0 text-primary" />
                  ) : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={busy || uploader.busy} onClick={uploader.choose}>
                <Upload className="size-4" />
                <Trans>Upload a .xlsx file</Trans>
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
              title={saveState?.detail ?? undefined}
              data-testid="sheet-save-status"
              aria-live="polite"
            >
              {statusText}
            </span>
          ) : null}
          <HistoryButton
            open={historyOpen}
            disabled={!doc}
            onOpenChange={(next) => void openHistory(next)}
          />
        </>
      }
      share={
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={!doc && !loadError}
            data-testid="sheet-share"
            aria-label={t`Share`}
            className={`${pill} disabled:opacity-40`}
          >
            <Share className="size-4" strokeWidth={1.8} />
            <span className="max-sm:sr-only">
              <Trans>Share</Trans>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => void download()}>
              <Download className="size-4" />
              <Trans>Download .xlsx</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      {failed ? (
        <div className="grid size-full place-items-center p-6">
          <div className="flex max-w-sm flex-col items-center gap-3 text-center">
            <p className="text-[14px] text-muted-foreground">
              <Trans>
                This spreadsheet couldn't be opened here. Download it to open it in a spreadsheet
                app, or ask the assistant for changes.
              </Trans>
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void load("open")}>
                <RefreshCw className="size-4" />
                <Trans>Try again</Trans>
              </Button>
              {latest.current ? (
                <Button
                  size="sm"
                  onClick={() => void download()}
                  data-testid="sheet-error-download"
                >
                  <Download className="size-4" />
                  <Trans>Download .xlsx</Trans>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : !doc ? (
        <div className="grid size-full place-items-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t`Loading`} />
        </div>
      ) : (
        <div
          className={`relative size-full ring-inset transition-shadow duration-700 ${
            flash !== null ? "ring-2 ring-primary" : ""
          }`}
        >
          <EditorBoundary key={doc.rootArtifactId} onError={() => setBroken(true)} fallback={null}>
            <SheetWorkbench
              wb={draft?.value ?? doc.wb}
              readOnly={locked || draft !== null}
              initialView={view.current}
              highlight={draft ? null : flash}
              onEdit={onEdit}
              onView={onView}
            />
          </EditorBoundary>
          {draft ? (
            <LiveDraftPill className="top-12" />
          ) : running ? (
            <div className="pointer-events-none absolute inset-x-0 top-12 flex justify-center">
              <span className="flex items-center gap-1.5 rounded-full bg-background/95 px-3 py-1 text-[12px] font-medium text-primary shadow-sm ring-1 ring-border">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                <Trans>Updating…</Trans>
              </span>
            </div>
          ) : flash !== null ? (
            <div className="pointer-events-none absolute inset-x-0 top-12 flex justify-center">
              <span
                className="rounded-full bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground shadow-sm"
                aria-live="polite"
              >
                <Trans>Updated to version {flashVersion}</Trans>
              </span>
            </div>
          ) : null}
          {historyOpen ? (
            <VersionHistoryPanel
              format={workbookHistory}
              rows={rows}
              restoring={restoring}
              onRestore={(row) => void restore(row)}
              onClose={() => setHistoryOpen(false)}
            />
          ) : null}
        </div>
      )}
    </StudioFrame>
  );
}
