import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { ViewportOptions } from "@jantt/core";
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
  GanttChart,
  History,
  Link2,
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
import {
  control,
  pill,
  StudioFrame,
  StudioHint,
  StudioMoreMenu,
  useStudioDock,
} from "../studio/StudioFrame";
import { StudioSwitcherDelete } from "../studio/StudioSwitcherDelete";
import { setStudioBeforeSend } from "../studio/studio-send";
import { documentDockPage } from "./context";
import { DocumentLoadOverlay, DocumentLoadPanel } from "./DocumentLoadPanel";
import { useDocumentBotId, usePublishStudioToChat } from "./document-bot";
import { DOCUMENT_LOAD_ATTEMPTS } from "./document-load";
import { HistoryButton, VersionHistoryPanel } from "./history/VersionHistory";
import { adoptLoadedVersion } from "./adopt-loaded-version";
import { prepareDocumentStudioSend } from "./prepare-document-studio-send";
import { EvolveJobLinkButton, EvolveJobLinkDialog } from "./planner/EvolveJobLink";
import { exportProgrammePdf } from "./planner/export-programme-pdf";
import { planHistory } from "./planner/history";
import { planContext, type PlanView } from "./planner/context";
import { PlannerWorkbench, type ChartScroll } from "./planner/PlannerWorkbench";
import {
  changedTaskIds,
  evolveLinkOf,
  parsePlan,
  planBytes,
  withEvolveLink,
  type PlanDocument,
  type PlanEvolveLink,
} from "./planner/plan";
import { preparePlanUpload } from "./planner/upload-plan";
import { useApplyNewerVersion } from "./use-apply-newer-version";
import { useDeleteOfficeDocument } from "./use-delete-document";
import { useDocumentLoad } from "./use-document-load";
import { useDocumentUpload } from "./use-document-upload";
import { LiveDraftPill, useLiveDraft } from "./use-live-draft";
import { EditorBoundary } from "./word/EditorBoundary";
import type { SaveQueue, SaveQueueState } from "./word/save-queue";
import { createSaveQueue } from "./word/save-queue";
import { fetchDownload, uploadDocumentVersion } from "./word/upload";
import type { VersionRow } from "./word/versions";
import { versionRows, withSavedVersion } from "./word/versions";
import {
  exportMsProjectXml,
  exportSpreadsheetCsv,
  importSpreadsheetCsv,
} from "@jantt/interop";

export type PlannerStudioProps = {
  rootArtifactId: string;
  onClose: () => void;
  onOpenDocument: (rootArtifactId: string) => void;
  onEmpty?: () => void;
};

type OpenPlan = {
  rootArtifactId: string;
  name: string;
  artifactId: string;
  version: number;
  plan: PlanDocument;
  versions: DocumentVersion[];
  loaded: number;
};

type Latest = { artifactId: string; version: number; name: string; versions: DocumentVersion[] };

const CLOSE_SAVE_WAIT_MS = 5000;
const FLASH_MS = 4000;
/** How long the tasks the assistant changed stay pointed out after its version loads. */
const CHANGES_MS = 10_000;
const EVOLVE_PEOPLE_STALE_MS = 10 * 60_000;

function displayName(name: string): string {
  return name.replace(/\.jantt$/i, "");
}

/**
 * Project plans full screen beside the chat. Edits (human or assistant) save as versioned .jantt
 * JSON; MS Project XML and CSV import/export sit in the share menu.
 */
