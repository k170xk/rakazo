/** The file an open document studio sends along with the chat's next message. */
export type StudioAttachment = {
  /** The newest version, after any unsaved edit has been saved. */
  artifactId: string;
  /** Every version id the studio knows in this file's family. */
  familyArtifactIds: readonly string[];
  /** The agent and group the family belongs to; a message can only carry that chat's files. */
  botId: string | null;
  groupId: string | null;
};

/** Saves the studio's edits and names the file to attach; null when nothing is open. */
export type StudioBeforeSend = () => Promise<StudioAttachment | null>;

const hooks = new WeakMap<object, StudioBeforeSend>();

/** Registers what to do before the chat on `session` sends; returns the unregister. */
export function setStudioBeforeSend(session: object, hook: StudioBeforeSend): () => void {
  hooks.set(session, hook);
  return () => {
    if (hooks.get(session) === hook) hooks.delete(session);
  };
}

/** The picture the person has selected in a document studio, to attach to the next message. */
export type StudioSelectionImage = () => Promise<File | null>;

const images = new WeakMap<object, StudioSelectionImage>();

/** Registers how to read the selected picture on `session`; returns the unregister. */
export function setStudioSelectionImage(session: object, read: StudioSelectionImage): () => void {
  images.set(session, read);
  return () => {
    if (images.get(session) === read) images.delete(session);
  };
}

/** The selected picture, or null; a studio that fails or takes too long never blocks sending. */
export async function studioSelectionImage(
  session: object | null,
  timeoutMs = STUDIO_BEFORE_SEND_TIMEOUT_MS,
): Promise<File | null> {
  const read = session ? images.get(session) : undefined;
  if (!read) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** True while a studio on `session` wants to save before the chat sends. */
export function hasStudioBeforeSend(session: object | null): boolean {
  return session ? hooks.has(session) : false;
}

type SendTarget = { botId?: string | null; groupId?: string | null };
type TranscriptMessage = { blocks: readonly { kind: string; artifactId?: unknown }[] };

/**
 * The ids to add to the message: always the newest version when the open studio belongs to this
 * chat. Re-attaching after every send keeps fetch_file on the version the person can see, even
 * when an older family member is already in the transcript.
 */
export function studioAttachmentIds(
  attachment: StudioAttachment | null,
  target: SendTarget,
  _messages: readonly TranscriptMessage[] = [],
): string[] {
  if (!attachment) return [];
  const sameChat = target.groupId
    ? attachment.groupId === target.groupId
    : Boolean(target.botId) && attachment.groupId === null && attachment.botId === target.botId;
  if (!sameChat) return [];
  return [attachment.artifactId];
}

/**
 * How long the composer waits for the studio to save before sending without the file.
 * Large PowerPoint / Word / Excel files on mobile often need well past 25s to serialize + upload.
 */
export const STUDIO_BEFORE_SEND_TIMEOUT_MS = 60_000;

/** Extra wait after the soft timeout so a large save that finishes late still attaches. */
export const STUDIO_BEFORE_SEND_LATE_MS = 30_000;

/**
 * For the composer, before it builds the message: waits for the open studio to save, then
 * returns the file ids to attach. A soft timeout still waits for the hook if it finishes in the
 * same turn (so a slow mobile save is not dropped for a stale note); only a hard failure skips.
 */
export async function runStudioBeforeSend(
  session: object | null,
  target: SendTarget,
  messages: readonly TranscriptMessage[],
  timeoutMs = STUDIO_BEFORE_SEND_TIMEOUT_MS,
  lateMs = STUDIO_BEFORE_SEND_LATE_MS,
): Promise<string[]> {
  const hook = session ? hooks.get(session) : undefined;
  if (!hook) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const pending = hook();
    const attachment = await Promise.race([
      pending,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          resolve(null);
        }, timeoutMs);
      }),
    ]);
    if (attachment) return studioAttachmentIds(attachment, target, messages);
    // Soft timeout: still take the result if the save finishes moments later, so the note and
    // attachment stay on the version the person can see.
    if (timedOut) {
      const late = await Promise.race([
        pending.catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), lateMs)),
      ]);
      if (late) return studioAttachmentIds(late, target, messages);
    }
    return [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
