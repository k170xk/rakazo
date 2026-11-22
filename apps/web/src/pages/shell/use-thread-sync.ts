import type {
  AppBootstrap,
  Bot,
  ComputerStatus,
  Group,
  ProductEvent,
  RoutineHistory,
  ThreadSnapshot,
} from "@rakazo/contracts";
import {
  anySignal,
  createRefreshCoalescer,
  isRunTerminalEvent,
  isRunWorking,
  runThreadSubscription,
} from "@rakazo/core";
import { fetchFresh } from "@rakazo/core/query";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { chatEventHaptic } from "../../lib/haptics";
import {
  newLogoAvatarActivitySource,
  openLogoAvatarActivityFeed,
  webLogoAvatarActivity,
} from "../../lib/logo-avatar-activity.js";
import { relistPagesForBlocks } from "../../lib/page-actions";
import { markOnce } from "../../lib/performance";
import type { SpaceQueries } from "../../lib/query";
import { queryClient } from "../../lib/query";
import type { createSpaceRpc } from "../../lib/rpc";
import {
  activeThreadRuns,
  isComputerStatusEvent,
  isThreadSnapshotEvent,
  prependThreadMessagePage,
  reconcileRefreshedThread,
  reduceComputerStatus,
  reduceThreadSnapshot,
} from "../../lib/thread-events";
import { transcriptCanSnapAfterFrame, transcriptIsNearEnd } from "../../lib/transcript-scroll";
import type { useBrowserNotifications } from "./use-browser-notifications";
import type { ComputerState } from "./use-computer";
import type { ThreadState } from "./use-thread-state";

const THREAD_SNAPSHOT_TIMEOUT_MS = 2_000;

function threadSnapshotSignal(parent: AbortSignal): AbortSignal {
  return anySignal([parent, AbortSignal.timeout(THREAD_SNAPSHOT_TIMEOUT_MS)]);
}

function applyThreadEvent(
  event: ProductEvent,
  commitSnapshot: (next: ThreadSnapshot | null) => void,
  commitComputer: (next: ComputerStatus | null) => void,
  snapshotRef: RefObject<ThreadSnapshot | null>,
  computerRef: RefObject<ComputerStatus | null>,
) {
  if (isThreadSnapshotEvent(event)) {
    const next = reduceThreadSnapshot(snapshotRef.current, event);
    commitSnapshot(next);
  }
  if (isComputerStatusEvent(event)) {
    const next = reduceComputerStatus(computerRef.current, event);
    commitComputer(next);
  }
}

