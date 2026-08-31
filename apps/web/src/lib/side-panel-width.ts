/** Persisted desktop width of the computer / settings side panel. */
export const SIDE_PANEL_WIDTH_KEY = "rakazo.side-panel-width";
export const DEFAULT_SIDE_PANEL_WIDTH = 384;
export const MIN_SIDE_PANEL_WIDTH = 320;
export const NAV_SIDEBAR_WIDTH = 316;
export const MIN_MAIN_COLUMN_WIDTH = 360;
export const SIDE_PANEL_WIDTH_STEP = 24;

export function maxSidePanelWidth(viewportWidth: number): number {
  return Math.max(
    MIN_SIDE_PANEL_WIDTH,
    viewportWidth - NAV_SIDEBAR_WIDTH - MIN_MAIN_COLUMN_WIDTH,
  );
}

export function clampSidePanelWidth(width: number, viewportWidth: number): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDE_PANEL_WIDTH;
  const max = maxSidePanelWidth(viewportWidth);
  return Math.round(Math.min(max, Math.max(MIN_SIDE_PANEL_WIDTH, width)));
}

export function sidePanelWidthFromClientX(
  clientX: number,
  viewportWidth: number,
  rtl: boolean,
): number {
  return rtl ? clientX : viewportWidth - clientX;
}

export function readSidePanelWidth(): number {
  try {
    const raw = window.localStorage.getItem(SIDE_PANEL_WIDTH_KEY);
    if (raw == null) return DEFAULT_SIDE_PANEL_WIDTH;
    return clampSidePanelWidth(Number(raw), window.innerWidth);
  } catch {
    return DEFAULT_SIDE_PANEL_WIDTH;
  }
}

export function writeSidePanelWidth(width: number): void {
  try {
    window.localStorage.setItem(SIDE_PANEL_WIDTH_KEY, String(width));
  } catch {
    // Private mode / blocked storage — keep in-memory only.
  }
}
