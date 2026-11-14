import { Trans, useLingui } from "@lingui/react/macro";
import type { PageSummary } from "@rakazo/contracts";
import { uniquePages } from "@rakazo/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Disclosure,
  Spinner,
} from "@rakazo/ui-web";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  Activity,
  AppWindow,
  CalendarDays,
  ChartColumn,
  Eye,
  Images,
  ListTodo,
  Pencil,
  Sparkles,
  Table2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { chatForPage } from "../../lib/app-chat";
import { categoryForAppTitle, type AppCategoryId } from "../../lib/app-category";
import { APP_VIEW_PARAM, PAGE_PARAM } from "../../lib/pages";
import { useSpaceQueries } from "../../lib/query";
import { formatRelativeTime } from "../../lib/relative-time";
import { AppIcon } from "./AppIcon";

const PAGE_SIZE = 40;

type PublishedApp = {
  id: string;
  title: string;
  owner: string;
  icon: string | null;
  path: string | null;
  publishedToEvolve: boolean;
};

/**
 * The person's apps, plus apps colleagues published for the company. An own app opens full screen
 * to use, or in the editor. A company app opens only through its share link, which has no editor.
 * A short banner sits above the apps. What an app can include stays folded until someone opens it.
 */
export function AppsDialog({
  open,
  onOpenChange,
  bots,
  onOpen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bots: readonly { id: string; archivedAt: string | null }[];
  onOpen: (path: string) => void;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const [notice, setNotice] = useState<string | null>(null);
  const mine = useInfiniteQuery(
    queries.pages.list.infiniteOptions({
      input: (cursor: string | null) => ({
        kind: "app" as const,
        limit: PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      }),
      initialPageParam: null as string | null,
      getNextPageParam: (page) => page.nextCursor,
      enabled: open,
    }),
  );
  const published = useQuery({
    ...queries.pages.published.queryOptions(),
    enabled: open,
  });
  const apps = uniquePages((mine.data?.pages ?? []).flatMap((read) => read.items));
  const company = (published.data?.items ?? []) as PublishedApp[];
  const categoryLabel = (id: AppCategoryId) => {
    switch (id) {
      case "clients":
        return t`Clients & fees`;
      case "people":
        return t`People & time`;
      case "workshop":
        return t`Workshops & studies`;
      case "register":
        return t`Registers & BIM`;
      case "field":
        return t`Site & field`;
      case "delivery":
        return t`Project delivery`;
      case "custom":
        return t`Custom tool`;
    }
  };
  const kits: { icon: LucideIcon; title: string; detail: string }[] = [
    {
      icon: CalendarDays,
      title: t`Calendars & planning`,
      detail: t`Month calendar, Gantt chart, timeline, daily heatmap and period comparisons.`,
    },
    {
      icon: ListTodo,
      title: t`Boards & to-dos`,
      detail: t`Kanban, checklists, guided steps, sortable lists and a command menu.`,
    },
    {
      icon: Activity,
      title: t`Feeds & updates`,
      detail: t`Activity feed, comments on a record, who is viewing it, and its change history.`,
    },
    {
      icon: ChartColumn,
      title: t`Graphs & charts`,
      detail: t`Area, bar, line, donut, funnel, gauge, scatter, sparklines and KPI trends.`,
    },
    {
      icon: Images,
      title: t`Maps & photos`,
      detail: t`Site map, photo map, gallery, side-by-side photos, mark-up and signatures.`,
    },
    {
      icon: Table2,
      title: t`Registers & files`,
      detail: t`Search, filters, linked records, Excel, CSV and a branded PDF.`,
    },
    {
      icon: Sparkles,
      title: t`Motion & layout`,
      detail: t`Animations, staggered entrances, light and dark themes, and phone layouts.`,
    },
    {
      icon: Users,
      title: t`People & projects`,
      detail: t`A separate dataset per project or site, roles, private rows and avatars.`,
    },
  ];

  const openMine = (page: PageSummary, mode: "view" | "edit") => {
    const chat = chatForPage(page, bots);
    if (!chat) {
      setNotice(t`Create an agent to open this app.`);
      return;
    }
    setNotice(null);
    onOpenChange(false);
    const view = mode === "view" ? `&${APP_VIEW_PARAM}=1` : "";
    onOpen(`${chat}?${PAGE_PARAM}=${encodeURIComponent(page.id)}${view}`);
  };
  const openCompany = (app: PublishedApp) => {
    if (!app.path) return;
    setNotice(null);
    onOpenChange(false);
    onOpen(app.path);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setNotice(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[min(880px,90vh)] flex-col gap-4 overflow-hidden sm:max-w-4xl">
        <DialogHeader className="shrink-0 pe-8">
          <DialogTitle>
            <Trans>Apps</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Open one full screen, or edit an app you built.</Trans>
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pe-1">
          {notice ? (
            <p role="status" className="text-[13px] text-muted-foreground">
              {notice}
            </p>
          ) : null}
          <section className="flex flex-col gap-3">
            <h3 className="px-1 text-xs font-medium text-muted-foreground">
              <Trans>Your apps</Trans>
            </h3>
            {mine.isPending ? (
              <div className="grid place-items-center py-6 text-muted-foreground">
                <Spinner />
              </div>
            ) : mine.isError ? (
              <p role="alert" className="px-1 text-[13px] text-muted-foreground">
                <Trans>Couldn't load apps.</Trans>
              </p>
            ) : apps.length === 0 ? (
              <p className="px-1 py-1 text-[13px] text-muted-foreground">
                <Trans>
                  Apps you ask an agent to build appear here, and stay if that agent is removed.
                </Trans>
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {apps.map((page) => (
                  <li key={page.id}>
                    <AppCard
                      title={page.title}
                      category={categoryLabel(categoryForAppTitle(page.title))}
                      detail={
                        page.botId
                          ? formatRelativeTime(page.updatedAt)
                          : `${t`No agent`} · ${formatRelativeTime(page.updatedAt)}`
                      }
                      icon={
                        <AppIcon
                          pageId={page.id}
                          icon={page.icon}
                          className="size-10"
                          fallback={
                            <AppWindow className="size-5 text-primary" strokeWidth={1.7} />
                          }
                        />
                      }
                      actions={
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid="open-app-view"
                            onClick={() => openMine(page, "view")}
                          >
                            <Eye className="size-3.5" strokeWidth={1.8} />
                            <Trans>View</Trans>
                          </Button>
                          <Button
                            size="sm"
                            data-testid="open-app-edit"
                            onClick={() => openMine(page, "edit")}
                          >
                            <Pencil className="size-3.5" strokeWidth={1.8} />
                            <Trans>Edit</Trans>
                          </Button>
                        </>
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
            {mine.hasNextPage ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={mine.isFetchingNextPage}
                onClick={() => void mine.fetchNextPage()}
              >
                <Trans>Show more</Trans>
              </Button>
            ) : null}
          </section>
          <section className="flex flex-col gap-3">
            <h3 className="px-1 text-xs font-medium text-muted-foreground">
              <Trans>Published for the company</Trans>
            </h3>
            {published.isPending ? (
              <div className="grid place-items-center py-6 text-muted-foreground">
                <Spinner />
              </div>
            ) : published.isError ? (
              <p role="alert" className="px-1 text-[13px] text-muted-foreground">
                <Trans>Couldn't load apps.</Trans>
              </p>
            ) : company.length === 0 ? (
              <p className="px-1 py-1 text-[13px] text-muted-foreground">
                <Trans>Published company apps appear here.</Trans>
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {company.map((app) => (
                  <li key={app.id}>
                    <AppCard
                      title={app.title}
                      category={categoryLabel(categoryForAppTitle(app.title))}
                      detail={
                        app.path
                          ? app.owner
                          : app.publishedToEvolve
                            ? t`Published in Evolve`
                            : app.owner
                      }
                      icon={<AppWindow className="size-5 text-primary" strokeWidth={1.7} />}
                      actions={
                        app.path ? (
                          <Button size="sm" variant="outline" onClick={() => openCompany(app)}>
                            <Eye className="size-3.5" strokeWidth={1.8} />
                            <Trans>View</Trans>
                          </Button>
                        ) : null
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <Disclosure
            className="rounded-xl border border-border px-3 py-2.5"
            summaryClassName="w-full text-sm font-medium text-foreground"
            contentClassName="mt-3"
            summary={<Trans>What an app can include</Trans>}
          >
            <div className="flex flex-col gap-3">
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                <Trans>
                  We want our staff to create apps and tools that make the work faster and more
                  efficient. That speed is there so the result for the client is better. Quality
                  comes before convenience.
                </Trans>
              </p>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                <Trans>
                  An OCSC app is containerized inside Evolve, in our own ecosystem. It uses the
                  company sign-in and the data we already trust, and it stays in that sandbox rather
                  than becoming a separate website.
                </Trans>
              </p>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                <Trans>
                  These libraries are already switched on. Describe the job to an agent and it can
                  use any of them on day one.
                </Trans>
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {kits.map((kit) => (
                  <li
                    key={kit.title}
                    className="flex gap-2.5 rounded-xl border border-border bg-background p-3"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <kit.icon className="size-4" strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">{kit.title}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                        {kit.detail}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Disclosure>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AppCard({
  title,
  category,
  detail,
  icon,
  actions,
}: {
  title: string;
  category: string;
  detail?: string;
  icon: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-background p-3">
      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-muted">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{title}</span>
        <span className="truncate text-xs text-muted-foreground">
          <span className="font-medium text-primary">{category}</span>
          {detail ? ` · ${detail}` : null}
        </span>
      </span>
      {actions ? <span className="flex shrink-0 items-center gap-1.5">{actions}</span> : null}
    </div>
  );
}
