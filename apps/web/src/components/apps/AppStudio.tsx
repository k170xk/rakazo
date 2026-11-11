import { useLingui } from "@lingui/react/macro";
import type { PageDetail } from "@rakazo/contracts";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Code2, Database, History, MousePointerClick, Settings2, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ownerAppSource } from "../../lib/app-host";
import { useSpaceQueries } from "../../lib/query";
import { AppCodePanel } from "./AppCodePanel";
import { AppDataPanel } from "./AppDataPanel";
import type { AppPick } from "./AppFrame";
import { AppFrame } from "./AppFrame";
import { AppHistoryPanel } from "./AppHistoryPanel";
import { AppSettingsPanel } from "./AppSettingsPanel";

type Panel = "data" | "code" | "history" | "settings";

/**
 * An app full screen for its owner, with the App Studio around it: the running app, a picker that
 * points the chat at one element, and panels for the app's data, code, versions and settings.
 * The chat's composer stays docked, so "make this a chart" goes to the bot with the app open.
 */
export function AppStudio({
  open,
  onOpenChange,
  page,
  ownerName,
  share,
  composer,
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
  const [picking, setPicking] = useState(false);
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
    refetchInterval: 4000,
  });
  // The picker needs the preview build, whose elements carry their source lines.
  const preview = useQuery({
    ...queries.apps.preview.queryOptions({ input: { pageId: pageId ?? "" } }),
    enabled: picking && pageId !== null,
    staleTime: 60_000,
  });
  const tagged = picking ? preview.data?.html : null;
  const newest = revision.data?.version;
  useEffect(() => {
    if (pageId && newest && page && newest !== page.currentVersion) {
      void queryClient.invalidateQueries({ queryKey: queries.pages.get.key() });
      void queryClient.invalidateQueries({ queryKey: queries.apps.key() });
    }
  }, [newest, page, pageId, queries, queryClient]);
  useEffect(() => setProblem(null), [page?.version]);

  function pick(selected: AppPick) {
    setPicking(false);
    const what = selected.text
      ? `the ${selected.tag} "${selected.text.slice(0, 60)}"`
      : `this ${selected.tag}`;
    onReply?.(`In ${selected.loc}, ${what}: `);
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
    "grid place-items-center rounded-full border border-foreground/[0.06] text-foreground outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-primary/15 aria-pressed:text-primary";
  const size = compact ? "size-11" : "size-[35px]";

  return (
    <Dialog open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogContent
        showCloseButton={false}
        initialFocus={closeButton}
        finalFocus={returnFocus}
        data-testid="app-studio"
        className="top-0 left-0 block h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none bg-background p-0 ring-0 sm:max-w-none data-open:duration-[260ms] data-open:zoom-in-[0.98] data-open:slide-in-from-bottom-3 data-closed:duration-150 motion-reduce:data-open:zoom-in-100"
      >
        <header className="absolute inset-x-0 top-0 z-10 flex h-[48px] items-center gap-2 px-2.5">
          <DialogClose ref={closeButton} aria-label={t`Close app`} className={`${control} ${size}`}>
            <X className="size-[18px]" strokeWidth={1.7} />
          </DialogClose>
          <DialogTitle className="min-w-0 flex-1 truncate px-1 text-[14px] leading-5 font-medium text-foreground">
            {page?.title ?? t`App`}
          </DialogTitle>
          {page ? (
            <>
              <button
                type="button"
                aria-pressed={picking}
                title={t`Point at something in the app to change it`}
                aria-label={t`Select an element`}
                onClick={() => {
                  setPicking((on) => !on);
                  if (compact) setPanel(null);
                }}
                className={`${control} ${size}`}
              >
                <MousePointerClick className="size-[18px]" strokeWidth={1.7} />
              </button>
              <nav
                aria-label={t`App Studio`}
                className="flex items-center gap-0.5 rounded-full border border-foreground/[0.06] p-[3px]"
              >
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={panel === tab.id}
                    onClick={() => setPanel((current) => (current === tab.id ? null : tab.id))}
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
          className={`absolute inset-x-0 top-[48px] flex ${composer ? "bottom-[72px]" : "bottom-0"}`}
        >
          <section aria-label={page?.title} className="relative min-w-0 flex-1">
            {notice ??
              (page && source ? (
                <>
                  <AppFrame
                    key={`${page.version}:${tagged ? "tagged" : "built"}`}
                    document={tagged ?? page.code}
                    title={page.title}
                    app={{ id: page.id, version: page.version }}
                    source={source}
                    picking={picking}
                    onPick={pick}
                    onProblem={setProblem}
                  />
                  {picking ? (
                    <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
                      <p className="rounded-full bg-foreground px-3 py-1.5 text-[12px] text-background shadow-lg">
                        {t`Click something in the app to tell the bot what to change`}
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
                  <AppHistoryPanel pageId={page.id} current={page.currentVersion} />
                ) : null}
                {panel === "settings" ? (
                  <AppSettingsPanel pageId={page.id} title={page.title} />
                ) : null}
              </div>
            </aside>
          ) : null}
        </div>
        {composer ? (
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
