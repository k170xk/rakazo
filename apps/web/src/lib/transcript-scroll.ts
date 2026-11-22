export const TRANSCRIPT_AUTOLOAD_TOP_PX = 160;

export function transcriptIsNearEnd(
  element: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 80;
}

export function transcriptCanSnapAfterFrame(
  element: Pick<HTMLElement, "scrollTop"> | null,
  queuedElement: Pick<HTMLElement, "scrollTop">,
  queuedScrollTop: number,
): boolean {
  return element === queuedElement && queuedElement.scrollTop === queuedScrollTop;
}

export function transcriptMovedDown(previousScrollTop: number | null, scrollTop: number): boolean {
  return previousScrollTop !== null && scrollTop >= previousScrollTop;
}

/**
 * Triggers automatic older-message loading only when the transcript overflows,
 * the reader actively scrolled upward (not downward or on initial mount), and
 * the viewport is within `TRANSCRIPT_AUTOLOAD_TOP_PX` of the top edge.
 */
export function transcriptShouldAutoloadOlder(
  element: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
  previousScrollTop: number | null,
): boolean {
  if (element.scrollHeight <= element.clientHeight) return false;
  if (element.scrollTop > TRANSCRIPT_AUTOLOAD_TOP_PX) return false;
  if (previousScrollTop === null) return false;
  return element.scrollTop < previousScrollTop;
}