/** Loads the open chat, keeps it live, and pages in its older history. */
export function useThreadSync({
  rpc,
  queries,
  thread,
  computerState,
  seed,
  active,
  activeThreadId,
  inGroup,
  groupId,
  activeGroup,
  activeBotId,
  activeThreadIdRef,
  activeGroupId,
  botsRef,
  searchParamsRef,
  refreshBots,
  onInvalidThread,
  notifyBrowserForEvent,
  markBotReadIfVisible,
  markGroupReadOnReply,
}: {
  rpc: ReturnType<typeof createSpaceRpc>;
  queries: SpaceQueries;
  thread: ThreadState;
  computerState: ComputerState;
  seed: AppBootstrap | undefined;
  active: Bot | undefined;
  activeThreadId?: string;
  inGroup: boolean;
  groupId: string | undefined;
  activeGroup: Group | undefined;
  activeBotId: RefObject<string | undefined>;
  activeThreadIdRef?: RefObject<string | undefined>;
  activeGroupId: RefObject<string | undefined>;
  botsRef: RefObject<Bot[]>;
  searchParamsRef: RefObject<URLSearchParams>;
  refreshBots: (includeArchived?: boolean) => Promise<void>;
  onInvalidThread?: (botId: string) => void;
  notifyBrowserForEvent: ReturnType<typeof useBrowserNotifications>["notifyBrowserForEvent"];
  markBotReadIfVisible: (botId: string, threadId?: string) => void;
  markGroupReadOnReply: (groupId: string) => void;
}) {
  const {
    snapshot,
    snapshotRef,
    commitSnapshot,
    updateSnapshot,
    setRoutines,
    setRoutinesBotId,
    setTaughtSkills,
    setTaughtSkillsBotId,
    bootstrappedThread,
    expandedHistoryThread,
    historyEpoch,
    messageScroll,
    pinnedAroundRef,
    resetHistory,
  } = thread;
  const {
    computerRef,
    commitComputer,
    cacheComputerFor,
    showCachedComputer,
    computerOpenRef,
    computerBotIdRef,
    refreshComputerScreen,
  } = computerState;
  const threadRefreshEpoch = useRef(0);
  const groupRefreshEpoch = useRef(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // A very fast run can finish over SSE while its threads.send response is still
  // returning. Do not let that late receipt resurrect terminal work as queued.
  const terminalRunReceipts = useRef(new Set<string>());

  /**
   * Each chat's last snapshot, so reopening it paints at once. The live load and
   * subscription still run and replace it, so it is only ever a first frame.
   */
  function cachedThreadKey(target: { botId: string; threadId?: string } | { groupId: string }) {
    return queries.threads.get.queryKey({ input: target });
  }

  function snapTranscriptToEndAfterFrame() {
    const queuedElement = messageScroll.current;
    if (!queuedElement) return;
    const queuedScrollTop = queuedElement.scrollTop;
    window.requestAnimationFrame(() => {
      const element = messageScroll.current;
      if (transcriptCanSnapAfterFrame(element, queuedElement, queuedScrollTop)) {
        queuedElement.scrollTop = queuedElement.scrollHeight;
      }
    });
  }

  async function refreshGroupThread(id: string, signal?: AbortSignal) {
    const scrollElement = messageScroll.current;
    const stickToEnd = !scrollElement || transcriptIsNearEnd(scrollElement);
    markOnce("rk:renderer:thread-request-start");
    const request = ++groupRefreshEpoch.current;
    const snap = await rpc.threads.get({ groupId: id }, signal ? { signal } : undefined);
    markOnce("rk:renderer:thread-response");
    if (activeGroupId.current !== id || request !== groupRefreshEpoch.current) return snap;
    const reconciled = reconcileRefreshedThread(
      snapshotRef.current,
      snap,
      computerRef.current,
      expandedHistoryThread.current === snap.threadId,
    );
    webLogoAvatarActivity.reconcile(snap);
    commitSnapshot(reconciled.snapshot);
    if (!computerOpenRef.current) commitComputer(null);
    setRoutines([]);
    setRoutinesBotId(null);
    // Keep the search-jump viewport; expandedHistoryThread merge still accepts live messages.
    if (
      stickToEnd &&
      (!scrollElement || transcriptIsNearEnd(scrollElement)) &&
      expandedHistoryThread.current !== snap.threadId
    ) {
      snapTranscriptToEndAfterFrame();
    }
    return snap;
  }

  async function refreshThread(id: string, signal?: AbortSignal, threadIdOverride?: string) {
    const targetThreadId =
      threadIdOverride !== undefined ? threadIdOverride : activeThreadIdRef?.current;
    const scrollElement = messageScroll.current;
    const stickToEnd = !scrollElement || transcriptIsNearEnd(scrollElement);
    markOnce("rk:renderer:thread-request-start");
    const epoch = historyEpoch.current;
    const request = ++threadRefreshEpoch.current;
    // Apply threads.get as soon as it returns so stop/takeover status is not held behind
    // routines/skills/screen fetches (progress can advance the cursor meanwhile).
    const snap = await rpc.threads
      .get(
        { botId: id, ...(targetThreadId ? { threadId: targetThreadId } : {}) },
        signal ? { signal } : undefined,
      )
      .catch((error: unknown) => {
        if (
          targetThreadId &&
          activeBotId.current === id &&
          activeThreadIdRef?.current === targetThreadId &&
          !signal?.aborted &&
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")
        ) {
          onInvalidThread?.(id);
        }
        throw error;
      });
    markOnce("rk:renderer:thread-response");
    if (
      activeBotId.current !== id ||
      activeThreadIdRef?.current !== targetThreadId ||
      epoch !== historyEpoch.current ||
      request !== threadRefreshEpoch.current
    ) {
      return snap;
    }
    const sameThread = snapshotRef.current?.threadId === snap.threadId;
    const reconciled = reconcileRefreshedThread(
      sameThread ? snapshotRef.current : null,
      snap,
      computerRef.current,
      expandedHistoryThread.current === snap.threadId,
    );
    webLogoAvatarActivity.reconcile(snap);
    commitSnapshot(reconciled.snapshot);
    commitComputer(reconciled.computer);
    cacheComputerFor(id, { computer: reconciled.computer });
    if (
      stickToEnd &&
      (!scrollElement || transcriptIsNearEnd(scrollElement)) &&
      expandedHistoryThread.current !== snap.threadId
    ) {
      snapTranscriptToEndAfterFrame();
    }
    void Promise.all([
      // Runs after routine changes too, so an older read in flight is not reused.
      fetchFresh(queryClient, queries.routines.list.queryOptions({ input: { botId: id } })).catch(
        () => null,
      ),
      fetchFresh(queryClient, queries.skills.list.queryOptions({ input: { botId: id } })).catch(
        () => null,
      ),
      refreshComputerScreen(id).catch(() => null),
    ]).then(([routines, skills]) => {
      if (
        activeBotId.current !== id ||
        activeThreadIdRef?.current !== targetThreadId ||
        epoch !== historyEpoch.current ||
        request !== threadRefreshEpoch.current
      ) {
        return;
      }
      if (routines) {
        setRoutines(routines);
        setRoutinesBotId(id);
      }
      if (skills) {
        setTaughtSkills(skills);
        setTaughtSkillsBotId(id);
      }
    });
    return snap;
  }

  /** An open run history that already lists the finished run shows its outcome without its poll. */
  function refreshRoutineHistory(runId: string | null | undefined) {
    if (!runId) return;
    void queryClient.invalidateQueries({
      queryKey: queries.routines.history.key(),
      predicate: (query) =>
        (query.state.data as { pages?: RoutineHistory[] } | undefined)?.pages?.some((page) =>
          page.runs.some((run) => run.id === runId),
        ) ?? false,
    });
  }

  async function loadOlderMessages() {
    const targetBotId = inGroup ? undefined : active?.id;
    const targetThreadId = inGroup ? undefined : activeThreadIdRef?.current;
    const targetGroupId = inGroup ? groupId : undefined;
    const snapshotMatchesTarget = targetGroupId
      ? snapshot?.groupId === targetGroupId
      : snapshot?.botId === targetBotId &&
        (!targetThreadId || snapshot?.threadId === targetThreadId);
    if (
      (!targetBotId && !targetGroupId) ||
      !snapshotMatchesTarget ||
      snapshot?.olderCursor == null ||
      loadingOlder
    )
      return;
    pinnedAroundRef.current = null;
    const scrollElement = messageScroll.current;
    const previousHeight = scrollElement?.scrollHeight ?? 0;
    const epoch = historyEpoch.current;
    const before = snapshot.olderCursor;
    setLoadingOlder(true);
    try {
      const page = await rpc.threads.messages({
        ...(targetGroupId
          ? { groupId: targetGroupId }
          : { botId: targetBotId!, ...(targetThreadId ? { threadId: targetThreadId } : {}) }),
        before,
      });
      if (
        epoch !== historyEpoch.current ||
        activeBotId.current !== targetBotId ||
        activeThreadIdRef?.current !== targetThreadId ||
        activeGroupId.current !== targetGroupId
      )
        return;
      expandedHistoryThread.current = page.threadId;
      updateSnapshot((prev) => prependThreadMessagePage(prev, page));
      window.requestAnimationFrame(() => {
        const element = messageScroll.current;
        if (element) element.scrollTop += element.scrollHeight - previousHeight;
      });
    } finally {
      setLoadingOlder(false);
    }
  }

  useEffect(() => {
    if (!active) return;
    const targetThreadId = activeThreadId;
    const threadTarget = targetThreadId
      ? { botId: active.id, threadId: targetThreadId }
      : { botId: active.id };
    const pendingJump = searchParamsRef.current.get("m");
    if (!pendingJump) {
      pinnedAroundRef.current = null;
    }
    showCachedComputer(active.id);
    expandedHistoryThread.current = null;
    historyEpoch.current += 1;
    const threadKey = cachedThreadKey(threadTarget);
    const cachedThread = pendingJump
      ? undefined
      : (queryClient.getQueryData(threadKey) ??
        (!targetThreadId && seed?.thread?.botId === active.id ? seed.thread : undefined));
    const snapshotMatchesCurrent =
      snapshotRef.current?.botId === active.id &&
      (targetThreadId
        ? snapshotRef.current?.threadId === targetThreadId
        : snapshotRef.current?.isPrimaryThread !== false);
    if (
      cachedThread &&
      !snapshotMatchesCurrent &&
      (targetThreadId ||
        active.threadStatus === undefined ||
        activeThreadRuns(cachedThread).some((run) => isRunWorking(run.status)) ===
          isRunWorking(active.threadStatus))
    ) {
      commitSnapshot(cachedThread);
    } else if (
      !cachedThread &&
      !snapshotMatchesCurrent &&
      snapshotRef.current?.botId === active.id
    ) {
      // Switching between chats of the same agent: clear the previous chat's messages immediately
      // so messages from the other conversation never flash while the selected chat loads.
      commitSnapshot(null);
    }
    const invalidateBotChats = () => {
      const listChats = queries.threads?.listChats;
      if (!listChats) return Promise.resolve();
      return queryClient.invalidateQueries({
        queryKey: listChats.queryKey({ input: { botId: active.id } }),
      });
    };
    const sidebarRefresh = createRefreshCoalescer(async () => {
      await refreshBots();
      await invalidateBotChats();
    });
    const snapshotRefresh = createRefreshCoalescer(() =>
      refreshThread(active.id, undefined, targetThreadId),
    );
    const abort = new AbortController();
    const avatarSource = newLogoAvatarActivitySource();
    void runThreadSubscription({
      signal: abort.signal,
      loadInitial: async () => {
        const primed = bootstrappedThread.current;
        bootstrappedThread.current = null;
        // Pending search jumps load the around-page separately; avoid replacing it with latest.
        return !targetThreadId && primed?.botId === active.id
          ? primed
          : pendingJump
            ? rpc.threads.get(threadTarget, { signal: threadSnapshotSignal(abort.signal) })
            : refreshThread(active.id, threadSnapshotSignal(abort.signal), targetThreadId);
      },
      loadHead: () =>
        rpc.threads.head(threadTarget, { signal: threadSnapshotSignal(abort.signal) }),
      refresh: () => refreshThread(active.id, threadSnapshotSignal(abort.signal), targetThreadId),
      currentSnapshot: () => snapshotRef.current,
      subscribe: (cursor, signal) =>
        openLogoAvatarActivityFeed(avatarSource, snapshotRef.current, cursor, signal, () =>
          rpc.threads.subscribe({ ...threadTarget, cursor }, { signal }),
        ),
      beforeEvent: (event) => {
        webLogoAvatarActivity.apply(avatarSource, event);
        if (isRunTerminalEvent(event) && event.runId) {
          terminalRunReceipts.current.add(event.runId);
          if (terminalRunReceipts.current.size > 100) {
            const oldest = terminalRunReceipts.current.values().next().value;
            if (oldest !== undefined) terminalRunReceipts.current.delete(oldest);
          }
        }
      },
      applyEvent: (event) =>
        applyThreadEvent(event, commitSnapshot, commitComputer, snapshotRef, computerRef),
      onEvent: (event, initial) => {
        chatEventHaptic(event, initial.cursor);
        const currentBot = botsRef.current.find((bot) => bot.id === active.id);
        notifyBrowserForEvent(
          event,
          initial.threadId,
          initial.cursor,
          true,
          currentBot?.name ?? active.name,
          currentBot?.notifyOnFinish ?? false,
          false,
        );
        if (event.type === "thread.cleared") resetHistory();
        if (event.type === "bot.archived") {
          void refreshBots(true).catch(() => undefined);
        } else if (
          event.type === "bot.spawned" ||
          event.type === "bot.deleted" ||
          event.type === "bot.updated" ||
          event.type === "group.created" ||
          event.type === "run.started" ||
          isRunTerminalEvent(event) ||
          event.type === "thread.cleared"
        ) {
          void sidebarRefresh.invalidate().catch(() => undefined);
        }
        if (
          isRunTerminalEvent(event) ||
          (event.type === "agent.tool.completed" &&
            typeof event.payload.name === "string" &&
            /^(todo_(add|update|archive)|use_tool)$/.test(event.payload.name))
        ) {
          void queryClient.invalidateQueries({ queryKey: queries.todos.key() });
        }
        if (event.type === "thread.message.created") {
          const blocks = (event.payload.blocks as Array<{ kind?: string }>) ?? [];
          relistPagesForBlocks(queries, queryClient, blocks);
          void invalidateBotChats().catch(() => undefined);
          if (!snapshotRef.current?.threadTitle) {
            void snapshotRefresh.invalidate().catch(() => undefined);
          }
          if (blocks.some((block) => block.kind === "child_bot")) {
            void sidebarRefresh.invalidate().catch(() => undefined);
          }
          if (event.payload.role === "bot") markBotReadIfVisible(active.id, targetThreadId);
        }
        if (
          isRunTerminalEvent(event) ||
          event.type === "run.waiting_input" ||
          event.type === "skill.teaching.stopped"
        ) {
          // waiting_input: reconcile ask cards if a stale post-send refresh raced SSE.
          void snapshotRefresh.invalidate().catch(() => undefined);
        } else if (isComputerStatusEvent(event)) {
          void refreshComputerScreen(active.id).catch(() => undefined);
        }
        if (isRunTerminalEvent(event)) refreshRoutineHistory(event.runId);
      },
    });
    return () => {
      sidebarRefresh.dispose();
      snapshotRefresh.dispose();
      abort.abort();
      webLogoAvatarActivity.resetSource(avatarSource);
      const left = snapshotRef.current;
      if (
        left?.botId === active.id &&
        !left.groupId &&
        (targetThreadId ? left.threadId === targetThreadId : left.isPrimaryThread !== false)
      ) {
        queryClient.setQueryData(threadKey, left);
      }
    };
  }, [active?.id, activeThreadId, markBotReadIfVisible, notifyBrowserForEvent]);

  useEffect(() => {
    if (!groupId || !activeGroup) return;
    const pendingJump = searchParamsRef.current.get("m");
    if (!pendingJump) {
      pinnedAroundRef.current = null;
      expandedHistoryThread.current = null;
    }
    historyEpoch.current += 1;
    const threadKey = cachedThreadKey({ groupId });
    const cachedThread = pendingJump ? undefined : queryClient.getQueryData(threadKey);
    if (cachedThread && snapshotRef.current?.groupId !== groupId) commitSnapshot(cachedThread);
    const sidebarRefresh = createRefreshCoalescer(() => refreshBots());
    const snapshotRefresh = createRefreshCoalescer(() => refreshGroupThread(groupId));
    const abort = new AbortController();
    const avatarSource = newLogoAvatarActivitySource();
    void runThreadSubscription({
      signal: abort.signal,
      loadInitial: () =>
        pendingJump
          ? rpc.threads.get({ groupId }, { signal: threadSnapshotSignal(abort.signal) })
          : refreshGroupThread(groupId, threadSnapshotSignal(abort.signal)),
      loadHead: () => rpc.threads.head({ groupId }, { signal: threadSnapshotSignal(abort.signal) }),
      refresh: () => refreshGroupThread(groupId, threadSnapshotSignal(abort.signal)),
      currentSnapshot: () => snapshotRef.current,
      subscribe: (cursor, signal) =>
        openLogoAvatarActivityFeed(avatarSource, snapshotRef.current, cursor, signal, () =>
          rpc.threads.subscribe({ groupId, cursor }, { signal }),
        ),
      beforeEvent: (event) => webLogoAvatarActivity.apply(avatarSource, event),
      applyEvent: (event) =>
        applyThreadEvent(
          event,
          commitSnapshot,
          (next) => {
            if (isComputerStatusEvent(event) && event.botId !== computerBotIdRef.current) return;
            commitComputer(next);
          },
          snapshotRef,
          computerRef,
        ),
      onEvent: (event, initial) => {
        chatEventHaptic(event, initial.cursor);
        const eventBot = botsRef.current.find((bot) => bot.id === event.botId);
        notifyBrowserForEvent(
          event,
          initial.threadId,
          initial.cursor,
          true,
          eventBot?.name ?? activeGroup.name,
          true,
          true,
        );
        if (event.type === "thread.message.created" && event.payload.role === "bot") {
          markGroupReadOnReply(groupId);
        }
        if (event.type === "thread.message.created") {
          relistPagesForBlocks(
            queries,
            queryClient,
            (event.payload.blocks as Array<{ kind?: string }>) ?? [],
          );
        }
        if (
          event.type === "run.started" ||
          event.type === "bot.updated" ||
          event.type === "group.updated" ||
          isRunTerminalEvent(event)
        ) {
          void sidebarRefresh.invalidate().catch(() => undefined);
        }
        if (isRunTerminalEvent(event) || event.type === "run.waiting_input") {
          // waiting_input: reconcile ask cards if a stale post-send refresh raced SSE.
          void snapshotRefresh.invalidate().catch(() => undefined);
        }
        if (isRunTerminalEvent(event)) refreshRoutineHistory(event.runId);
      },
    });
    return () => {
      sidebarRefresh.dispose();
      snapshotRefresh.dispose();
      abort.abort();
      webLogoAvatarActivity.resetSource(avatarSource);
      const left = snapshotRef.current;
      if (left?.groupId === groupId) queryClient.setQueryData(threadKey, left);
    };
  }, [activeGroup?.id, groupId, notifyBrowserForEvent, markGroupReadOnReply]);

  // Memoized children take these, so they stay referentially stable across renders.
  const refreshThreadRef = useRef(refreshThread);
  refreshThreadRef.current = refreshThread;
  const refreshGroupThreadRef = useRef(refreshGroupThread);
  refreshGroupThreadRef.current = refreshGroupThread;
  const loadOlderMessagesRef = useRef(loadOlderMessages);
  loadOlderMessagesRef.current = loadOlderMessages;
  const loadOlder = useCallback(() => loadOlderMessagesRef.current(), []);
  const refreshActiveThread = useCallback(async () => {
    const groupId = activeGroupId.current;
    if (groupId) {
      await refreshGroupThreadRef.current(groupId);
      return;
    }
    const id = activeBotId.current;
    if (!id) return;
    await refreshThreadRef.current(id);
  }, []);

  return {
    refreshThread,
    refreshGroupThread,
    refreshThreadRef,
    refreshGroupThreadRef,
    refreshActiveThread,
    loadOlder,
    loadingOlder,
    terminalRunReceipts,
  };
}
