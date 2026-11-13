import { APP_COMMENT_OPS, APP_WRITE_OPS } from "@rakazo/app-kit/protocol";

/** How long after a click in a colleague's view the app may still remove rows or save unprompted. */
export const CLICK_WINDOW_MS = 15_000;

/**
 * Whether an app may make this change for the person looking: "ok", "skip" (a settings save that
 * quietly does not happen) or the reason to refuse. A colleague's app saves only while they are
 * using it and removes rows only just after a click, so opening someone's app changes nothing.
 */
export function appWriteDecision(input: {
  op: string;
  canEdit: boolean;
  colleague: boolean;
  focused: boolean;
  msSinceClick: number;
}): "ok" | "skip" | string {
  // Anyone signed in may comment (the server checks that), but a colleague's copy still comments
  // only while they are using it, so opening an app never posts in their name.
  if (APP_COMMENT_OPS.has(input.op as never)) {
    return !input.colleague || input.focused || input.msSinceClick <= CLICK_WINDOW_MS
      ? "ok"
      : "Click in the app first to comment.";
  }
  if (!APP_WRITE_OPS.has(input.op as never)) return "ok";
  if (!input.canEdit) {
    return input.op === "state.set" ? "skip" : "You can view this app but not change its data.";
  }
  if (!input.colleague) return "ok";
  const recentClick = input.msSinceClick <= CLICK_WINDOW_MS;
  const allowed = input.op === "rows.remove" ? recentClick : input.focused || recentClick;
  if (allowed) return "ok";
  return input.op === "state.set" ? "skip" : "Click in the app first to change its data.";
}
