import type { StudioAttachment } from "../studio/studio-send";
import type { SaveQueueState } from "./word/save-queue";

export type DocumentStudioLatest = {
  artifactId: string;
  version: number;
  versions: readonly { artifactId: string }[];
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Saves every hand edit in the open Word, PowerPoint or Excel studio, refreshes the studio note
 * to that newest version, and names the file the chat must attach. Used on mobile and desktop so
 * the assistant never edits an older copy the person has already changed.
 */
export async function prepareDocumentStudioSend(input: {
  flush: () => Promise<SaveQueueState>;
  getLatest: () => DocumentStudioLatest | null;
  publishNote: () => void;
  owner: () => Promise<{ botId: string | null; groupId: string | null }>;
  /** When a newer server version wins, reload it before reading `getLatest`. */
  resolveConflict?: () => Promise<void>;
  /** Cap how long we keep flushing (large files / slow mobile). */
  budgetMs?: number;
}): Promise<StudioAttachment | null> {
  const budgetMs = input.budgetMs ?? 60_000;
  const deadline = Date.now() + budgetMs;
  let state = await input.flush();

  while (Date.now() < deadline) {
    if (state.status === "conflict" && input.resolveConflict) {
      await input.resolveConflict();
      state = await input.flush();
      continue;
    }
    if (!state.dirty) break;
    if (state.status === "refused" || state.status === "invalid") break;
    if (state.status === "failed" || state.status === "waiting" || state.status === "saving") {
      await wait(state.status === "failed" ? 400 : 50);
      state = await input.flush();
      continue;
    }
    break;
  }

  const now = input.getLatest();
  if (!now) return null;
  // Note must name the same artifactId we attach, after any save/conflict reload.
  input.publishNote();
  const { botId, groupId } = await input.owner();
  return {
    artifactId: now.artifactId,
    familyArtifactIds: now.versions.map((row) => row.artifactId),
    botId,
    groupId,
  };
}
