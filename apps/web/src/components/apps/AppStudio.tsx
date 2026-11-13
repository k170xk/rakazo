import { useLingui } from "@lingui/react/macro";
import type { PageDetail } from "@rakazo/contracts";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Code2,
  Database,
  History,
  Loader2,
  MessageSquare,
  MousePointerClick,
  Settings2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ownerAppSource } from "../../lib/app-host";
import { useSpaceQueries } from "../../lib/query";
import { AppCodePanel } from "./AppCodePanel";
import { AppDataPanel } from "./AppDataPanel";
import type { AppPatch, AppPick } from "./AppFrame";
import { AppFrame } from "./AppFrame";
import { AppHistoryPanel } from "./AppHistoryPanel";
import { AppIcon } from "./AppIcon";
import { AppSettingsPanel } from "./AppSettingsPanel";
import { AppVisualEdit } from "./AppVisualEdit";

type Panel = "data" | "code" | "history" | "settings";

/**
 * An app full screen for its owner, with the App Studio around it: the running app, a picker that
 * points the chat at one element, and panels for the app's data, code, versions and settings.
 * The chat's composer stays docked, so "make this a chart" goes to the bot with the app open, and
 * the chat itself shows beside the app so the bot's steps, tools and approvals stay in view.
 */
export function AppStudio({
  open,
  onOpenChange,
  page,
  ownerName,
  share,
  composer,
  chat,
  running = false,
  onReply,
  returnFocus,
  compact = false,
  notice = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: PageDetail | undefined;
  ownerName: string | null;
  share: ReactNode;
  composer?: ReactNode;
  /** The slot the chat's transcript moves into while the chat panel is open. */
  chat?: ReactNode;
  /** The bot is working on a reply: the app is checked for changes more often. */
  running?: boolean;
  onReply?: (text: unknown) => void;
  returnFocus?: () => boolean;
  compact?: boolean;
  notice?: ReactNode;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const closeButton = useRef<HTMLButtonElement>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [chatOpen, setChatOpen] = useState(
    () =>
      !compact &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(min-width: 1024px)").matches,
  );
  const [historyFocus, setHistoryFocus] = useState<number | null>(null);
  const [updated, setUpdated] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  // Once the picker is used the app stays on its tagged build, so turning the picker off and on
  // again leaves the app on the same screen instead of starting it over.
  const [tagsWanted, setTagsWanted] = useState(false);
  const [editing, setEditing] = useState<AppPick | null>(null);
  const [patch, setPatch] = useState<AppPatch | null>(null);
  // Discarding an unsaved visual edit draws the app again from its code.
  const [redraws, setRedraws] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const pageId = page?.id ?? null;
  const source = useMemo(
    () => (pageId ? ownerAppSource(queries, pageId, ownerName) : null),
    [queries, pageId, ownerName],
  );
  // A new version saved elsewhere (the bot, another tab) reloads the app here.
  const revision = useQuery({
    ...queries.apps.revision.queryOptions({ input: { pageId: pageId ?? "" } }),
    enabled: open && pageId !== null,
    refetchInterval: running ? 1200 : 4000,
  });
  // The picker and visual edits need the preview build, whose elements carry their source lines.
  // It is fetched as the Studio opens so the picker works on the first click.
  const tagging = tagsWanted || picking || editing !== null;
  const viewedVersion = page?.version;
  const preview = useQuery({
    ...queries.apps.preview.queryOptions({
      input: { pageId: pageId ?? "", version: viewedVersion },
    }),
    enabled: open && pageId !== null && viewedVersion !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const tagged = tagging ? preview.data?.html : null;
  const newest = revision.data?.version;
  useEffect(() => {
    if (pageId && newest && page && newest !== page.currentVersion) {
      void queryClient.invalidateQueries({ queryKey: queries.pages.get.key() });
      void queryClient.invalidateQueries({ queryKey: queries.apps.key() });
    }
  }, [newest, page, pageId, queries, queryClient]);
  useEffect(() => setProblem(null), [page?.version]);
  useEffect(() => {
    if (open) return;
    setEditing(null);
    setPicking(false);
    setTagsWanted(false);
  }, [open]);
  // Rows the bot adds show as they land, in the app and in the Data panel.
  const dataRevision = revision.data?.revision;
  useEffect(() => {
    if (dataRevision === undefined) return;
    void queryClient.invalidateQueries({ queryKey: queries.apps.data.key() });
    void queryClient.invalidateQueries({ queryKey: queries.apps.changes.key() });
  }, [dataRevision, queries, queryClient]);
  // When the bot finishes, everything is read again so the app shows exactly what it saved.
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running && pageId) {
      void revision.refetch();
      void queryClient.invalidateQueries({ queryKey: queries.pages.get.key() });
      void queryClient.invalidateQueries({ queryKey: queries.apps.key() });
    }
    wasRunning.current = running;
  }, [running, pageId, queries, queryClient, revision.refetch]);
  // A new version saved while the app is open says so, with a way to see the change.
  const shownVersion = page?.currentVersion;
  const firstVersion = useRef(shownVersion);
  useEffect(() => {
    if (shownVersion === undefined) return;
    if (firstVersion.current === undefined) firstVersion.current = shownVersion;
    else if (shownVersion > firstVersion.current) setUpdated(shownVersion);
  }, [shownVersion]);
  useEffect(() => {
    if (updated === null || running) return;
    const timer = window.setTimeout(() => setUpdated(null), 12_000);
    return () => window.clearTimeout(timer);
  }, [updated, running]);

  function pick(selected: AppPick) {
    setPicking(false);
    setPatch(null);
    setEditing(selected);
  }

  function askBot(selected: AppPick) {
    const what = selected.text
      ? `the ${selected.tag} "${selected.text.slice(0, 60)}"`
      : `this ${selected.tag}`;
    onReply?.(`In ${selected.loc}, ${what}: `);
  }

  function stopEditing(saved: boolean) {
    if (!saved && patch) setRedraws((count) => count + 1);
    setPatch(null);
    setEditing(null);
  }

  const tabs: { id: Panel; label: string; icon: ReactNode }[] = [
    { id: "data", label: t`Data`, icon: <Database className="size-4" strokeWidth={1.8} /> },
    { id: "code", label: t`Code`, icon: <Code2 className="size-4" strokeWidth={1.8} /> },
    { id: "history", label: t`History`, icon: <History className="size-4" strokeWidth={1.8} /> },
    {
      id: "settings",
      label: t`Settings`,
      icon: <Settings2 className="size-4" strokeWidth={1.8} />,
    },
  ];
  const control =
    "grid shrink-0 place-items-center rounded-full border border-foreground/[0.06] text-foreground outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-primary/15 aria-pressed:text-primary";
  const size = compact ? "size-11" : "size-[35px]";
  const docked = chatOpen && Boolean(chat) && page !== undefined;

  return (
    <Dialog open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogContent
        showCloseButton={false}
        initialFocus={closeButton}
        finalFocus={returnFocus}
        data-testid="app-studio"
        className="top-0 left-0 block h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none bg-background p-0 ring-0 sm:max-w-none data-open:duration-[260ms] data-open:zoom-in-[0.98] data-open:slide-in-from-bottom-3 data-closed:duration-150 motion-reduce:data-open:zoom-in-100"
      >
        <header className="absolute inset-x-0 top-0 z-10 flex h-[48px] items-center gap-2 px-2.5 max-sm:gap-1 max-sm:px-1.5">
          <DialogClose ref={closeButton} aria-label={t`Close app`} className={`${control} ${size}`}>
            <X className="size-[18px]" strokeWidth={1.7} />
          </DialogClose>
          {page?.icon ? (
            <AppIcon pageId={page.id} icon={page.icon} className="size-8 max-sm:hidden" />
          ) : null}
          <DialogTitle className="min-w-0 flex-1 truncate px-1 text-[14px] leading-5 font-medium text-foreground">
            {page?.title ?? t`App`}
          </DialogTitle>
          {running ? (
            <button
              type="button"
              onClick={() => setChatOpen(true)}
              className="flex h-[28px] shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 text-[12px] font-medium text-primary"
            >
              <Loader2 className="size-3.5 animate-spin" strokeWidth={2} aria-hidden="true" />
              <span className="max-sm:sr-only">{t`Working on your app…`}</span>
            </button>
          ) : null}
          {page ? (
            <>
              {chat ? (
                <button
                  type="button"
                  aria-pressed={chatOpen}
                  title={t`Show the chat beside the app`}
                  aria-label={t`Chat`}
                  onClick={() => {
                    setChatOpen((on) => !on);
                    if (compact) setPanel(null);
                  }}
                  className={`${control} ${size}`}
                >
                  <MessageSquare className="size-[18px]" strokeWidth={1.7} />
                </button>
              ) : null}
              <button
                type="button"
                aria-pressed={picking}
                title={t`Point at something in the app to change it`}
                aria-label={t`Select an element`}
                onClick={() => {
                  setPicking((on) => !on);
                  setTagsWanted(true);
                  stopEditing(false);
                  if (compact) setPanel(null);
                }}
                className={`${control} ${size} max-sm:hidden`}
              >
                <MousePointerClick className="size-[18px]" strokeWidth={1.7} />
              </button>
              <nav
                aria-label={t`App Studio`}
                className="flex shrink-0 items-center gap-0.5 rounded-full border border-foreground/[0.06] p-[3px]"
              >
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={panel === tab.id}
                    onClick={() => {
                      setPanel((current) => (current === tab.id ? null : tab.id));
                      if (compact) setChatOpen(false);
                    }}
                    className="flex h-[28px] items-center gap-1.5 rounded-full px-2.5 text-[13px] text-foreground/70 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-foreground/[0.08] aria-pressed:text-foreground"
                  >
                    {tab.icon}
                    <span className="max-sm:sr-only">{tab.label}</span>
                  </button>
                ))}
              </nav>
            </>
          ) : null}
          {share}
        </header>
        <div
          className={`absolute inset-x-0 top-[48px] flex ${composer && !docked ? "bottom-[72px]" : "bottom-0"}`}
        >
          {docked ? (
            <aside
              aria-label={t`Chat`}
              className="absolute inset-0 z-30 flex min-h-0 flex-col border-foreground/[0.06] bg-background sm:static sm:w-[min(36vw,420px)] sm:shrink-0 sm:border-r [&_[data-testid=transcript]]:px-3 [&_[data-testid=transcript]]:pt-3 [&_[data-testid=transcript]]:pb-4"
            >
              {chat}
              <div className="shrink-0 px-2 pb-2">{composer}</div>
            </aside>
          ) : null}
          <section aria-label={page?.title} className="relative min-w-0 flex-1">
            {notice ??
              (page && source ? (
                <>
                  <AppFrame
                    key={`${page.version}:${tagged ? "tagged" : "built"}:${redraws}`}
                    document={tagged ?? page.code}
                    title={page.title}
                    app={{ id: page.id, version: page.version }}
                    source={source}
                    picking={picking && Boolean(tagged)}
                    onPick={pick}
                    onProblem={setProblem}
                    refreshSignal={dataRevision}
                    maps
                    patch={patch}
                    selectedLoc={editing?.loc ?? null}
                  />
                  {editing ? (
                    <div className="pointer-events-none absolute right-3 bottom-3 z-20 flex justify-end max-sm:inset-x-3">
                      <AppVisualEdit
                        key={editing.loc}
                        pageId={page.id}
                        pick={editing}
                        onPatch={setPatch}
                        onAskBot={() => {
                          askBot(editing);
                          stopEditing(false);
                        }}
                        onClose={stopEditing}
                      />
                    </div>
                  ) : null}
                  {updated !== null && !picking && !problem ? (
                    <div className="absolute inset-x-3 top-3 z-10 flex justify-center">
                      <div
                        role="status"
                        className="flex items-center gap-3 rounded-full border border-foreground/[0.08] bg-card py-1.5 pr-1.5 pl-3.5 text-[13px] shadow-lg"
                      >
                        <span className="text-foreground">{t`Updated to version ${updated}`}</span>
                        <button
                          type="button"
                          className="rounded-full bg-primary/10 px-2.5 py-1 text-[12px] font-medium text-primary hover:bg-primary/15"
                          onClick={() => {
                            setHistoryFocus(updated);
                            setPanel("history");
                            if (compact) setChatOpen(false);
                            setUpdated(null);
                          }}
                        >
                          {t`See what changed`}
                        </button>
                        <button
                          type="button"
                          aria-label={t`Dismiss`}
                          onClick={() => setUpdated(null)}
                          className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.06]"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {picking ? (
                    <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
                      <p className="rounded-full bg-foreground px-3 py-1.5 text-[12px] text-background shadow-lg">
                        {tagged
                          ? t`Click something in the app to change it`
                          : preview.data
                            ? t`This version can't be picked from. Ask the bot instead.`
                            : t`Getting the app ready to pick from…`}
                      </p>
                    </div>
                  ) : null}
                  {problem ? (
                    <div className="absolute inset-x-3 top-3 flex justify-center">
                      <div
                        role="alert"
                        className="flex max-w-[560px] items-start gap-2 rounded-xl border border-destructive/30 bg-card px-3 py-2 text-[13px] shadow-lg"
                      >
                        <p className="min-w-0 flex-1 text-foreground">
                          <span className="font-medium text-destructive">{t`The app hit an error.`}</span>{" "}
                          <span className="break-words text-muted-foreground">{problem}</span>
                        </p>
                        <button
                          type="button"
                          className="shrink-0 text-[12px] font-medium text-primary hover:underline"
                          onClick={() => {
                            onReply?.(`Fix this error in the app: ${problem.slice(0, 220)}`);
                            setProblem(null);
                          }}
                        >
                          {t`Ask the bot to fix it`}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null)}
          </section>
          {page && panel ? (
            <aside
              aria-label={tabs.find((tab) => tab.id === panel)?.label}
              className="absolute inset-0 z-20 flex min-h-0 flex-col border-foreground/[0.06] bg-card sm:static sm:w-[min(46vw,560px)] sm:border-l"
            >
              <div className="flex h-11 shrink-0 items-center justify-between border-b border-foreground/[0.06] px-3 sm:hidden">
                <span className="text-[14px] font-medium">
                  {tabs.find((tab) => tab.id === panel)?.label}
                </span>
                <button
                  type="button"
                  aria-label={t`Close panel`}
                  onClick={() => setPanel(null)}
                  className="grid size-9 place-items-center rounded-full hover:bg-foreground/[0.06]"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {panel === "data" ? <AppDataPanel pageId={page.id} /> : null}
                {panel === "code" ? (
                  <AppCodePanel pageId={page.id} version={page.currentVersion} />
                ) : null}
                {panel === "history" ? (
                  <AppHistoryPanel
                    key={historyFocus ?? "history"}
                    pageId={page.id}
                    current={page.currentVersion}
                    focus={historyFocus ?? undefined}
                  />
                ) : null}
                {panel === "settings" ? (
                  <AppSettingsPanel pageId={page.id} title={page.title} icon={page.icon ?? null} />
                ) : null}
              </div>
            </aside>
          ) : null}
        </div>
        {composer && !docked ? (
          <div
            className={`absolute bottom-[12.5px] flex justify-center px-3 ${panel ? "inset-x-0 sm:right-[min(46vw,560px)]" : "inset-x-0"}`}
          >
            <div className="w-full max-w-[551px]">{composer}</div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
