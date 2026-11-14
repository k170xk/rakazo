import { createContext, useContext } from "react";

/**
 * The agent of the chat beside the studio. New and uploaded documents join it, so the chat's
 * assistant edits them as its own files; undefined in a group chat or with no chat open.
 */
export const DocumentBotContext = createContext<string | undefined>(undefined);

/** The `botId` to send with a new document, as `documents.create` and the upload take it. */
export function useDocumentBotId(): { botId?: string } {
  const botId = useContext(DocumentBotContext);
  return botId ? { botId } : {};
}
