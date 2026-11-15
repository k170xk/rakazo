import { useColumnResize } from "../studio/column-resize";

/** Data, Code, History, and Settings share this column. It opens at the width it had before. */
export const APP_PANEL_DEFAULT_WIDTH = 560;
export const APP_PANEL_MIN_WIDTH = 320;
export const APP_PANEL_MAX_WIDTH = 1040;
const MIN_CANVAS_WIDTH = 360;

export function useAppPanelResize(reserved = 0) {
  return useColumnResize({
    storageKey: "rakazo:app-studio-panel-width",
    cssVariable: "--app-panel-width",
    defaultWidth: APP_PANEL_DEFAULT_WIDTH,
    minWidth: APP_PANEL_MIN_WIDTH,
    maxWidth: APP_PANEL_MAX_WIDTH,
    minRemainder: MIN_CANVAS_WIDTH,
    edge: "start",
    reserved,
  });
}
