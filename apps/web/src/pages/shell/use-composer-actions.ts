import { useLingui } from "@lingui/react/macro";
import type {
  Bot,
  ComputerStatus,
  LoginFieldInput,
  Me,
  MessageReaction,
  ThreadMessage,
  ThreadSnapshot,
} from "@rakazo/contracts";
import { attachmentMaxBytes, attachmentMaxCount, attachmentSizeLabel } from "@rakazo/contracts";
import type { ComposerMention } from "@rakazo/core";
import {
  attachmentsForThread,
  inferAttachmentMimeType,
  isImageInputConfirmation,
  newClientId,
  resolveComposerSendPlan,
} from "@rakazo/core";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  hasStudioBeforeSend,
  runStudioBeforeSend,
  studioSelectionImage,
} from "../../components/studio/studio-send";
import { requestBrowserNotificationPermission } from "../../lib/browser-notifications";
import { setComposerUnsavedWork } from "../../lib/composer-draft";
import { scheduleFocusPrompt } from "../../lib/focus-prompt";
import type { PageSession } from "../../lib/pages";
import {
  readFileAsBase64,
  revokePendingAttachmentPreviews,
  usePendingAttachmentPreviewCleanup,
} from "../../lib/pending-attachments";
import { canPrepareImage, prepareImage } from "../../lib/prepare-image";
import type { createSpaceRpc } from "../../lib/rpc";
import { readSeenRunErrorIds, rememberSeenRunErrorId } from "../../lib/run-error-storage";
import {
  applyThreadSendReceipt,
  clearActiveThreadRuns,
  threadRunError,
} from "../../lib/thread-events";
import { errorText } from "../../lib/user-error";
import type { PendingAttachment } from "./chat-shared";
import type { useShellNavigation } from "./use-shell-navigation";

type ThreadRefresh = RefObject<(id: string) => Promise<ThreadSnapshot>>;

type UploadTarget = { botId: string; groupId?: undefined } | { groupId: string; botId?: undefined };

/** A file uploaded when it was attached, so the server can start indexing before Send. */
type EarlyUpload = { target: string; artifactId: Promise<string | null> };

function uploadTargetKey(target: UploadTarget): string {
  return target.groupId ? `group:${target.groupId}` : `agent:${target.botId}`;
}

/**
 * What the composer sends and the chat actions beside it: attachments, replies, send, stop,
 * answers, reactions, and the errors they leave.
 */
