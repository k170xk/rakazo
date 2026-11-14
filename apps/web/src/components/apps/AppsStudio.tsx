import { useLingui } from "@lingui/react/macro";
import { openStudioNote, PAGE_LIST_MAX_LIMIT } from "@rakazo/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { pageMutationOptions } from "../../lib/page-actions";
import { useMedia, usePageSession } from "../../lib/pages";
import { useSpaceQueries } from "../../lib/query";
import type { StudioCard } from "../../lib/studio-activity";
import { AppStudio } from "./AppStudio";
import { SharePopover } from "../pages/SharePopover";

const COARSE = "(pointer: coarse)";
const NO_ACTIVITY: StudioCard[] = [];

/**
 * Apps full screen, the way a whiteboard opens: the chat sits on the left and the open app fills
 * the rest. The header switches between this person's apps and any a colleague published.
 */
export function AppsStudio({ onClose }: { onClose: () => void }) {
  const compact = useMedia(COARSE);
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const session = usePageSession();
  const [selected, setSelected] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const list = useQuery({
    ...queries.pages.list.queryOptions({ input: { kind: "app", limit: PAGE_LIST_MAX_LIMIT } }),
  });
  const apps = list.data?.items ?? [];
  const page = useQuery({
    ...queries.pages.get.queryOptions({ input: { pageId: selected ?? "" } }),
    enabled: Boolean(selected),
  });
  const link = useQuery({
    ...queries.pages.get.queryOptions({ input: { pageId: selected ?? "", link: true } }),
    enabled: Boolean(selected) && shareOpen,
  });
  const actions = pageMutationOptions(queries, queryClient);
  const visibility = useMutation(actions.setVisibility);
  const shownVisibility =
    visibility.isError && page.dataUpdatedAt < visibility.submittedAt
      ? null
      : (page.data?.visibility ?? null);
  const running = useSyncExternalStore(
    session?.dock.subscribe ?? (() => () => {}),
    () => session?.dock.get().running === true,
    () => false,
  );
  const activity = useSyncExternalStore(
    session?.dock.subscribe ?? (() => () => {}),
    () => session?.dock.get().activity ?? NO_ACTIVITY,
    () => NO_ACTIVITY,
  );
  const setDockNode = useCallback(
    (node: HTMLDivElement | null) => session?.dock.set({ node }),
    [session],
  );
  const setChatNode = useCallback(
    (chat: HTMLDivElement | null) => session?.dock.set({ chat }),
    [session],
  );

  useEffect(() => {
    if (!apps.length) return;
    if (!selected || !apps.some((app) => app.id === selected)) setSelected(apps[0]!.id);
  }, [apps, selected]);

  useEffect(() => {
    if (!session) return;
    const data = page.data;
    if (data) {
      session.dock.set({
        page: {
          id: data.id,
          title: data.title,
          note: openStudioNote({ kind: "app", title: data.title, id: data.id }),
        },
      });
      return;
    }
    if (list.isSuccess && apps.length === 0) {
      session.dock.set({ page: { note: openStudioNote({ kind: "app", blank: true }) } });
    }
  }, [session, page.data, list.isSuccess, apps.length]);

  useEffect(
    () => () => {
      session?.dock.set({ page: null, node: null, chat: null });
    },
    [session],
  );

  const data = page.data;
  const share = data ? (
    <SharePopover
      compact={compact}
      title={data.title}
      owner={data.owner}
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
  ) : null;

  return (
    <AppStudio
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      page={data}
      ownerName={data?.owner.name ?? null}
      share={share}
      onShare={share ? () => setShareOpen(true) : undefined}
      composer={<div ref={setDockNode} />}
      chat={<div ref={setChatNode} className="flex min-h-0 flex-1 flex-col" />}
      running={running}
      activity={activity}
      onReply={session?.offerReply}
      onSelectApp={setSelected}
      onBuild={(idea) => session?.submit(`Build me an app: ${idea}`)}
      compact={compact}
    />
  );
}
