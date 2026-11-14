import { Trans, useLingui } from "@lingui/react/macro";
import { readBoard } from "@rakazo/app-kit/ui";
import type { BoardDirection, PageDetail } from "@rakazo/contracts";
import { layoutBoardItems, readBoardItems } from "@rakazo/contracts";
import {
  Button,
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
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  Columns3,
  LayoutGrid,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { pageMutationOptions } from "../../lib/page-actions";
import { useMedia } from "../../lib/pages";
import { useSpaceQueries } from "../../lib/query";
import { AppIcon } from "../apps/AppIcon";
import { SharePopover } from "../pages/SharePopover";
import { WhiteboardCanvas } from "../pages/WhiteboardCanvas";
import { control, pill, StudioFrame, useStudioDock } from "../studio/StudioFrame";
import { boardBoundsWithArrows, exportWhiteboardPdf } from "./whiteboard-export";

const COARSE = "(pointer: coarse)";

/** One empty-list create at a time, including React's remount of the dialog. */
let openingBoard: Promise<unknown> | null = null;

function BoardMark({ pageId, icon }: { pageId: string; icon?: string | null }) {
  return (
    <AppIcon
      pageId={pageId}
      icon={icon}
      className="size-5"
      fallback={
        <span className="grid size-5 shrink-0 place-items-center rounded-md bg-background text-foreground/70">
          <LayoutGrid className="size-3.5" strokeWidth={1.8} />
        </span>
      }
    />
  );
}

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
}: {
  onClose: () => void;
  initialBoardId?: string;
}) {
  const compact = useMedia(COARSE);
  const narrow = useMedia("(max-width: 840px)");
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const dock = useStudioDock();
  const { session, running, setChatOpen } = dock;
  const boardPane = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState<string | null>(initialBoardId ?? null);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

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
    page.data && selected ? (
      <SharePopover
        compact={compact || narrow}
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
        downloads={{
          disabled: !page.data,
          pdfPending: exportingPdf,
          onSvg: exportSvg,
          onPdf: () => void exportPdf(),
        }}
      />
    ) : null;

  return (
    <StudioFrame
      testId="whiteboard-studio"
      title={page.data?.title ?? t`Whiteboards`}
      paneLabel={page.data?.title}
      onClose={onClose}
      printable
      dock={dock}
      paneRef={boardPane}
      workingLabel={t`Working on your whiteboard…`}
      start={
        <>
          <button
            type="button"
            data-testid="whiteboard-new"
            data-haptic="tap"
            aria-label={t`New whiteboard`}
            title={t`New whiteboard`}
            onClick={() => void create(t`Whiteboard`)}
            className={`${control} size-[35px]`}
          >
            <Plus className="size-[18px]" strokeWidth={1.7} />
          </button>
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
                    className="min-w-0 max-w-[38vw] gap-1.5 font-medium sm:max-w-[280px]"
                  />
                }
              >
                {selected ? <BoardMark pageId={selected} icon={page.data?.icon} /> : null}
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
                    className="flex items-center gap-2"
                  >
                    <BoardMark pageId={board.id} icon={board.icon} />
                    <span className="min-w-0 flex-1 truncate">{board.title}</span>
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
        </>
      }
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={!page.data}
            aria-label={t`Tidy layout`}
            className={`${pill} disabled:opacity-40`}
          >
            <LayoutGrid className="size-4" strokeWidth={1.8} />
            <span className="max-sm:sr-only">
              <Trans>Tidy layout</Trans>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => void tidy("right")}>
              <ArrowRight className="size-4" />
              <Trans>Flow left to right</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void tidy("down")}>
              <ArrowDown className="size-4" />
              <Trans>Flow top to bottom</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void tidy("lanes")}>
              <Columns3 className="size-4" />
              <Trans>Columns by section</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void tidy("grid")}>
              <LayoutGrid className="size-4" />
              <Trans>Balanced grid</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
      share={shareControl}
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
    </StudioFrame>
  );
}
