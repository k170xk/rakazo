import { pageIsShared } from "@rakazo/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { ownerAppSource } from "../../lib/app-host";
import type { PageBlock } from "../../lib/page-cards";
import { useOpenPage, usePageDocument } from "../../lib/pages";
import { useSpaceQueries } from "../../lib/query";
import { errorCode } from "../../lib/user-error";
import { AppIcon } from "../apps/AppIcon";
import { PageCard } from "./PageCard";
import { PageTileIcon } from "./page-icon";

const ICON_WAIT_MS = 5 * 60_000;

/**
 * A page saved in this chat. The newest card for a page draws its current version and title;
 * an older one keeps the version it was saved with and opens the latest.
 */
export function PageBlockCard({ block, updated }: { block: PageBlock; updated: boolean }) {
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const openPage = useOpenPage();
  const current = useQuery({
    ...queries.pages.get.queryOptions({ input: { pageId: block.pageId } }),
    // A new app's icon is drawn about a minute after it is saved.
    refetchInterval: (query) => {
      const page = query.state.data;
      return page?.kind === "app" &&
        !page.icon &&
        Date.now() - Date.parse(page.updatedAt) < ICON_WAIT_MS
        ? 10_000
        : false;
    },
  });
  const saved = useQuery({
    ...queries.pages.get.queryOptions({ input: { pageId: block.pageId, version: block.version } }),
    enabled: updated,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const currentVersion = current.data?.currentVersion;
  // A version saved after this page was read refreshes it, here and in the open page.
  useEffect(() => {
    if (!updated && currentVersion !== undefined && currentVersion < block.version) {
      void queryClient.invalidateQueries({
        queryKey: queries.pages.get.queryKey({ input: { pageId: block.pageId } }),
        exact: true,
      });
    }
  }, [updated, currentVersion, block.version, block.pageId, queries, queryClient]);
  const shown = updated ? saved.data : current.data;
  const isApp = current.data?.kind === "app";
  // An App Studio app is not a page document: it draws in its own frame from its data.
  const viewer = usePageDocument(isApp ? undefined : shown?.code);
  const source = useMemo(
    () => (isApp ? ownerAppSource(queries, block.pageId, current.data?.owner.name ?? null) : null),
    [isApp, queries, block.pageId, current.data?.owner.name],
  );
  const app =
    isApp && source && current.data?.code
      ? {
          id: block.pageId,
          version: current.data.version,
          document: current.data.code,
          source,
        }
      : undefined;
  const deleted = errorCode(current.error) === "NOT_FOUND";
  const unread = shown === undefined && (updated ? saved.isError : current.isError);
  return (
    <PageCard
      title={current.data?.title ?? block.title}
      document={deleted ? null : viewer.document}
      failed={(!isApp && viewer.failed) || unread}
      app={app}
      updated={updated}
      updatedAt={current.data?.updatedAt}
      shared={current.data ? pageIsShared(current.data.visibility) : false}
      onOpen={deleted ? undefined : () => openPage(block.pageId)}
      icon={
        isApp && current.data?.icon ? (
          <AppIcon
            pageId={block.pageId}
            icon={current.data.icon}
            className="size-[41px]"
            fallback={<PageTileIcon />}
          />
        ) : undefined
      }
    />
  );
}
