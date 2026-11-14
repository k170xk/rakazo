import { BoardThumbnail } from "@rakazo/app-kit/ui";
import { pageIsShared } from "@rakazo/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { ownerAppSource } from "../../lib/app-host";
import type { PageBlock } from "../../lib/page-cards";
import { useOpenPage, usePageDocument } from "../../lib/pages";
import { useSpaceQueries } from "../../lib/query";
import { errorCode } from "../../lib/user-error";
import { AppIcon } from "../apps/AppIcon";
import { AppUpdateCard, PageCard } from "./PageCard";
import { PageTileIcon } from "./page-icon";

const ICON_WAIT_MS = 5 * 60_000;

/**
 * A page saved in this chat. The initial creation card for an app draws its live preview; later
 * edits to an existing app render as a compact update card with a summary and Open / Edit buttons.
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
  const isApp = current.data?.kind === "app";
  const isBoard = current.data?.kind === "whiteboard";
  const isAppUpdate = isApp && !(block.created ?? block.version === 1);
  const saved = useQuery({
    ...queries.pages.get.queryOptions({ input: { pageId: block.pageId, version: block.version } }),
    enabled: updated && !isAppUpdate,
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
  // An app draws from its own data, a whiteboard from its shapes. Only pages use the runtime.
  const viewer = usePageDocument(isApp || isBoard ? undefined : shown?.code);
  const source = useMemo(
    () =>
      isApp && !isAppUpdate
        ? ownerAppSource(queries, block.pageId, current.data?.owner.name ?? null)
        : null,
    [isApp, isAppUpdate, queries, block.pageId, current.data?.owner.name],
  );
  const app =
    isApp && !isAppUpdate && source && current.data?.code
      ? {
          id: block.pageId,
          version: current.data.version,
          document: current.data.code,
          source,
        }
      : undefined;
  const deleted = errorCode(current.error) === "NOT_FOUND";
  const unread = shown === undefined && (updated ? saved.isError : current.isError);
  const icon =
    isApp && current.data?.icon ? (
      <AppIcon
        pageId={block.pageId}
        icon={current.data.icon}
        className="size-[41px]"
        fallback={<PageTileIcon />}
      />
    ) : undefined;
  if (isAppUpdate) {
    return (
      <AppUpdateCard
        title={current.data?.title ?? block.title}
        version={block.version}
        summary={block.summary}
        updatedAt={current.data?.updatedAt}
        updated={updated}
        icon={icon}
        onOpenPreview={deleted ? undefined : () => openPage(block.pageId, { view: true })}
        onEdit={deleted ? undefined : () => openPage(block.pageId)}
      />
    );
  }
  return (
    <PageCard
      title={current.data?.title ?? block.title}
      document={deleted ? null : viewer.document}
      failed={(!isApp && !isBoard && viewer.failed) || unread}
      preview={isBoard && shown?.code ? <BoardThumbnail value={shown.code} /> : undefined}
      app={app}
      updated={updated}
      updatedAt={current.data?.updatedAt}
      shared={current.data ? pageIsShared(current.data.visibility) : false}
      onOpen={deleted ? undefined : () => openPage(block.pageId)}
      icon={icon}
    />
  );
}
