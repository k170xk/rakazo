import { whiteboardSelectionNote } from "./whiteboard.js";

const OPEN = "‹studio›";
const CLOSE = "‹/studio›";

/**
 * What the model reads about the studio in front of the person. The chat hides this block;
 * the page chip stays the visible tag.
 */
export function openStudioNote(input: {
  kind: "whiteboard" | "app" | "todo";
  title?: string;
  id?: string;
  blank?: boolean;
  selection?: Parameters<typeof whiteboardSelectionNote>[0];
}): string {
  const title = (input.title ?? "").replace(/\s+/g, " ").trim();
  const id = (input.id ?? "").trim();
  const named = title && id ? ` with "${title}" open` : "";
  let line: string;
  if (input.kind === "whiteboard") {
    const which = id ? `${named} (whiteboardId ${id})` : named;
    line = input.blank
      ? `The person is in the Whiteboard studio${which}. The canvas is blank. When they ask for something to be drawn, draw it on this whiteboard. Do not create a new one unless they ask.`
      : `The person is in the Whiteboard studio${which}. This is the whiteboard they are looking at. When they ask for a change, make it on this whiteboard. Do not create a new one unless they ask.`;
  } else if (input.kind === "todo") {
    const which = id ? `${named} (todoListId ${id})` : named;
    line = input.blank
      ? `The person is in the To-do studio${which}. The board is empty. When they ask to add tasks, including from a document, a spreadsheet or their email, add them to this list with todo_add. Pass list_id ${id || "personal"}. Do not start another list unless they ask.`
      : `The person is in the To-do studio${which}. This is the to-do list they are looking at. When they ask to add, move, update or remove tasks, do it on this list with todo_list, todo_add, todo_update and todo_archive. Pass list_id ${id || "personal"}. Do not start another list unless they ask.`;
  } else if (input.blank || !id) {
    line =
      "The person is in the App Studio. No app is open and the canvas is blank. When they ask for an app, build it here.";
  } else {
    const which = id ? `${named} (appId ${id})` : named;
    line = `The person is in the App Studio${which}. This is the app they are looking at. When they ask for a change, make it on this app. Do not build a new one unless they ask.`;
  }
  const selection = input.selection?.length ? whiteboardSelectionNote(input.selection) : "";
  const body = selection ? `${line}\n${selection}` : line;
  return `${OPEN}\n${body}\n${CLOSE}`;
}

/** The studio block, removed wherever a person reads the message. */
export function stripStudioNote(text: string): string {
  return text.replace(/\n*‹studio›[\s\S]*?‹\/studio›/g, "").replace(/\n{3,}/g, "\n\n");
}