export default function PlannerStudio({
  rootArtifactId,
  onClose,
  onOpenDocument,
  onEmpty,
}: PlannerStudioProps) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const documentBot = useDocumentBotId();
  const spaceId = useBoundSpaceId() ?? selectedSpaceId();
  const dock = useStudioDock();
  const { session, running } = dock;
  // Task owners are picked from Evolve's CV profiles; when Evolve is not linked the box stays free text.
  const evolvePeople = useQuery({
    ...queries.evolveReferences.people.queryOptions(),
    staleTime: EVOLVE_PEOPLE_STALE_MS,
    retry: false,
  });

  const [doc, setDoc] = useState<OpenPlan | null>(null);
  const [broken, setBroken] = useState(false);
  const [saveState, setSaveState] = useState<SaveQueueState | null>(null);
  const [flash, setFlash] = useState<{ version: number; tasks: Set<string> } | null>(null);
  const [recentChanges, setRecentChanges] = useState<Set<string> | null>(null);
  const chartView = useRef<ViewportOptions | undefined>(undefined);
  const chartScroll = useRef<ChartScroll | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [evolveOpen, setEvolveOpen] = useState(false);
  const [view, setView] = useState<PlanView>({ selectedTaskId: null });

  const queue = useRef<SaveQueue | null>(null);
  const latest = useRef<Latest | null>(null);
  const planRef = useRef<PlanDocument | null>(null);
  const owner = useRef<Promise<{ botId: string | null; groupId: string | null }> | null>(null);
  const viewRef = useRef<PlanView>(view);
  viewRef.current = view;
  const timers = useRef({ note: 0, flash: 0, retry: 0, changes: 0 });
  const [newerTick, setNewerTick] = useState(0);
  const importXmlRef = useRef<HTMLInputElement>(null);
  const importCsvRef = useRef<HTMLInputElement>(null);
  const { loadState, loadBytes, stillCurrent, markReady, markOpenFailed } = useDocumentLoad(
    "jantt",
    () => queries.documents.get.call({ rootArtifactId }),
  );

  const publishNote = useCallback(() => {
    const now = latest.current;
    const plan = planRef.current;
    if (!session || !now || !plan) return;
    const context = planContext(plan, viewRef.current);
    session.dock.set({
      page: documentDockPage({
        kind: "plan",
        name: now.name,
        rootArtifactId,
        artifactId: now.artifactId,
        version: now.version,
        focus: context.focus,
        selected: context.selected,
      }),
    });
  }, [session, rootArtifactId]);
  usePublishStudioToChat(publishNote);

  const load = useCallback(
    async (reason: "open" | "newer" | "reload") => {
      const loaded = await loadBytes();
      if (!loaded) return;
      const { detail, bytes, turn } = loaded;
      const shown = latest.current?.version ?? 0;
      try {
        const plan = parsePlan(bytes);
        if (!adoptLoadedVersion(latest, turn, stillCurrent, detail)) return;
        const before = planRef.current;
        planRef.current = plan;
        queue.current?.rebase(detail.latest.version);
        setDoc({
          rootArtifactId: detail.rootArtifactId,
          name: detail.name,
          artifactId: detail.latest.artifactId,
          version: detail.latest.version,
          plan,
          versions: detail.versions,
          loaded: turn,
        });
        setBroken(false);
        markReady(turn);
        publishNote();
        if (reason !== "open" && detail.latest.version > shown) {
          window.clearTimeout(timers.current.flash);
          const tasks = changedTaskIds(before, plan);
          setFlash({ version: detail.latest.version, tasks });
          timers.current.flash = window.setTimeout(() => setFlash(null), FLASH_MS);
          window.clearTimeout(timers.current.changes);
          setRecentChanges(tasks.size ? tasks : null);
          timers.current.changes = window.setTimeout(() => setRecentChanges(null), CHANGES_MS);
        }
      } catch {
        markOpenFailed(turn);
        window.clearTimeout(timers.current.retry);
        if (reason !== "open" && stillCurrent(turn)) {
          timers.current.retry = window.setTimeout(() => {
            if (stillCurrent(turn)) setNewerTick((n) => n + 1);
          }, 1200);
        }
      }
    },
    [loadBytes, stillCurrent, markReady, markOpenFailed, publishNote],
  );

  const conflictText = t`A newer version of this plan was saved, so it has been loaded. Make your last change again.`;
  const latestCallbacks = useRef({ load, publishNote, conflictText });
  latestCallbacks.current = { load, publishNote, conflictText };

  useEffect(() => {
    const saves = createSaveQueue({
      baseVersion: latest.current?.version ?? 1,
      serialize: async () => {
        const plan = planRef.current;
        return plan ? planBytes(plan) : null;
      },
      upload: ({ bytes, baseVersion, clientNonce }) =>
        uploadDocumentVersion({
          rootArtifactId,
          format: "jantt",
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
    planRef.current = null;
    setDoc(null);
    setFlash(null);
    setView({ selectedTaskId: null });
    setNewerTick(0);
    chartView.current = undefined;
    chartScroll.current = null;
    setRecentChanges(null);
    void latestCallbacks.current.load("open");
  }, [rootArtifactId]);

  useEffect(
    () => () => {
      window.clearTimeout(timers.current.note);
      window.clearTimeout(timers.current.flash);
      window.clearTimeout(timers.current.retry);
      window.clearTimeout(timers.current.changes);
    },
    [],
  );

  const settle = useCallback(async () => {
    await Promise.race([
      queue.current?.flush(),
      new Promise((resolve) => window.setTimeout(resolve, CLOSE_SAVE_WAIT_MS)),
    ]);
  }, []);

  const parseDraft = useCallback(
    (bytes: ArrayBuffer) => Promise.resolve(parsePlan(bytes)),
    [],
  );
  const { revision, draft } = useLiveDraft({
    rootArtifactId,
    enabled: doc !== null,
    running,
    shownVersion: doc?.version,
    parse: parseDraft,
  });
  const newest = revision.data?.version;
  const loadNewer = useCallback(() => load("newer"), [load]);
  const { resetOpenFailures } = useApplyNewerVersion({
    newest,
    saveStatus: saveState?.status,
    queue,
    latest,
    loadNewer,
    openFailureTick: newerTick,
    maxOpenFailures: 3,
  });

  useEffect(() => {
    if (running && queue.current?.state().dirty) void queue.current.flush();
  }, [running]);

  useEffect(() => {
    if (!session) return;
    return setStudioBeforeSend(session, async () => {
      const saves = queue.current;
      if (!saves) return null;
      owner.current ??= queries.artifacts.meta
        .call({ artifactId: rootArtifactId })
        .then((meta) => ({ botId: meta.botId, groupId: meta.groupId }));
      return prepareDocumentStudioSend({
        flush: () => saves.flush(),
        getLatest: () => latest.current,
        publishNote,
        owner: () => owner.current!,
        resolveConflict: () => load("reload"),
      });
    });
  }, [session, queries, rootArtifactId, publishNote, load]);

  useEffect(() => {
    const flushNow = () => void queue.current?.flush();
    window.addEventListener("pagehide", flushNow);
    return () => window.removeEventListener("pagehide", flushNow);
  }, []);

  const list = useQuery({
    ...queries.documents.list.queryOptions({ input: { format: "jantt", limit: 30 } }),
    refetchInterval: 15_000,
  });
  const documents = list.data?.items ?? [];
  const deleteDocument = useDeleteOfficeDocument({
    currentId: rootArtifactId,
    documents,
    settle,
    onOpenDocument,
    onEmpty,
  });

  async function create() {
    setBusy(true);
    try {
      await settle();
      const created = await queries.documents.create.call({
        format: "jantt",
        title: t`Untitled plan`,
        ...documentBot,
      });
      await queryClient.invalidateQueries({ queryKey: queries.documents.list.key() });
      onOpenDocument(created.rootArtifactId);
    } catch (error) {
      const code = errorCode(error);
      toast.error(
        code === "STORAGE_FULL"
          ? t`There's no room for a new plan. Free up storage and try again.`
          : t`Couldn't make a new plan.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function switchTo(id: string) {
    if (id === rootArtifactId) return;
    await settle();
    onOpenDocument(id);
  }

  async function close() {
    const wait = queue.current?.flush() ?? Promise.resolve();
    await Promise.race([wait, new Promise((resolve) => setTimeout(resolve, CLOSE_SAVE_WAIT_MS))]);
    onClose();
  }

  async function download(kind: "jantt" | "xml" | "csv" | "pdf" = "jantt") {
    try {
      // The .jantt download is the saved file, so the last edit has to be saved first.
      if (kind === "jantt") await settle();
      const now = latest.current;
      const plan = planRef.current;
      if (!now) return;
      if (kind === "pdf") {
        if (!plan) return;
        const result = await exportProgrammePdf(plan, { fileName: displayName(now.name) });
        const url = URL.createObjectURL(result.blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = result.fileName;
        anchor.click();
        URL.revokeObjectURL(url);
        return;
      }
      if (kind === "xml" || kind === "csv") {
        if (!plan) return;
        const text = kind === "xml" ? exportMsProjectXml(plan) : exportSpreadsheetCsv(plan);
        const blob = new Blob([text], {
          type: kind === "xml" ? "application/xml" : "text/csv",
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${displayName(now.name)}.${kind === "xml" ? "xml" : "csv"}`;
        anchor.click();
        URL.revokeObjectURL(url);
        return;
      }
      const { url } = await queries.artifacts.downloadToken.call({ artifactId: now.artifactId });
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.rel = "noopener";
      anchor.download = now.name.endsWith(".jantt") ? now.name : `${now.name}.jantt`;
      anchor.click();
    } catch {
      toast.error(t`Couldn't download this plan.`);
    }
  }

  function applyPlan(next: PlanDocument, markDirty = true) {
    planRef.current = next;
    setDoc((prev) => (prev ? { ...prev, plan: next } : prev));
    window.clearTimeout(timers.current.note);
    timers.current.note = window.setTimeout(publishNote, 300);
    if (markDirty) queue.current?.edit();
  }

  function onCommit(next: PlanDocument) {
    applyPlan(next, true);
  }

  function setEvolveLink(link: PlanEvolveLink | null) {
    const plan = planRef.current;
    if (!plan) return;
    applyPlan(withEvolveLink(plan, link), true);
  }

  async function importFile(file: File, kind: "xml" | "csv") {
    try {
      const lower = file.name.toLowerCase();
      let imported: PlanDocument;
      if (lower.endsWith(".mpp") || kind === "xml") {
        const prepared = await preparePlanUpload(file, { spaceId });
        if (prepared.kind === "refused") {
          toast.error(prepared.message);
          return;
        }
        imported = JSON.parse(await prepared.file.text()) as PlanDocument;
      } else {
        imported = importSpreadsheetCsv(await file.text()) as PlanDocument;
      }
      const current = planRef.current;
      const merged: PlanDocument = {
        ...imported,
        categories: {
          default: { label: "General", color: "#76BF43" },
          ...(imported.categories ?? {}),
        },
        meta: {
          ...(imported.meta ?? {}),
          title: imported.meta?.title || current?.meta?.title || displayName(file.name),
          evolve: current?.meta?.evolve,
        },
      };
      applyPlan(merged, true);
      toast.success(t`Imported ${merged.tasks?.length ?? 0} tasks into this plan.`);
    } catch {
      toast.error(
        kind === "xml"
          ? t`Couldn't read that Microsoft Project file. Upload .mpp or Project XML (.xml).`
          : t`Couldn't read that CSV file.`,
      );
    }
  }

  async function openHistory(next: boolean) {
    if (next) await settle();
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
        format: "jantt",
        bytes,
        baseVersion: now.version,
        clientNonce: crypto.randomUUID(),
        spaceId,
      });
      if (result.kind === "saved") {
        toast.success(t`Restored version ${row.version} as a new version.`);
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
  const title = doc ? displayName(doc.name) : t`Project plans`;
  const locked = running || restoring !== null || saveState?.status === "conflict";
  const evolveLink = doc ? evolveLinkOf(draft?.value ?? doc.plan) : null;

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

  const uploader = useDocumentUpload("jantt", onOpenDocument, settle);
  const loadFailed = loadState.status === "error" && !doc;
  const shownPlan = draft?.value ?? doc?.plan;
  const draftChanges = useMemo(
    () => (draft ? changedTaskIds(doc?.plan, draft.value) : null),
    [draft, doc?.plan],
  );
  const highlightTaskIds = draftChanges ?? recentChanges ?? undefined;

  return (
    <StudioFrame
      testId="planner-studio"
      title={title}
      paneLabel={title}
      product={t`Evolve Project`}
      onClose={() => void close()}
      closeLabel={t`Close plan`}
      dock={dock}
      dockLift="2.25rem"
      workingLabel={t`Working on your plan…`}
      start={
        <>
          <DropdownMenu>
            <StudioHint
              label={t`Start a blank plan, or upload a .jantt, Microsoft Project XML, or CSV.`}
            >
              <DropdownMenuTrigger
                data-testid="planner-new"
                disabled={busy || uploader.busy}
                aria-label={t`New plan`}
                className={`${control} size-8 sm:size-[35px] disabled:opacity-40`}
              >
                {busy || uploader.busy ? (
                  <Loader2 className="size-[18px] animate-spin" strokeWidth={1.7} />
                ) : (
                  <Plus className="size-4 sm:size-[18px]" strokeWidth={1.7} />
                )}
              </DropdownMenuTrigger>
            </StudioHint>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuItem onClick={() => void create()}>
                <Plus className="size-4" />
                <Trans>New plan</Trans>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={uploader.choose}>
                <Upload className="size-4" />
                <Trans>Upload plan or MS Project XML</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {uploader.input}
          <DropdownMenu>
            <StudioHint label={t`Open another plan.`}>
              <DropdownMenuTrigger
                data-testid="planner-switcher"
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-w-0 max-w-[38vw] gap-1.5 font-medium sm:max-w-[320px]"
                  />
                }
              >
                <GanttChart className="size-4 shrink-0 text-foreground/70" strokeWidth={1.8} />
                <span className="truncate">{title}</span>
                <ChevronDown className="size-3.5 shrink-0 opacity-65" />
              </DropdownMenuTrigger>
            </StudioHint>
            <DropdownMenuContent align="start" className="w-80">
              {documents.length === 0 ? (
                <DropdownMenuItem disabled>
                  <Trans>No other plans yet</Trans>
                </DropdownMenuItem>
              ) : null}
              {documents.map((item) => (
                <DropdownMenuItem
                  key={item.rootArtifactId}
                  onClick={() => void switchTo(item.rootArtifactId)}
                  className="flex items-center gap-2"
                >
                  <GanttChart className="size-4 shrink-0 text-foreground/60" strokeWidth={1.8} />
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
              data-testid="planner-save-status"
              aria-live="polite"
            >
              {statusText}
            </span>
          ) : null}
          <EvolveJobLinkButton
            link={evolveLink}
            disabled={!doc || locked || draft !== null}
            onOpen={() => setEvolveOpen(true)}
            className="max-sm:hidden"
          />
          {/* Phones: one More menu so History / Share / Evolve cannot clip Close. */}
          <StudioMoreMenu>
            <DropdownMenuItem
              disabled={!doc || locked || draft !== null}
              onClick={() => setEvolveOpen(true)}
            >
              <Link2 className="size-4" strokeWidth={1.8} />
              <Trans>Link Evolve job</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!doc} onClick={() => void openHistory(true)}>
              <History className="size-4" strokeWidth={1.8} />
              <Trans>History</Trans>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!doc && !loadFailed} onClick={() => void download("jantt")}>
              <Download className="size-4" />
              <Trans>Download .jantt</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!doc} onClick={() => void download("xml")}>
              <Download className="size-4" />
              <Trans>Export MS Project XML</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!doc} onClick={() => void download("csv")}>
              <FileSpreadsheet className="size-4" />
              <Trans>Export CSV</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!doc} onClick={() => void download("pdf")}>
              <Download className="size-4" />
              <Trans>Export programme PDF</Trans>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!doc || locked} onClick={() => importXmlRef.current?.click()}>
              <Upload className="size-4" />
              <Trans>Import MS Project XML</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!doc || locked} onClick={() => importCsvRef.current?.click()}>
              <Upload className="size-4" />
              <Trans>Import CSV</Trans>
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
          <StudioHint label={t`Download or import a schedule.`}>
            <DropdownMenuTrigger
              disabled={!doc && !loadFailed}
              data-testid="planner-share"
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
            <DropdownMenuItem onClick={() => void download("jantt")}>
              <Download className="size-4" />
              <Trans>Download .jantt</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!doc} onClick={() => void download("xml")}>
              <Download className="size-4" />
              <Trans>Export MS Project XML</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!doc} onClick={() => void download("csv")}>
              <FileSpreadsheet className="size-4" />
              <Trans>Export CSV</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!doc} onClick={() => void download("pdf")}>
              <Download className="size-4" />
              <Trans>Export programme PDF</Trans>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!doc || locked} onClick={() => importXmlRef.current?.click()}>
              <Upload className="size-4" />
              <Trans>Import MS Project XML</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!doc || locked} onClick={() => importCsvRef.current?.click()}>
              <Upload className="size-4" />
              <Trans>Import CSV</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <EvolveJobLinkDialog
        open={evolveOpen}
        current={evolveLink}
        onClose={() => setEvolveOpen(false)}
        onPick={(next) => {
          setEvolveLink(next);
          setEvolveOpen(false);
        }}
      />
      <input
        ref={importXmlRef}
        type="file"
        accept=".xml,.mpp,application/xml,text/xml"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importFile(file, "xml");
        }}
      />
      <input
        ref={importCsvRef}
        type="file"
        accept=".csv,.tsv,text/csv,text/tab-separated-values"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importFile(file, "csv");
        }}
      />
      {broken && !loadFailed ? (
        <div className="grid size-full place-items-center p-6">
          <div className="flex max-w-sm flex-col items-center gap-3 text-center">
            <p className="text-[14px] text-muted-foreground">
              <Trans>
                This plan couldn't be opened here. Download it, or ask the assistant for changes.
              </Trans>
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void load("open")}>
                <RefreshCw className="size-4" />
                <Trans>Try again</Trans>
              </Button>
              {latest.current ? (
                <Button size="sm" onClick={() => void download("jantt")}>
                  <Download className="size-4" />
                  <Trans>Download .jantt</Trans>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : !doc || !shownPlan ? (
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
          fileLabel={t`plan`}
          onRetry={() => void load("open")}
        />
      ) : (
        <div
          className={`relative size-full ring-inset transition-shadow duration-700 ${
            flash !== null ? "ring-2 ring-primary" : ""
          }`}
        >
          <EditorBoundary key={doc.rootArtifactId} onError={() => setBroken(true)} fallback={null}>
            <PlannerWorkbench
              key={draft?.updatedAt ?? doc.loaded}
              plan={shownPlan}
              readOnly={locked || draft !== null}
              selectedTaskId={view.selectedTaskId}
              highlightTaskIds={highlightTaskIds}
              initialView={chartView.current}
              onViewChange={(next) => {
                chartView.current = next;
              }}
              scroll={chartScroll}
              people={evolvePeople.data?.people}
              onCommit={onCommit}
              onSelectTask={(taskId) => {
                setView({ selectedTaskId: taskId });
                window.clearTimeout(timers.current.note);
                timers.current.note = window.setTimeout(publishNote, 300);
              }}
            />
          </EditorBoundary>
          <DocumentLoadOverlay state={loadState} />
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
                <Trans>Updated to version {flash.version}</Trans>
                {flash.tasks.size > 0 ? (
                  <>
                    {" · "}
                    <Plural value={flash.tasks.size} one="# task changed" other="# tasks changed" />
                  </>
                ) : null}
              </span>
            </div>
          ) : null}
          {historyOpen ? (
            <VersionHistoryPanel
              format={planHistory}
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
