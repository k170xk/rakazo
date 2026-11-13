import { APP_COMMENT_OPS, APP_WORKSPACE_WRITE_OPS, APP_WRITE_OPS } from "@rakazo/app-kit/protocol";

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
  // Who is in a workspace, and which one is open, change only from a person's own clicks; the
  // server decides whether they may.
  if (APP_WORKSPACE_WRITE_OPS.has(input.op as never)) {
    return input.focused || input.msSinceClick <= CLICK_WINDOW_MS
      ? "ok"
      : "Click in the app first to change workspaces.";
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

/** How long after a tap an app may first ask where the device is. */
export const LOCATION_TAP_MS = 60_000;

/**
 * Whether an app may read the device's position: the first time only just after a tap in it, then
 * (once the person has shared it) while it stays in front, so a walk can be traced. An app open in
 * the background never learns where someone is.
 */
export function appLocationDecision(input: {
  focused: boolean;
  msSinceClick: number;
  shared: boolean;
}): "ok" | string {
  if (!input.focused) return "Open the app to share your location.";
  if (input.shared || input.msSinceClick <= LOCATION_TAP_MS) return "ok";
  return "Tap a button in the app to share your location.";
}
