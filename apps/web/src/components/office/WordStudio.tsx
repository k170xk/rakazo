import { Trans, useLingui } from "@lingui/react/macro";
import type { DocumentVersion } from "@rakazo/contracts";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  toast,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  Download,
  FilePenLine,
  FileText,
  History,
  ListChecks,
  Loader2,
  Plus,
  RefreshCw,
  Share,
  Upload,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authClient } from "../../lib/auth";
import { useMedia } from "../../lib/pages";
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
import { DocumentLoadOverlay, DocumentLoadPanel } from "./DocumentLoadPanel";
import { useDocumentBotId, usePublishStudioToChat } from "./document-bot";
import { DOCUMENT_LOAD_ATTEMPTS } from "./document-load";
import { HistoryButton, VersionHistoryPanel } from "./history/VersionHistory";
import { adoptLoadedVersion } from "./adopt-loaded-version";
import { prepareDocumentStudioSend } from "./prepare-document-studio-send";
import { useApplyNewerVersion } from "./use-apply-newer-version";
import { useDeleteOfficeDocument } from "./use-delete-document";
import { useDocumentLoad } from "./use-document-load";
import { useDocumentUpload } from "./use-document-upload";
import { LiveDraftPill, useLiveDraft } from "./use-live-draft";
import type { WordChipWords, WordView } from "./word/context";
import { wordContext } from "./word/context";
import { EditorBoundary } from "./word/EditorBoundary";
import { wordHistory } from "./word/history";
import { lastOffice, orderedOffices, rememberOffice } from "./word/offices";
import { ReviewPanel } from "./word/ReviewPanel";
import type { ReviewItem } from "./word/review";
import { allReviewIds, reviewItems } from "./word/review";
import type { SaveQueue, SaveQueueState } from "./word/save-queue";
import { createSaveQueue } from "./word/save-queue";
import { readTrackChanges, rememberTrackChanges } from "./word/track-changes";
import { downloadTokenUrl, fetchDownload, uploadDocumentVersion } from "./word/upload";
import type { DocxIssue } from "./word/validation";
import { checkDocx, newDocxErrors } from "./word/validation";
import type { VersionRow } from "./word/versions";
import { versionRows, withSavedVersion } from "./word/versions";
import type { WordEditorHandle } from "./word/WordEditor";

const loadWordEditor = () => import("./word/WordEditor");
const WordEditor = lazy(loadWordEditor);
const WordPreview = lazy(() => import("./word/WordPreview"));

export type WordStudioProps = {
  rootArtifactId: string;
  onClose: () => void;
  onOpenDocument: (rootArtifactId: string) => void;
  onEmpty?: () => void;
};

/** The open file as loaded: its newest version's bytes and the history around it. */
type OpenDocument = {
  rootArtifactId: string;
  name: string;
  artifactId: string;
  version: number;
  bytes: ArrayBuffer;
  versions: DocumentVersion[];
  /** Changes only when bytes are loaded, so the person's own saves never remount the editor. */
  loaded: number;
};

/** What the chat and saves need synchronously, ahead of React's next render. */
type Latest = { artifactId: string; version: number; name: string; versions: DocumentVersion[] };

const CLOSE_SAVE_WAIT_MS = 5000;
const FLASH_MS = 4000;

const keepBytes = async (bytes: ArrayBuffer) => bytes;
const EMPTY = new ArrayBuffer(0);

function displayName(name: string): string {
  return name.replace(/\.docx$/i, "");
}

/**
 * Word documents full screen beside the chat. The person edits the newest version; their edits
 * save as new versions a moment after they stop, and the assistant's arrive as new versions too.
 */
