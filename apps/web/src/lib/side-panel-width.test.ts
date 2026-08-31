import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampSidePanelWidth,
  DEFAULT_SIDE_PANEL_WIDTH,
  maxSidePanelWidth,
  MIN_SIDE_PANEL_WIDTH,
  readSidePanelWidth,
  SIDE_PANEL_WIDTH_KEY,
  sidePanelWidthFromClientX,
  writeSidePanelWidth,
} from "./side-panel-width.js";

describe("side panel width", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the default 384px inside a typical desktop viewport", () => {
    expect(clampSidePanelWidth(384, 1440)).toBe(DEFAULT_SIDE_PANEL_WIDTH);
    expect(maxSidePanelWidth(1440)).toBe(764);
  });

  it("will not shrink below 320px or grow into the chat column", () => {
    expect(clampSidePanelWidth(200, 1440)).toBe(MIN_SIDE_PANEL_WIDTH);
    expect(clampSidePanelWidth(2000, 1440)).toBe(764);
    expect(clampSidePanelWidth(Number.NaN, 1440)).toBe(DEFAULT_SIDE_PANEL_WIDTH);
  });

  it("measures from the end edge so RTL drag grows the same way", () => {
    expect(sidePanelWidthFromClientX(1000, 1440, false)).toBe(440);
    expect(sidePanelWidthFromClientX(440, 1440, true)).toBe(440);
  });

  it("reads a stored width and ignores junk", () => {
    vi.stubGlobal("window", {
      innerWidth: 1440,
      localStorage: {
        getItem: (key: string) => (key === SIDE_PANEL_WIDTH_KEY ? "520" : null),
        setItem: () => undefined,
      },
    });
    expect(readSidePanelWidth()).toBe(520);

    vi.stubGlobal("window", {
      innerWidth: 1440,
      localStorage: {
        getItem: () => "wide",
        setItem: () => undefined,
      },
    });
    expect(readSidePanelWidth()).toBe(DEFAULT_SIDE_PANEL_WIDTH);
  });

  it("writes the width and swallows private-mode storage errors", () => {
    const setItem = vi.fn();
    vi.stubGlobal("window", {
      localStorage: { getItem: () => null, setItem },
    });
    writeSidePanelWidth(480);
    expect(setItem).toHaveBeenCalledWith(SIDE_PANEL_WIDTH_KEY, "480");

    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(() => writeSidePanelWidth(480)).not.toThrow();
  });
});
