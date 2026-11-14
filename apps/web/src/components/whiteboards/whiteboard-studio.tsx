import { Trans, useLingui } from "@lingui/react/macro";
import { readBoard } from "@rakazo/app-kit/ui";
import type { BoardDirection, PageDetail } from "@rakazo/contracts";
import { layoutBoardItems, readBoardItems } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  toast,
} from "@rakazo/ui-web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  Download,
  LayoutGrid,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { pageMutationOptions } from "../../lib/page-actions";
import { useMedia, usePageSession } from "../../lib/pages";
import { useSpaceQueries } from "../../lib/query";
import { SharePopover } from "../pages/SharePopover";
import { WhiteboardCanvas } from "../pages/WhiteboardCanvas";
import { boardBoundsWithArrows, exportWhiteboardPdf } from "./whiteboard-export";

const COARSE = "(pointer: coarse)";

/** One empty-list create at a time, including React's remount of the dialog. */
let openingBoard: Promise<unknown> | null = null;
const idleSubscribe = () => () => {};

const control =
  "grid shrink-0 place-items-center rounded-full border border-foreground/[0.06] text-foreground outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring";

function fileName(title: string, ext: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${slug || "whiteboard"}.${ext}`;
}

function download(filename: string, mime: string, body: BlobPart) {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Whiteboards full screen, the way an app opens: the chat's own transcript and composer move to
 * the left, and the board fills the rest. Asking in that chat names the open board.
 */
export function WhiteboardStudio({
  onClose,
  initialBoardId,
  share,
}: {
  onClose: () => void;
  initialBoardId?: string;
  share?: ReactNode;
}) {
  const compact = useMedia(COARSE);
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const session = usePageSession();
  const closeButton = useRef<HTMLButtonElement>(null);
  const boardPane = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState<string | null>(initialBoardId ?? null);
  const [chatOpen, setChatOpen] = useState(
    () =>
      typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1024px)").matches,
  );
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const running = useSyncExternalStore(
    session?.dock.subscribe ?? idleSubscribe,
    () => session?.dock.get().running === true,
    () => false,
  );

  const list = useQuery({
    ...queries.pages.list.queryOptions({ input: { kind: "whiteboard", limit: 60 } }),
    refetchInterval: 8000,
  });
  const boards = list.data?.items ?? [];
  const page = useQuery({
    ...queries.pages.get.queryOptions({ input: { pageId: selected ?? "" } }),
    enabled: Boolean(selected),
    refetchInterval: running ? 800 : 2000,
  });
  const link = useQuery({
    ...queries.pages.get.queryOptions({ input: { pageId: selected ?? "", link: true } }),
    enabled: Boolean(selected) && shareOpen,
  });

  const actions = useMemo(() => pageMutationOptions(queries, queryClient), [queries, queryClient]);
  const visibility = useMutation(actions.setVisibility);
  const shownVisibility =
    visibility.isError && page.dataUpdatedAt < visibility.submittedAt
      ? null
      : (page.data?.visibility ?? null);

  const setDockNode = useCallback(
    (node: HTMLDivElement | null) => session?.dock.set({ node }),
    [session],
  );
  const setChatNode = useCallback(
    (chat: HTMLDivElement | null) => session?.dock.set({ chat }),
    [session],
  );

  useEffect(() => {
    if (!list.isSuccess || boards.length > 0 || openingBoard) return;
    openingBoard = create(t`Whiteboard`).finally(() => {
      openingBoard = null;
    });
  }, [list.isSuccess, boards.length, t]);

  useEffect(() => {
    if (!boards.length) return;
    if (!selected || !boards.some((board) => board.id === selected)) setSelected(boards[0]!.id);
  }, [boards, selected]);

  useEffect(() => {
    setRenaming(false);
    setShareOpen(false);
  }, [selected]);

  useEffect(() => {
    if (page.data && selected && session?.takeShare(selected)) setShareOpen(true);
  }, [page.data, selected, session]);

  useEffect(() => {
    const data = page.data;
    if (!session || !data) return;
    const current = session.dock.get().page;
    if (current?.id === data.id && current.title === data.title) return;
    const note = current?.id === data.id ? current.note : undefined;
    session.dock.set({
      page: { id: data.id, title: data.title, ...(note ? { note } : {}) },
    });
  }, [session, page.data]);

  useEffect(
    () => () => {
      session?.dock.set({ page: null, node: null, chat: null });
    },
    [session],
  );

  async function create(title: string) {
    try {
      const created = await queries.pages.createBoard.call({ title });
      await queryClient.invalidateQueries({ queryKey: queries.pages.list.key() });
      setSelected(created.id);
      setChatOpen(true);
    } catch {
      toast.error(t`Couldn't create the whiteboard.`);
    }
  }

  async function rename(title: string) {
    if (!selected) return;
    const next = title.trim();
    if (!next || next === page.data?.title) {
      setRenaming(false);
      return;
    }
    try {
      await queries.pages.rename.call({ pageId: selected, title: next });
      await queryClient.invalidateQueries({ queryKey: queries.pages.list.key() });
      await queryClient.invalidateQueries({
        queryKey: queries.pages.get.queryKey({ input: { pageId: selected } }),
      });
      setRenaming(false);
    } catch {
      toast.error(t`Couldn't change the whiteboard.`);
    }
  }

  async function remove(pageId: string) {
    if (!window.confirm(t`Delete this whiteboard?`)) return;
    try {
      await queries.pages.remove.call({ pageId });
      if (selected === pageId) setSelected(null);
      await queryClient.invalidateQueries({ queryKey: queries.pages.list.key() });
    } catch {
      toast.error(t`Couldn't change the whiteboard.`);
    }
  }

  async function tidy(direction: BoardDirection) {
    if (!selected || !page.data) return;
    try {
      const current = readBoardItems(page.data.code);
      const next = layoutBoardItems(current, direction);
      const saved = await queries.pages.saveBoard.call({
        pageId: selected,
        baseVersion: page.data.version,
        items: next,
      });
      const source = JSON.stringify({ items: next });
      queryClient.setQueriesData<PageDetail>(
        { queryKey: queries.pages.get.queryKey({ input: { pageId: selected } }) },
        (prev) =>
          prev
            ? {
                ...prev,
                code: source,
                version: saved.version,
                currentVersion: saved.version,
                updatedAt: new Date().toISOString(),
              }
            : prev,
      );
      setTimeout(() => {
        boardPane.current
          ?.querySelector<HTMLButtonElement>('[aria-label="Show everything"]')
          ?.click();
      }, 60);
    } catch {
      toast.error(t`Couldn't change the whiteboard.`);
    }
  }

  function exportSvg() {
    const svg = boardPane.current?.querySelector("svg.absolute");
    if (!svg || !page.data) return;
    const clone = svg.cloneNode(true) as SVGElement;
    for (const el of clone.querySelectorAll("[data-board-resize],[data-board-arrow-end]")) {
      el.remove();
    }
    const items = readBoard(page.data.code).items;
    const bounds = boardBoundsWithArrows(items);
    const pad = 48;
    const width = bounds.w + pad * 2;
    const height = bounds.h + pad * 2;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("viewBox", `${bounds.x - pad} ${bounds.y - pad} ${width} ${height}`);
    clone.setAttribute("width", String(Math.ceil(width)));
    clone.setAttribute("height", String(Math.ceil(height)));
    const group = clone.querySelector("g");
    group?.removeAttribute("transform");
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", String(bounds.x - pad));
    bg.setAttribute("y", String(bounds.y - pad));
    bg.setAttribute("width", String(width));
    bg.setAttribute("height", String(height));
    bg.setAttribute("fill", "white");
    group?.insertBefore(bg, group.firstChild);
    download(fileName(page.data.title, "svg"), "image/svg+xml", clone.outerHTML);
  }

  async function exportPdf() {
    if (!page.data || !selected || exportingPdf) return;
    setExportingPdf(true);
    try {
      const pageId = selected;
      const bytes = await exportWhiteboardPdf({
        title: page.data.title,
        code: page.data.code,
        resolveAsset: (assetId) =>
          queries.apps.asset
            .call({ pageId, assetId })
            .then((res) => `data:${res.mime};base64,${res.base64}`)
            .catch(() => null),
      });
      download(fileName(page.data.title, "pdf"), "application/pdf", bytes);
    } catch {
      window.print();
    } finally {
      setExportingPdf(false);
    }
  }

  const shareControl =
    share ??
    (page.data && selected ? (
      <SharePopover
        compact={compact}
        title={page.data.title}
        owner={page.data.owner}
        visibility={shownVisibility}
        shareUrl={link.data?.shareUrl ?? null}
        sharePassword={link.data?.sharePassword ?? null}
        onRenewPassword={() => {
          if (selected && !visibility.isPending) {
            visibility.mutate({ pageId: selected, visibility: "public", renewPassword: true });
          }
        }}
        open={shareOpen}
        onOpenChange={setShareOpen}
        pending={visibility.isPending}
        error={visibility.isError ? t`Could not change who can view this app. Try again.` : null}
        onVisibilityChange={(next) => {
          if (selected && next !== shownVisibility && !visibility.isPending) {
            visibility.mutate({ pageId: selected, visibility: next });
          }
        }}
      />
    ) : null);

  const composer = <div ref={setDockNode} />;

  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        const target = details.event?.target;
        if (
          !open &&
          details.reason === "escape-key" &&
          target instanceof Element &&
          target.closest('[data-slot="popover-content"], [data-slot="dropdown-menu-content"]')
        ) {
          details.cancel();
          return;
        }
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={closeButton}
        data-testid="whiteboard-studio"
        data-page-print=""
        className="top-0 left-0 block h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none bg-background p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] ps-[env(safe-area-inset-left)] pe-[env(safe-area-inset-right)] ring-0 sm:max-w-none data-open:duration-[260ms] data-open:zoom-in-[0.98] data-open:slide-in-from-bottom-3 data-closed:duration-150 motion-reduce:data-open:zoom-in-100"
      >
        <div className="relative size-full">
          <header className="absolute inset-x-0 top-0 z-10 flex h-12 items-center gap-2 px-2.5 print:hidden">
            <DialogClose
              ref={closeButton}
              aria-label={t`Close app`}
              className={`${control} size-[35px]`}
            >
              <X className="size-[18px]" strokeWidth={1.7} />
            </DialogClose>
            <DialogTitle className="sr-only">{page.data?.title ?? t`Whiteboards`}</DialogTitle>
            {renaming ? (
              <Input
                autoFocus
                value={titleDraft}
                aria-label={t`Rename`}
                className="h-8 max-w-xs"
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => void rename(titleDraft)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void rename(titleDraft);
                  if (event.key === "Escape") setRenaming(false);
                }}
              />
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger
                  data-testid="whiteboard-switcher"
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="max-w-[280px] gap-1.5 font-medium"
                    />
                  }
                >
                  <span className="truncate">
                    {page.data?.title ??
                      boards.find((b) => b.id === selected)?.title ??
                      t`Whiteboard`}
                  </span>
                  <ChevronDown className="size-3.5 shrink-0 opacity-65" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72">
                  {boards.map((board) => (
                    <DropdownMenuItem
                      key={board.id}
                      onClick={() => setSelected(board.id)}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="truncate">{board.title}</span>
                      {board.id === selected ? (
                        <Check className="size-4 shrink-0 text-primary" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                  {boards.length > 0 ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem onClick={() => void create(t`Whiteboard`)}>
                    <Plus className="size-4" />
                    <Trans>New whiteboard</Trans>
                  </DropdownMenuItem>
                  {selected ? (
                    <>
                      <DropdownMenuItem
                        onClick={() => {
                          setTitleDraft(page.data?.title ?? "");
                          setRenaming(true);
                        }}
                      >
                        <Pencil className="size-4" />
                        <Trans>Rename</Trans>
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => void remove(selected)}>
                        <Trash2 className="size-4" />
                        <Trans>Delete</Trans>
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => void create(t`Whiteboard`)}>
              <Plus />
              <Trans>New whiteboard</Trans>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={!page.data}
                render={<Button variant="ghost" size="sm" />}
              >
                <LayoutGrid />
                <Trans>Tidy layout</Trans>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void tidy("right")}>
                  <Trans>Flow left to right</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void tidy("down")}>
                  <Trans>Flow top to bottom</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void tidy("lanes")}>
                  <Trans>Columns by section</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void tidy("grid")}>
                  <Trans>Balanced grid</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="sm" onClick={exportSvg} disabled={!page.data}>
              <Download />
              <Trans>Download SVG</Trans>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!page.data || exportingPdf}
              onClick={() => void exportPdf()}
            >
              {exportingPdf ? <Loader2 className="animate-spin" /> : <Download />}
              <Trans>Download PDF</Trans>
            </Button>
            {shareControl}
            <button
              type="button"
              aria-pressed={chatOpen}
              title={t`Show the chat beside the app`}
              aria-label={t`Chat`}
              onClick={() => setChatOpen((open) => !open)}
              className={`${control} size-[35px]`}
            >
              <MessageSquare className="size-[18px]" strokeWidth={1.7} />
            </button>
          </header>
          <div
            className={`absolute inset-x-0 top-12 flex ${chatOpen ? "bottom-0" : "bottom-[72px]"}`}
          >
            {chatOpen ? (
              <aside
                aria-label={t`Chat`}
                className="absolute inset-0 z-30 flex min-h-0 flex-col border-foreground/[0.06] bg-background sm:static sm:w-[min(36vw,420px)] sm:shrink-0 sm:border-r print:hidden [&_[data-testid=transcript]]:px-3 [&_[data-testid=transcript]]:pt-3 [&_[data-testid=transcript]]:pb-4"
              >
                <div ref={setChatNode} className="flex min-h-0 flex-1 flex-col" />
                <div className="shrink-0 px-2 pb-2">{composer}</div>
              </aside>
            ) : null}
            <section
              ref={boardPane}
              aria-label={page.data?.title}
              className="relative min-w-0 flex-1 bg-background"
            >
              {page.data && session ? (
                <WhiteboardCanvas
                  key={page.data.id}
                  pageId={page.data.id}
                  title={page.data.title}
                  code={page.data.code}
                  version={page.data.version}
                  session={session}
                />
              ) : null}
            </section>
          </div>
          {chatOpen ? null : (
            <div className="absolute inset-x-0 bottom-[12.5px] flex justify-center px-3 print:hidden">
              <div className="w-full max-w-[551px]">{composer}</div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