export function useComposerActions({
  rpc,
  pageSession,
  activeId,
  inGroup,
  groupId,
  activeBotId,
  activeGroupId,
  botsRef,
  bootstrapMe,
  activeSnapshot,
  navigate,
  refreshBots,
  refreshThreadRef,
  refreshGroupThreadRef,
  updateSnapshot,
  terminalRunReceipts,
  computerRef,
  commitComputer,
  clearReadBoundary,
  flushPendingBrowserNotifications,
}: {
  rpc: ReturnType<typeof createSpaceRpc>;
  /** The chat's open page, whose card a message sent from it replies to. */
  pageSession: PageSession;
  activeId: string | undefined;
  inGroup: boolean;
  groupId: string | undefined;
  activeBotId: RefObject<string | undefined>;
  activeGroupId: RefObject<string | undefined>;
  botsRef: RefObject<Bot[]>;
  bootstrapMe: Me | null | undefined;
  activeSnapshot: ThreadSnapshot | null;
  navigate: ReturnType<typeof useShellNavigation>["navigate"];
  refreshBots: () => Promise<void>;
  refreshThreadRef: ThreadRefresh;
  refreshGroupThreadRef: ThreadRefresh;
  updateSnapshot: (update: (prev: ThreadSnapshot | null) => ThreadSnapshot | null) => void;
  terminalRunReceipts: RefObject<Set<string>>;
  computerRef: RefObject<ComputerStatus | null>;
  commitComputer: (next: ComputerStatus | null) => void;
  clearReadBoundary: () => void;
  flushPendingBrowserNotifications: () => void;
}) {
  const { t } = useLingui();
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  usePendingAttachmentPreviewCleanup(pendingAttachments);
  const pendingAttachmentsRef = useRef(pendingAttachments);
  pendingAttachmentsRef.current = pendingAttachments;
  const [replyTarget, setReplyTarget] = useState<ThreadMessage | null>(null);
  const [replyQuote, setReplyQuote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  useEffect(() => {
    setComposerUnsavedWork({ sending, attachments: pendingAttachments.length > 0 });
    return () => setComposerUnsavedWork({ sending: false, attachments: false });
  }, [sending, pendingAttachments.length]);
  const sendingRef = useRef(false);
  const [sendFailure, setSendFailure] = useState<{
    message: string;
    imageConfirmation: boolean;
  } | null>(null);
  // Counts real composer edits so a late rejection cannot confirm a newer draft.
  const draftEdits = useRef(0);
  const clearImageConfirmation = useCallback(() => {
    draftEdits.current += 1;
    setSendFailure((current) => (current?.imageConfirmation ? null : current));
  }, []);
  const imageConfirmation = sendFailure?.imageConfirmation === true;
  const sendError = sendFailure?.message ?? null;
  const setSendError = useCallback((message: string | null) => {
    setSendFailure(message === null ? null : { message, imageConfirmation: false });
  }, []);
  const uploadedSendArtifacts = useRef(new Map<string, WeakMap<File, string>>());
  const earlyUploads = useRef(new Map<string, EarlyUpload>());
  // One upload at a time, in the order the files were attached.
  const earlyUploadQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dismissedRunErrorIds, setDismissedRunErrorIds] =
    useState<ReadonlySet<string>>(readSeenRunErrorIds);
  const focusPromptAbortRef = useRef<AbortController | null>(null);
  const focusPromptBotIdRef = useRef<string | null>(null);

  const activePendingAttachments = useMemo(
    () => attachmentsForThread(pendingAttachments, inGroup ? groupId : activeId),
    [activeId, groupId, inGroup, pendingAttachments],
  );
  // Keep the armed reply even when its parent leaves the loaded page: the
  // server resolves a paged-out target and degrades a deleted one to a plain
  // reply instead of failing the send.
  const activeReplyTarget = replyTarget;
  const activeReplyQuote = replyTarget ? replyQuote : null;
  const clearReply = useCallback(() => {
    setReplyTarget(null);
    setReplyQuote(null);
  }, []);
  const runError = threadRunError(activeSnapshot, dismissedRunErrorIds);
  const displayedRunError = !sendError ? runError : null;
  const displayedRunErrorId = displayedRunError ? (activeSnapshot?.run?.id ?? null) : null;
  const handleRunErrorPresented = useCallback((runId: string) => {
    rememberSeenRunErrorId(runId);
  }, []);

  function cancelFocusPrompt() {
    focusPromptAbortRef.current?.abort();
    focusPromptAbortRef.current = null;
    focusPromptBotIdRef.current = null;
  }

  /** Starts a new bot's onboarding, then offers its focus card unless the user engages first. */
  async function startFocusPrompt(botId: string, immediate: boolean) {
    // Register cancellation before awaiting start so leaving the bot during
    // startup cannot miss the abort and still schedule a late focus card.
    cancelFocusPrompt();
    const controller = new AbortController();
    focusPromptAbortRef.current = controller;
    focusPromptBotIdRef.current = botId;
    const started = await rpc.onboarding
      .start({ botId })
      .then(() => true)
      .catch(() => false);
    if (!started || controller.signal.aborted || focusPromptBotIdRef.current !== botId) {
      if (focusPromptAbortRef.current === controller) {
        focusPromptAbortRef.current = null;
        focusPromptBotIdRef.current = null;
      }
      return;
    }
    void scheduleFocusPrompt({
      immediate,
      signal: controller.signal,
      shouldSkip: () => sendingRef.current,
      prompt: async () => {
        if (focusPromptBotIdRef.current !== botId || activeBotId.current !== botId) return;
        await rpc.onboarding.promptFocus({ botId }).catch(() => undefined);
      },
    }).finally(() => {
      if (focusPromptAbortRef.current === controller) {
        focusPromptAbortRef.current = null;
        focusPromptBotIdRef.current = null;
      }
    });
  }

  useEffect(() => {
    if (focusPromptBotIdRef.current && focusPromptBotIdRef.current !== activeId) {
      cancelFocusPrompt();
    }
  }, [activeId]);

  useEffect(() => () => cancelFocusPrompt(), []);

  // Switching chats keeps other chats' pending attachments with their previews;
  // only the open chat's files are shown and sent (activePendingAttachments).
  useEffect(() => {
    clearReply();
    setAttachmentNotice(null);
    setSendError(null);
  }, [activeId, clearReply, groupId, inGroup]);

  const answerMessage = useCallback(
    async (
      message: ThreadMessage,
      text: string,
      fields?: LoginFieldInput[],
      dismiss?: boolean,
      remember?: false,
    ) => {
      const botId = activeBotId.current;
      const groupId = activeGroupId.current;
      if (!botId && !groupId) return;
      clearReadBoundary();
      await rpc.threads.answer({
        ...(groupId ? { groupId } : { botId: botId! }),
        runId: message.runId ?? "",
        messageId: message.id,
        answer: text,
        ...(fields ? { fields } : {}),
        ...(remember === false ? { remember } : {}),
        ...(dismiss ? { dismiss: true as const } : {}),
      });
      // The answer is saved; live events can reconcile a failed refresh.
      try {
        if (groupId && activeGroupId.current === groupId) {
          await refreshGroupThreadRef.current(groupId);
        } else if (botId && activeBotId.current === botId) {
          await refreshThreadRef.current(botId);
        }
      } catch {}
    },
    [],
  );
  const reactToMessage = useCallback(
    async (message: ThreadMessage, reaction: MessageReaction) => {
      const botId = activeBotId.current;
      const groupId = activeGroupId.current;
      if (!botId && !groupId) return;
      try {
        const result = await rpc.threads.react({
          ...(groupId ? { groupId } : { botId: botId! }),
          messageId: message.id,
          reaction,
          clientNonce: newClientId(),
        });
        if (result.runIds?.length) {
          // The reaction is saved; a failed refresh is caught up by live events.
          try {
            if (groupId && activeGroupId.current === groupId) {
              await refreshGroupThreadRef.current(groupId);
            } else if (botId && activeBotId.current === botId) {
              await refreshThreadRef.current(botId);
            }
          } catch {}
        }
      } catch (error) {
        const stillHere = groupId
          ? activeGroupId.current === groupId
          : activeBotId.current === botId;
        if (!stillHere) return;
        setSendError(errorText(error, t`Could not update reaction`));
      }
    },
    [t],
  );
  const uploadAttachment = useCallback(
    async (original: File, target: UploadTarget) => {
      const mimeType = inferAttachmentMimeType(original.name, original.type);
      if (!mimeType) {
        throw new Error(t`Unsupported file type: ${original.name}`);
      }
      const file = await prepareImage(original);
      const contentBase64 = await readFileAsBase64(file);
      const artifact = await rpc.artifacts.create({
        ...target,
        name: original.name,
        mimeType,
        contentBase64,
      });
      return artifact.id;
    },
    [t],
  );
  const startEarlyUpload = useCallback(
    (pending: PendingAttachment, target: UploadTarget) => {
      // A failed early upload is retried on Send, where its error can be shown.
      const artifactId = earlyUploadQueue.current
        .then(() => uploadAttachment(pending.file, target))
        .catch(() => null);
      earlyUploadQueue.current = artifactId;
      earlyUploads.current.set(pending.id, { target: uploadTargetKey(target), artifactId });
    },
    [uploadAttachment],
  );
  /** Deletes the copy of an attachment that will not be sent with it. */
  const discardEarlyUpload = useCallback((early: EarlyUpload) => {
    void early.artifactId
      .then((artifactId) => (artifactId ? rpc.artifacts.remove({ artifactId }) : undefined))
      .catch(() => undefined);
  }, []);
  const forgetEarlyUploads = useCallback(
    (attachments: readonly PendingAttachment[], keepFor?: string) => {
      for (const attachment of attachments) {
        const early = earlyUploads.current.get(attachment.id);
        if (!early) continue;
        earlyUploads.current.delete(attachment.id);
        if (early.target !== keepFor) discardEarlyUpload(early);
      }
    },
    [discardEarlyUpload],
  );
  const onAttachmentPick = useCallback(
    (files: FileList | readonly File[] | null) => {
      const groupKey = activeGroupId.current;
      const botKey = activeBotId.current;
      const threadKey = groupKey ?? botKey;
      if (!threadKey || !files?.length) return false;
      const target: UploadTarget = groupKey ? { groupId: groupKey } : { botId: botKey! };
      const ATTACHMENT_MAX_COUNT = attachmentMaxCount(bootstrapMe);
      const existing = attachmentsForThread(pendingAttachments, threadKey);
      const next: PendingAttachment[] = [];
      const skipped: string[] = [];
      for (const file of Array.from(files)) {
        if (existing.length + next.length >= ATTACHMENT_MAX_COUNT) {
          skipped.push(t`${file.name} (max ${ATTACHMENT_MAX_COUNT} attachments)`);
          continue;
        }
        // Raster photos get a chance to shrink before server-side size validation.
        if (file.size > attachmentMaxBytes(bootstrapMe) && !canPrepareImage(file)) {
          skipped.push(
            t`${file.name} (over ${attachmentSizeLabel(attachmentMaxBytes(bootstrapMe))})`,
          );
          continue;
        }
        const mimeType = inferAttachmentMimeType(file.name, file.type);
        if (!mimeType) {
          skipped.push(file.name);
          continue;
        }
        next.push({
          // A client id, not file metadata: two picks of equal metadata are separate attachments.
          id: newClientId(),
          threadKey,
          file,
          previewUrl: mimeType.startsWith("image/") ? URL.createObjectURL(file) : undefined,
        });
      }
      if (next.length) setPendingAttachments((current) => [...current, ...next]);
      for (const pending of next) startEarlyUpload(pending, target);
      setAttachmentNotice(skipped.length ? t`Skipped ${skipped.join(", ")}` : null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return next.length > 0;
    },
    [pendingAttachments, bootstrapMe, startEarlyUpload, t],
  );
  useEffect(() => {
    if (!pendingAttachments.length) uploadedSendArtifacts.current.clear();
  }, [pendingAttachments]);
  const removeAttachment = useCallback(
    (attachment: PendingAttachment) => {
      revokePendingAttachmentPreviews([attachment]);
      forgetEarlyUploads([attachment]);
      setPendingAttachments((current) => current.filter((item) => item.id !== attachment.id));
    },
    [forgetEarlyUploads],
  );
  /** A deleted chat's files can never be sent: drop them and release their previews. */
  const discardThreadAttachments = useCallback(
    (threadKey: string) => {
      forgetEarlyUploads(attachmentsForThread(pendingAttachmentsRef.current, threadKey));
      setPendingAttachments((current) => {
        const discarded = attachmentsForThread(current, threadKey);
        if (!discarded.length) return current;
        revokePendingAttachmentPreviews(discarded);
        return current.filter((attachment) => !discarded.includes(attachment));
      });
    },
    [forgetEarlyUploads],
  );
  const sendMessage = useCallback(
    async (
      draft: string,
      mentions: ComposerMention[],
      clientNonce: string,
      imageHandling?: "file",
    ) => {
      const initialBotTarget = activeBotId.current;
      const initialGroupTarget = activeGroupId.current;
      if ((!initialBotTarget && !initialGroupTarget) || sending) return false;
      const editsAtSend = draftEdits.current;
      const originThreadKey = initialGroupTarget ?? initialBotTarget;
      const attachments = attachmentsForThread(pendingAttachments, originThreadKey);
      const plan = resolveComposerSendPlan({
        text: draft,
        mentions,
        hasAttachments: attachments.length > 0,
      });
      if (plan.isNoOp) return false;
      const reroutedToGroup = Boolean(
        plan.rerouteGroupId && plan.rerouteGroupId !== initialGroupTarget,
      );
      const groupTarget = plan.rerouteGroupId ?? initialGroupTarget;
      const botTarget = reroutedToGroup ? undefined : initialBotTarget;
      if (
        plan.shouldSend &&
        (groupTarget || botsRef.current.find((bot) => bot.id === botTarget)?.notifyOnFinish)
      ) {
        const permissionRequest = requestBrowserNotificationPermission();
        if (permissionRequest) void permissionRequest.then(flushPendingBrowserNotifications);
      }
      sendingRef.current = true;
      setSending(true);
      setSendError(null);
      clearReadBoundary();
      setSentCount((count) => count + 1);
      // An open document studio saves first and names its newest version, so the note and the
      // attached file below both describe what the person sees.
      const studioIds =
        plan.shouldSend && !reroutedToGroup && hasStudioBeforeSend(pageSession)
          ? await runStudioBeforeSend(
              pageSession,
              { botId: botTarget, groupId: groupTarget },
              activeSnapshot?.messages ?? [],
            )
          : [];
      // A picture selected in the studio goes along, unless the person dropped the selection.
      const selectedPicture =
        studioIds.length && !pageSession.dock.selectionDropped()
          ? await studioSelectionImage(pageSession)
          : null;
      // The open page rides only on text this chat sends, never on a group or routine-only send.
      const fromPage =
        plan.shouldSend && !reroutedToGroup
          ? pageSession.send(plan.trimmed, activeSnapshot?.messages ?? [], activeReplyTarget?.id)
          : { text: plan.trimmed, replyToMessageId: undefined };
      const trimmed = fromPage.text.trim();
      const replyToMessageId = fromPage.replyToMessageId;
      const dropDelayedSetup = () => {
        // Only after successful engagement so a failed upload/send keeps the setup card.
        if (initialBotTarget && focusPromptBotIdRef.current === initialBotTarget) {
          cancelFocusPrompt();
        }
      };
      // Keep the draft cleared once the submission is confirmed accepted.
      let accepted = false;
      try {
        if (!plan.shouldSend) {
          if (plan.shouldRunRoutines) {
            await rpc.threads.sendWithRoutines({
              ...(groupTarget ? { groupId: groupTarget } : { botId: botTarget! }),
              clientNonce,
              routineIds: plan.routineIds,
            });
            accepted = true;
          }
          dropDelayedSetup();
          clearReply();
          revokePendingAttachmentPreviews(attachments);
          forgetEarlyUploads(attachments);
          setPendingAttachments((current) =>
            current.filter((attachment) => !attachments.includes(attachment)),
          );
          setAttachmentNotice(null);
          if (reroutedToGroup && groupTarget) {
            navigate(`/app/g/${groupTarget}`);
            return true;
          }
          if (groupTarget && activeGroupId.current === groupTarget) {
            await refreshGroupThreadRef.current(groupTarget);
          } else if (botTarget && activeBotId.current === botTarget) {
            await refreshThreadRef.current(botTarget);
          }
          return true;
        }
        const artifactIds: string[] = [];
        const uploaded =
          uploadedSendArtifacts.current.get(clientNonce) ?? new WeakMap<File, string>();
        uploadedSendArtifacts.current.set(clientNonce, uploaded);
        const sendTarget: UploadTarget = groupTarget
          ? { groupId: groupTarget }
          : { botId: botTarget! };
        const sendTargetKey = uploadTargetKey(sendTarget);
        for (const pending of attachments) {
          const existing = uploaded.get(pending.file);
          if (existing) {
            artifactIds.push(existing);
            continue;
          }
          const early = earlyUploads.current.get(pending.id);
          const earlyId = early?.target === sendTargetKey ? await early.artifactId : null;
          const artifactId = earlyId ?? (await uploadAttachment(pending.file, sendTarget));
          uploaded.set(pending.file, artifactId);
          artifactIds.push(artifactId);
        }
        for (const id of studioIds) if (!artifactIds.includes(id)) artifactIds.push(id);
        if (selectedPicture) {
          const pictureId =
            uploaded.get(selectedPicture) ??
            (await uploadAttachment(selectedPicture, sendTarget).catch(() => null));
          if (pictureId) {
            uploaded.set(selectedPicture, pictureId);
            artifactIds.push(pictureId);
          }
        }
        const payload = {
          ...(groupTarget ? { groupId: groupTarget } : { botId: botTarget! }),
          clientNonce,
          imageHandling: imageHandling ?? "confirm",
          text: trimmed || undefined,
          mentions: plan.mentionPayload.length ? plan.mentionPayload : undefined,
          artifactIds: artifactIds.length ? artifactIds : undefined,
          replyToMessageId: reroutedToGroup
            ? undefined
            : (replyToMessageId ?? activeReplyTarget?.id),
          replyQuote:
            reroutedToGroup || replyToMessageId ? undefined : (activeReplyQuote ?? undefined),
          fromPage: !reroutedToGroup && replyToMessageId ? true : undefined,
        } as const;
        // The routines run in the same server operation as the message: both or neither.
        const sent = plan.shouldRunRoutines
          ? (await rpc.threads.sendWithRoutines({ ...payload, routineIds: plan.routineIds })).send
          : await rpc.threads.send(payload);
        accepted = true;
        if (sent && botTarget && activeBotId.current === botTarget) {
          updateSnapshot((current) =>
            applyThreadSendReceipt(
              current,
              {
                botId: botTarget,
                runId: sent.runId,
                taskId: sent.taskId,
              },
              terminalRunReceipts.current,
            ),
          );
        }
        uploadedSendArtifacts.current.delete(clientNonce);
        // Copies made for another chat (a send rerouted to a group) are not needed.
        forgetEarlyUploads(attachments, sendTargetKey);
        dropDelayedSetup();
        clearReply();
        revokePendingAttachmentPreviews(attachments);
        // Keep files picked while this send was in flight.
        setPendingAttachments((current) =>
          current.filter((attachment) => !attachments.includes(attachment)),
        );
        // Refresh sidebar status even when a bot→group reroute navigates away below.
        void refreshBots().catch(() => undefined);
        if (reroutedToGroup && groupTarget) {
          navigate(`/app/g/${groupTarget}`);
          return true;
        }
        if (groupTarget && activeGroupId.current === groupTarget) setAttachmentNotice(null);
        if (botTarget && activeBotId.current === botTarget) setAttachmentNotice(null);
        if (groupTarget) void refreshGroupThreadRef.current(groupTarget).catch(() => undefined);
        else if (botTarget) void refreshThreadRef.current(botTarget).catch(() => undefined);
        return true;
      } catch (error) {
        const isConfirmation = isImageInputConfirmation(error);
        // Offer the file resend only for the unchanged draft this send carried.
        const confirmation = isConfirmation && draftEdits.current === editsAtSend;
        const failure = {
          message: errorText(error, t`Failed to send message`),
          imageConfirmation: confirmation,
        };
        if (
          reroutedToGroup &&
          groupTarget &&
          activeBotId.current === initialBotTarget &&
          activeGroupId.current === initialGroupTarget
        ) {
          setSendFailure(failure);
        } else if (groupTarget && activeGroupId.current === groupTarget) {
          setSendFailure(failure);
        } else if (botTarget && activeBotId.current === botTarget) {
          setSendFailure(failure);
        }
        return isConfirmation ? false : accepted;
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [
      activeReplyTarget?.id,
      activeReplyQuote,
      activeSnapshot?.messages,
      pageSession,
      clearReply,
      flushPendingBrowserNotifications,
      navigate,
      pendingAttachments,
      sending,
      t,
      forgetEarlyUploads,
      uploadAttachment,
    ],
  );
  const stopRun = useCallback(async () => {
    if (sending) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const botTarget = activeBotId.current;
      const groupTarget = activeGroupId.current;
      if (groupTarget) {
        setSendError(null);
        try {
          await rpc.threads.stop({ groupId: groupTarget });
        } catch (error) {
          if (activeGroupId.current === groupTarget) {
            setSendError(errorText(error, t`Failed to stop`));
          }
          return;
        }
        // Clear run UI ahead of the run.cancelled event so refresh races with in-flight gets.
        if (activeGroupId.current === groupTarget) {
          updateSnapshot((prev) =>
            prev && prev.groupId === groupTarget ? clearActiveThreadRuns(prev) : prev,
          );
        }
        await refreshGroupThreadRef.current(groupTarget).catch(() => undefined);
        return;
      }
      if (!botTarget) return;
      setSendError(null);
      try {
        await rpc.threads.stop({ botId: botTarget });
      } catch (error) {
        if (activeBotId.current === botTarget) {
          setSendError(errorText(error, t`Failed to stop`));
        }
        return;
      }
      // Clear local run/busy immediately rather than waiting for run.cancelled so a
      // superseded in-flight refresh (older cursor) cannot leave Stop enabled / Take control
      // blocked while the API is already idle.
      if (activeBotId.current === botTarget) {
        updateSnapshot((prev) =>
          !prev || (prev.botId !== botTarget && prev.botId) ? prev : clearActiveThreadRuns(prev),
        );
        const currentComputer = computerRef.current;
        if (currentComputer?.busyBotName) {
          commitComputer({ ...currentComputer, busyBotName: null });
        }
      }
      await refreshThreadRef.current(botTarget).catch(() => undefined);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [sending, t]);

  function dismissComposerError() {
    // The strip shows one message at a time, so only dismiss the run failure when it is the
    // one on screen; otherwise a live run would be silenced before it has even failed.
    const failedRunId = displayedRunErrorId;
    setSendError(null);
    if (failedRunId) {
      rememberSeenRunErrorId(failedRunId);
      setDismissedRunErrorIds((current) => new Set(current).add(failedRunId));
    }
  }

  return {
    activePendingAttachments,
    attachmentNotice,
    fileInputRef,
    onAttachmentPick,
    removeAttachment,
    discardThreadAttachments,
    replyTarget: activeReplyTarget,
    replyQuote: activeReplyQuote,
    setReplyTarget,
    setReplyQuote,
    clearReply,
    sending,
    sentCount,
    sendMessage,
    stopRun,
    answerMessage,
    reactToMessage,
    sendError,
    setSendError,
    imageConfirmation,
    clearImageConfirmation,
    dismissedRunErrorIds,
    displayedRunError,
    displayedRunErrorId,
    handleRunErrorPresented,
    dismissComposerError,
    startFocusPrompt,
  };
}
