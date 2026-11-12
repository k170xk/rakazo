import { APP_WRITE_OPS } from "@rakazo/app-kit/protocol";

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
