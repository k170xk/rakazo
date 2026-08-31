import { describe, expect, it } from "vitest";
import {
  desktopScreenSize,
  embeddableScreenUrl,
  pinnedScreenLayout,
  sameComputerScreen,
  screenFrameStyle,
  usableScreenRect,
} from "./computer-screen.js";

describe("embeddableScreenUrl", () => {
  it("keeps a same-origin proxied screen", () => {
    expect(
      embeddableScreenUrl(
        "https://computer.ocsc.me/novnc/abc/6080/view/1.sig/vnc.html",
        "https://computer.ocsc.me/app/bot",
      ),
    ).toBe("https://computer.ocsc.me/novnc/abc/6080/view/1.sig/vnc.html");
  });

  it("keeps a public provider stream", () => {
    expect(
      embeddableScreenUrl(
        "https://6080-box.e2b.app/vnc.html?autoconnect=true",
        "https://computer.ocsc.me/app/bot",
      ),
    ).toBe("https://6080-box.e2b.app/vnc.html?autoconnect=true");
  });

  it("drops leftover loopback URLs the browser cannot reach from the iframe host", () => {
    expect(
      embeddableScreenUrl("https://127.0.0.1:6080/vnc.html", "https://computer.ocsc.me/app/bot"),
    ).toBeNull();
    expect(
      embeddableScreenUrl("http://127.0.0.1:49152/embed.html", "https://computer.ocsc.me/app/bot"),
    ).toBeNull();
  });
});

describe("sameComputerScreen", () => {
  it("treats a rotated proxy token as the same viewer", () => {
    expect(
      sameComputerScreen(
        "https://computer.ocsc.me/novnc/remote/view/1.oldtoken/vnc.html?autoconnect=true&view_only=true",
        "https://computer.ocsc.me/novnc/remote/view/9.newtoken/vnc.html?autoconnect=true&view_only=true",
        "https://computer.ocsc.me/app/bot",
      ),
    ).toBe(true);
  });

  it("remounts when view/control or view_only changes", () => {
    expect(
      sameComputerScreen(
        "https://computer.ocsc.me/novnc/remote/view/1.old/vnc.html?view_only=true",
        "https://computer.ocsc.me/novnc/remote/control/1.old/vnc.html?view_only=false",
        "https://computer.ocsc.me/app/bot",
      ),
    ).toBe(false);
    expect(
      sameComputerScreen(
        "https://computer.ocsc.me/novnc/remote/view/1.old/vnc.html?view_only=true",
        "https://computer.ocsc.me/novnc/remote/view/1.old/vnc.html?view_only=false",
        "https://computer.ocsc.me/app/bot",
      ),
    ).toBe(false);
  });
});

describe("screenFrameStyle", () => {
  it("pins a live viewer without remounting", () => {
    expect(screenFrameStyle({ top: 53, left: 1113, width: 295, height: 184 }, 45)).toEqual({
      position: "fixed",
      top: 53,
      left: 1113,
      width: 295,
      height: 184,
      zIndex: 45,
    });
    expect(screenFrameStyle({ top: 0, left: 0, width: 0, height: 200 }, 25)).toBeNull();
    expect(screenFrameStyle(null, 25)).toBeNull();
    expect(usableScreenRect({ top: 0, left: 0, width: 0, height: 200 })).toBeNull();
  });
});

describe("pinnedScreenLayout", () => {
  it("keeps the iframe at desktop size and scales it into the thumbnail", () => {
    const desktop = desktopScreenSize({ width: 1440, height: 957 });
    expect(desktop).toEqual({ width: 1440, height: 900 });
    expect(
      pinnedScreenLayout(desktop, { top: 53, left: 1113, width: 295, height: 184 }, 45),
    ).toEqual({
      clip: {
        position: "fixed",
        top: 53,
        left: 1113,
        width: 295,
        height: 184,
        overflow: "hidden",
        zIndex: 45,
      },
      iframe: {
        display: "block",
        width: 1440,
        height: 900,
        transform: `scale(${295 / 1440}, ${184 / 900})`,
        transformOrigin: "top left",
      },
    });
  });

  it("does not scale when the host is already the desktop", () => {
    expect(
      pinnedScreenLayout(
        { width: 1440, height: 900 },
        { top: 57, left: 0, width: 1440, height: 900 },
        25,
      )?.iframe.transform,
    ).toBe("none");
  });

  it("keeps the last host when a measure is empty", () => {
    expect(
      pinnedScreenLayout({ width: 1440, height: 900 }, { top: 0, left: 0, width: 0, height: 0 }, 25),
    ).toBeNull();
  });
});
