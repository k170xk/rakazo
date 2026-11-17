import { createContext, useContext, useEffect, useRef } from "react";

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

/**
 * The open document stays on screen across a chat switch, so tell the chat now beside it.
 * A studio that has not finished opening yet publishes nothing.
 */
export function usePublishStudioToChat(publish: () => void): void {
  const publishRef = useRef(publish);
  publishRef.current = publish;
  const botId = useContext(DocumentBotContext);
  useEffect(() => {
    publishRef.current();
  }, [botId]);
}