export default function WordStudio({
  rootArtifactId,
  onClose,
  onOpenDocument,
  onEmpty,
}: WordStudioProps) {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const documentBot = useDocumentBotId();
  const spaceId = useBoundSpaceId() ?? selectedSpaceId();
  const dock = useStudioDock();
  const { session, running } = dock;
  const narrow = useMedia("(max-width: 840px)");
  const userName = authClient.useSession().data?.user.name;

  const [doc, setDoc] = useState<OpenDocument | null>(null);
  const [readOnlyView, setReadOnlyView] = useState(false);
  const [saveState, setSaveState] = useState<SaveQueueState | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [busy, setBusy] = useState(false);

  const editor = useRef<WordEditorHandle>(null);
  const queue = useRef<SaveQueue | null>(null);
  const latest = useRef<Latest | null>(null);
  const selection = useRef("");
  /** The Track changes switch, read when the studio note is published. */
  const trackChangesOn = useRef(readTrackChanges(rootArtifactId));
  /** Survives composer focus clearing the ProseMirror selection on mobile. */
  const heldImage = useRef<File | null>(null);
  const opened = useRef<DocxIssue[] | null>(null);
  const owner = useRef<Promise<{ botId: string | null; groupId: string | null }> | null>(null);
  const { loadState, loadBytes, stillCurrent, markReady, markOpenFailed } = useDocumentLoad(
    "docx",
    () => queries.documents.get.call({ rootArtifactId }),
  );
  const timers = useRef({ note: 0, review: 0, flash: 0 });

  const chipWords = useMemo<WordChipWords>(
    () => ({
      page: (page) => t`Page ${page}`,
      table: (name) => t`Table: ${name}`,
      tableUnnamed: t`Table`,
      image: (name) => t`Image: ${name}`,
      imageUnnamed: t`Image`,
      text: (excerpt) => t`Text: “${excerpt}”`,
    }),
    [t],
  );

  const publishNote = useCallback(() => {
    const now = latest.current;
    if (!session || !now) return;
    const view: WordView = editor.current?.view() ?? {
      page: 1,
      pages: 0,
      pageText: null,
      headings: [],
      selection: selection.current ? { kind: "text", text: selection.current } : null,
    };
    const { focus, selected } = wordContext(view, chipWords);
    session.dock.set({
      page: documentDockPage({
        kind: "word",
        name: now.name,
        rootArtifactId,
        artifactId: now.artifactId,
        version: now.version,
        focus,
        selected,
        trackChanges: trackChangesOn.current,
      }),
    });
  }, [session, rootArtifactId, chipWords]);
  usePublishStudioToChat(publishNote);

  const load = useCallback(
    async (reason: "open" | "newer" | "reload") => {
      const loaded = await loadBytes();
      if (!loaded) return;
      const { detail, bytes, turn } = loaded;
      const shown = latest.current?.version ?? 0;
      try {
        // Adopt only while this turn is current — same rule as Excel/PowerPoint — so flicking
        // chat↔studio cannot leave the version pointer ahead of the editor.
        if (!adoptLoadedVersion(latest, turn, stillCurrent, detail)) return;
        queue.current?.rebase(detail.latest.version);
        opened.current = null;
        void checkDocx(new Uint8Array(bytes)).then((issues) => {
          if (stillCurrent(turn)) opened.current = issues;
        });
        setDoc({
          rootArtifactId: detail.rootArtifactId,
          name: detail.name,
          artifactId: detail.latest.artifactId,
          version: detail.latest.version,
          bytes,
          versions: detail.versions,
          loaded: turn,
        });
        setReadOnlyView(false);
        markReady(turn);
        publishNote();
        if (reason !== "open" && detail.latest.version > shown) {
          window.clearTimeout(timers.current.flash);
          setFlash(detail.latest.version);
          timers.current.flash = window.setTimeout(() => setFlash(null), FLASH_MS);
        }
      } catch {
        markOpenFailed(turn);
      }
    },
    [loadBytes, stillCurrent, markReady, markOpenFailed, publishNote],
  );

  const conflictText = t`A newer version of this document was saved, so it has been loaded. Make your last change again.`;
  const latestCallbacks = useRef({ load, publishNote, conflictText });
  latestCallbacks.current = { load, publishNote, conflictText };

  // One save queue per file. Opening never writes; only edits reported by the editor queue a save.
  useEffect(() => {
    const saves = createSaveQueue({
      baseVersion: latest.current?.version ?? 1,
      serialize: async () => (await editor.current?.save()) ?? null,
      check: async (bytes) => {
        const added = newDocxErrors(opened.current, await checkDocx(bytes));
        return added[0]?.message ?? null;
      },
      upload: ({ bytes, baseVersion, clientNonce }) =>
        uploadDocumentVersion({
          rootArtifactId,
          format: "docx",
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
    selection.current = "";
    owner.current = null;
    setDoc(null);
    setReview([]);
    setFlash(null);
    void latestCallbacks.current.load("open");
  }, [rootArtifactId]);

  // The editor downloads while the document does, so opening never waits on it twice.
  useEffect(() => {
    void loadWordEditor();
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(timers.current.note);
      window.clearTimeout(timers.current.review);
      window.clearTimeout(timers.current.flash);
    },
    [],
  );

  // The assistant's versions arrive here, and while it works its live draft.
  const { revision, draft } = useLiveDraft({
    rootArtifactId,
    enabled: doc !== null,
    running,
    shownVersion: doc?.version,
    parse: keepBytes,
  });
  const newest = revision.data?.version;
  const loadNewer = useCallback(() => load("newer"), [load]);
  useApplyNewerVersion({
    newest,
    saveStatus: saveState?.status,
    queue,
    latest,
    loadNewer,
  });

  useEffect(() => {
    if (running && queue.current?.state().dirty) void queue.current.flush();
  }, [running]);

  // The chat saves this document, then attaches its newest version, before each message.
  useEffect(() => {
    if (!session) return;
    return setStudioBeforeSend(session, async () => {
      // Capture the selected picture before flush/focus moves clear the editor selection.
      if (editor.current?.view().selection?.kind === "image") {
        heldImage.current = (await editor.current.selectedImage().catch(() => null)) ?? null;
      } else {
        heldImage.current = null;
      }
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
    if (!session) return;
    return setStudioSelectionImage(session, async () => {
      if (heldImage.current) return heldImage.current;
      if (editor.current?.view().selection?.kind !== "image") return null;
      return (await editor.current?.selectedImage()) ?? null;
    });
  }, [session]);

  useEffect(() => {
    const flushNow = () => void queue.current?.flush();
    window.addEventListener("pagehide", flushNow);
    return () => window.removeEventListener("pagehide", flushNow);
  }, []);

  const list = useQuery({
    ...queries.documents.list.queryOptions({ input: { format: "docx", limit: 30 } }),
    refetchInterval: 15_000,
  });
  const documents = list.data?.items ?? [];

  async function settle() {
    await Promise.race([
      queue.current?.flush(),
      new Promise((resolve) => window.setTimeout(resolve, CLOSE_SAVE_WAIT_MS)),
    ]);
  }

  const deleteDocument = useDeleteOfficeDocument({
    currentId: rootArtifactId,
    documents,
    settle,
    onOpenDocument,
    onEmpty,
  });

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

  async function create(office: string) {
    rememberOffice(office);
    setBusy(true);
    try {
      await settle();
      const created = await queries.documents.create.call({
        format: "docx",
        title: t`Untitled document`,
        office,
        ...documentBot,
      });
      await queryClient.invalidateQueries({ queryKey: queries.documents.list.key() });
      onOpenDocument(created.rootArtifactId);
    } catch (error) {
      const code = errorCode(error);
      toast.error(
        code === "PRECONDITION_FAILED"
          ? t`New documents can't be made here yet.`
          : code === "STORAGE_FULL"
            ? t`There's no room for a new document. Free up storage and try again.`
            : t`Couldn't make a new document.`,
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
      toast.error(t`Couldn't download the document.`);
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
        format: "docx",
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

  const readReview = useCallback(() => {
    window.clearTimeout(timers.current.review);
    timers.current.review = window.setTimeout(() => {
      setReview(reviewItems(editor.current?.trackedChanges() ?? []));
    }, 250);
  }, []);

  const onSelection = useCallback(
    (text: string) => {
      selection.current = text;
      window.clearTimeout(timers.current.note);
      timers.current.note = window.setTimeout(publishNote, 300);
    },
    [publishNote],
  );

  const onScroll = useCallback(() => {
    window.clearTimeout(timers.current.note);
    timers.current.note = window.setTimeout(publishNote, 400);
  }, [publishNote]);

  const [trackChanges, setTrackChanges] = useState(() => readTrackChanges(rootArtifactId));
  useEffect(() => {
    const next = readTrackChanges(rootArtifactId);
    trackChangesOn.current = next;
    setTrackChanges(next);
  }, [rootArtifactId]);
  function toggleTrackChanges() {
    const next = !trackChanges;
    trackChangesOn.current = next;
    setTrackChanges(next);
    rememberTrackChanges(rootArtifactId, next);
    publishNote();
  }

  const onEdit = useCallback(() => queue.current?.edit(), []);
  const onFail = useCallback(() => setReadOnlyView(true), []);

  function resolve(ids: number[], accept: boolean) {
    if (editor.current?.resolve(ids, accept)) {
      queue.current?.edit();
      readReview();
    }
  }

  const rows = useMemo(() => (doc ? versionRows(doc.versions, doc.version) : []), [doc]);
  const title = doc ? displayName(doc.name) : t`Documents`;
  const locked = running || restoring !== null || saveState?.status === "conflict";
  const shownBytes = draft?.value ?? doc?.bytes ?? EMPTY;

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
        ? t`This change wasn't saved because the document didn't pass its checks. Undo the last change or try again.`
        : t`This change wasn't saved. There may be no room left, or the file is too large.`,
    );
  }, [status, saveState?.detail, t]);

  const offices = orderedOffices(lastOffice());
  const uploader = useDocumentUpload("docx", onOpenDocument, settle);

  return (
    <StudioFrame
      testId="word-studio"
      title={title}
      paneLabel={title}
      product={t`Evolve Word`}
      onClose={() => void close()}
      closeLabel={t`Close document`}
      dock={dock}
      workingLabel={t`Working on your document…`}
      start={
        <>
          <DropdownMenu>
            <StudioHint label={t`Start a blank document, or upload a Word file.`}>
            <DropdownMenuTrigger
              data-testid="word-new"
              disabled={busy || uploader.busy}
              aria-label={t`New document`}
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
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  <Trans>New document for which office?</Trans>
                </DropdownMenuLabel>
                {offices.map((office) => (
                  <DropdownMenuItem key={office} onClick={() => void create(office)}>
                    {office}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={uploader.choose}>
                <Upload className="size-4" />
                <Trans>Upload a .docx file</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {uploader.input}
          <DropdownMenu>
            <StudioHint label={t`Open another document.`}>
            <DropdownMenuTrigger
              data-testid="word-switcher"
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-w-0 max-w-[38vw] gap-1.5 font-medium sm:max-w-[320px]"
                />
              }
            >
              <FileText className="size-4 shrink-0 text-foreground/70" strokeWidth={1.8} />
              <span className="truncate">{title}</span>
              <ChevronDown className="size-3.5 shrink-0 opacity-65" />
            </DropdownMenuTrigger>
            </StudioHint>
            <DropdownMenuContent align="start" className="w-80">
              {documents.length === 0 ? (
                <DropdownMenuItem disabled>
                  <Trans>No other documents yet</Trans>
                </DropdownMenuItem>
              ) : null}
              {documents.map((item) => (
                <DropdownMenuItem
                  key={item.rootArtifactId}
                  onClick={() => void switchTo(item.rootArtifactId)}
                  className="flex items-center gap-2"
                >
                  <FileText className="size-4 shrink-0 text-foreground/60" strokeWidth={1.8} />
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
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={busy} data-testid="word-switcher-new">
                  <Plus className="size-4" />
                  <Trans>New blank document</Trans>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>
                      <Trans>New document for which office?</Trans>
                    </DropdownMenuLabel>
                    {offices.map((office) => (
                      <DropdownMenuItem key={office} onClick={() => void create(office)}>
                        {office}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem disabled={busy || uploader.busy} onClick={uploader.choose}>
                <Upload className="size-4" />
                <Trans>Upload a .docx file</Trans>
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
              data-testid="word-save-status"
              aria-live="polite"
            >
              {statusText}
            </span>
          ) : null}
          {/* Phones: one More menu so Track / Review / History / Share cannot clip Close. */}
          <StudioMoreMenu>
            <DropdownMenuCheckboxItem
              checked={trackChanges}
              disabled={!doc || readOnlyView}
              onCheckedChange={() => toggleTrackChanges()}
            >
              <FilePenLine className="size-4" strokeWidth={1.8} />
              <Trans>Track changes</Trans>
            </DropdownMenuCheckboxItem>
            <DropdownMenuItem
              disabled={review.length === 0 || locked || readOnlyView}
              onClick={() => resolve(allReviewIds(review), true)}
            >
              <Check className="size-4" strokeWidth={1.8} />
              <span className="flex min-w-0 flex-col">
                <Trans>Accept all</Trans>
                <span className="text-[12px] text-muted-foreground">
                  <Trans>Keep the text and remove the red marks</Trans>
                </span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={review.length === 0} onClick={() => setReviewOpen(true)}>
              <ListChecks className="size-4" strokeWidth={1.8} />
              <Trans>Review</Trans>
              {review.length > 0 ? (
                <span className="ms-auto text-[12px] text-muted-foreground">{review.length}</span>
              ) : null}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!doc} onClick={() => void openHistory(true)}>
              <History className="size-4" strokeWidth={1.8} />
              <Trans>History</Trans>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!doc} onClick={() => void download()}>
              <Download className="size-4" />
              <Trans>Download .docx</Trans>
            </DropdownMenuItem>
          </StudioMoreMenu>
          <Popover>
            <StudioHint
              label={
                trackChanges
                  ? t`Edits are marked in red, so you can see what changed`
                  : t`Edits update the document directly, without red marks`
              }
            >
              <PopoverTrigger
                data-testid="word-track-changes"
                disabled={!doc || readOnlyView}
                aria-label={t`Track changes`}
                className={`${pill} max-sm:hidden disabled:opacity-40 ${trackChanges ? "bg-primary/15 text-primary hover:bg-primary/20" : ""}`}
              >
                <FilePenLine className="size-4" strokeWidth={1.8} aria-hidden="true" />
                <span>
                  <Trans>Track changes</Trans>
                </span>
                <ChevronDown className="size-3.5 shrink-0 opacity-65" aria-hidden="true" />
              </PopoverTrigger>
            </StudioHint>
            <PopoverContent align="end" className="w-72 p-1">
              <button
                type="button"
                role="switch"
                aria-checked={trackChanges}
                disabled={!doc || readOnlyView}
                onClick={toggleTrackChanges}
                className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-start hover:bg-foreground/[0.06] disabled:opacity-40"
              >
                <FilePenLine className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">
                    <Trans>Track changes</Trans>
                  </span>
                  <span className="block text-[12px] text-muted-foreground">
                    {trackChanges ? (
                      <Trans>Edits are marked in red, so you can see what changed</Trans>
                    ) : (
                      <Trans>Edits update the document directly, without red marks</Trans>
                    )}
                  </span>
                </span>
              </button>
              <button
                type="button"
                disabled={review.length === 0 || locked || readOnlyView}
                onClick={() => resolve(allReviewIds(review), true)}
                className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-start hover:bg-foreground/[0.06] disabled:opacity-40"
              >
                <Check className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">
                    <Trans>Accept all</Trans>
                  </span>
                  <span className="block text-[12px] text-muted-foreground">
                    <Trans>Keep the text and remove the red marks</Trans>
                  </span>
                </span>
              </button>
            </PopoverContent>
          </Popover>
          <ReviewPanel
            items={review}
            disabled={locked || readOnlyView}
            open={reviewOpen}
            onOpenChange={setReviewOpen}
            triggerClassName="max-sm:hidden"
            onResolve={resolve}
            onShow={(ids) => editor.current?.show(ids)}
          />
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
          <StudioHint label={t`Download a copy of this document.`}>
          <DropdownMenuTrigger
            disabled={!doc}
            data-testid="word-share"
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
              <Trans>Download .docx</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      {!doc ? (
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
          fileLabel={t`document`}
          onRetry={() => void load("open")}
        />
      ) : (
        <div
          className={`relative size-full ring-inset transition-shadow duration-700 ${
            flash !== null ? "ring-2 ring-primary" : ""
          } ${running || draft ? "[&_.layout-page-content]:cursor-default" : ""}`}
          data-testid="word-canvas"
          data-live-draft={draft ? "true" : undefined}
        >
          <DocumentLoadOverlay state={loadState} />
          {readOnlyView ? (
            <div className="flex size-full flex-col">
              <p className="shrink-0 border-b border-border bg-muted/60 px-4 py-2 text-[13px] text-muted-foreground">
                <Trans>
                  This document can't be edited here, so it is shown read-only. Download it to edit
                  it, or ask the assistant for changes.
                </Trans>
              </p>
              <div className="min-h-0 flex-1">
                <Suspense fallback={null}>
                  <WordPreview
                    key={draft?.updatedAt ?? doc.loaded}
                    bytes={shownBytes}
                    label={title}
                    failedText={t`This document couldn't be shown.`}
                  />
                </Suspense>
              </div>
            </div>
          ) : (
            <EditorBoundary onError={() => setReadOnlyView(true)} fallback={null}>
              <Suspense
                fallback={
                  <div className="grid size-full place-items-center">
                    <Loader2
                      className="size-5 animate-spin text-muted-foreground"
                      aria-label={t`Loading`}
                    />
                  </div>
                }
              >
                <WordEditor
                  bytes={shownBytes}
                  accessibleName={t`Document: ${title}`}
                  author={userName || t`You`}
                  locale={i18n.locale}
                  readOnly={locked || draft !== null}
                  trackChanges={trackChanges}
                  fitWidth={narrow}
                  handleRef={editor}
                  onEdit={onEdit}
                  onReviewChange={readReview}
                  onSelection={onSelection}
                  onScroll={onScroll}
                  onFail={onFail}
                />
              </Suspense>
            </EditorBoundary>
          )}
          {draft ? (
            <LiveDraftPill className="top-3" />
          ) : running ? (
            <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
              <span className="flex items-center gap-1.5 rounded-full bg-background/95 px-3 py-1 text-[12px] font-medium text-primary shadow-sm ring-1 ring-border">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                <Trans>Updating…</Trans>
              </span>
            </div>
          ) : flash !== null ? (
            <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
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
              format={wordHistory}
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
