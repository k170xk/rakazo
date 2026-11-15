/** Opens the routine-cap dialog from the routines panel, the editor, or a chat reply. */

export type RoutineLimitInfo = {
  activeRoutines: number;
  maxActiveRoutines: number;
  /** Where the limit was hit, for the dialog copy. */
  source?: "create" | "ai" | "enable";
};

const OPEN_EVENT = "rakazo:open-routine-limit";
const METERS_CHANGED_EVENT = "rakazo:routine-meters-changed";

export function openRoutineLimitDialog(info: RoutineLimitInfo) {
  window.dispatchEvent(new CustomEvent<RoutineLimitInfo>(OPEN_EVENT, { detail: info }));
}

export function onOpenRoutineLimitDialog(listener: (info: RoutineLimitInfo) => void) {
  const handle = (event: Event) => {
    const detail = (event as CustomEvent<RoutineLimitInfo>).detail;
    if (detail) listener(detail);
  };
  window.addEventListener(OPEN_EVENT, handle);
  return () => window.removeEventListener(OPEN_EVENT, handle);
}

/** Ask Shell to refresh myMeters after a create/enable/disable that changes the count. */
export function notifyRoutineMetersChanged() {
  window.dispatchEvent(new Event(METERS_CHANGED_EVENT));
}

export function onRoutineMetersChanged(listener: () => void) {
  window.addEventListener(METERS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(METERS_CHANGED_EVENT, listener);
}

/** Matches server refusals from activeRoutineCapRefusal / ROUTINE_ACTIVE_CAP. */
export function isActiveRoutineCapMessage(text: string): boolean {
  return (
    /routines switched on, the most your administrator allows/i.test(text) ||
    /has not allowed you to switch on routines/i.test(text) ||
    text.includes("ROUTINE_ACTIVE_CAP")
  );
}

/**
 * Pulls the switched-on and admin-cap counts out of an activeRoutineCapRefusal message.
 * Returns zeros when the admin has blocked routines entirely.
 */
export function parseRoutineCapCounts(text: string): Pick<
  RoutineLimitInfo,
  "activeRoutines" | "maxActiveRoutines"
> | null {
  if (/has not allowed you to switch on routines/i.test(text)) {
    return { activeRoutines: 0, maxActiveRoutines: 0 };
  }
  const match = text.match(
    /already have (\d+) routines switched on, the most your administrator allows \((\d+)\)/i,
  );
  if (!match) return null;
  return {
    activeRoutines: Number(match[1]),
    maxActiveRoutines: Number(match[2]),
  };
}
