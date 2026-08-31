import { describe, expect, it } from "vitest";
import { ComputerScreenUnavailableError } from "./computer-screens.js";
import {
  allocateExtraDisplayCommand,
  extraDisplayActionCommand,
  extraDisplayLayout,
  parseAllocatedExtraDisplay,
  parseExtraDisplayViewPassword,
  parseReleasedExtraDisplay,
  chromeIsRunningCommand,
  ensureGoogleChromeCommand,
  lockDesktopBrowserCommand,
  openDesktopUrlCommand,
  trimDesktopBrowserWindowsCommand,
  primaryStreamResetCommand,
  raiseDesktopBrowserCommand,
  releaseExtraDisplayCommand,
  resetScreenAssignmentsCommand,
} from "./extra-displays.js";

describe("extra display ports", () => {
  it("keeps the vendor primary on index 0 and shifts extra screens by two", () => {
    expect(extraDisplayLayout(0, ":0")).toMatchObject({
      display: ":0",
      viewPort: 6080,
      controlPort: 6081,
      isPrimary: true,
    });
    expect(extraDisplayLayout(1, ":0")).toMatchObject({
      display: ":2",
      viewPort: 6082,
      controlPort: 6083,
      isPrimary: false,
    });
    expect(extraDisplayLayout(1, ":99")).toMatchObject({
      display: ":2",
      viewPort: 6082,
      controlPort: 6083,
    });
  });

  it("uses a locked sandbox registry for cross-process screen assignment", () => {
    const allocate = allocateExtraDisplayCommand("writer", "run-2:2");
    const release = releaseExtraDisplayCommand("writer", "run-2:2");
    expect(allocate).toContain("flock 9");
    expect(allocate).not.toContain("writer");
    expect(release).toContain("RAKAZO_SCREEN_RELEASE=stale");
    expect(release.indexOf("pkill -f")).toBeLessThan(release.indexOf('rm -f "$slot"'));
    expect(parseAllocatedExtraDisplay("RAKAZO_SCREEN_INDEX=3\n")).toBe(3);
    expect(parseReleasedExtraDisplay("RAKAZO_SCREEN_RELEASE=3\n")).toBe(3);
    expect(parseReleasedExtraDisplay("RAKAZO_SCREEN_RELEASE=stale\n")).toBeUndefined();
  });

  it("resets every extra-display slot without tearing down the primary stream", () => {
    const reset = resetScreenAssignmentsCommand();
    expect(reset).toContain("flock 9");
    expect(reset).toContain("RAKAZO_SCREEN_RESET=ok");
    expect(reset).toContain('rm -f "$slot"');
    expect(reset).toContain("Xvfb");
    expect(reset).not.toContain("pkill x11vnc");
    expect(reset).not.toContain("-rfbport 5900");
  });

  it("resets the vendor primary stream so a new password can be minted", () => {
    const reset = primaryStreamResetCommand();
    expect(reset).toContain("pkill x11vnc");
    expect(reset).toContain("pkill -f '(^|/)x11vnc .* -rfbport 5900'");
    expect(reset).toContain("[n]ovnc_proxy.*6080");
    expect(reset).toContain(">/dev/tcp/127.0.0.1/5900");
  });

  it("raises the browser after opening an http URL", () => {
    const raise = raiseDesktopBrowserCommand(":0");
    expect(raise).toContain("windowsize");
    expect(raise).toContain("google-chrome");
    expect(raise).toContain("fullscreen");
    expect(raise).toContain("xfce4-panel");
    expect(raise).not.toContain("xsetroot");
    expect(raise).not.toContain("killall -q xfdesktop");
    expect(raise).not.toContain("xfce4-panel -q");
    expect(raise).toContain("Failed to quit the panel");
    expect(raise).not.toContain("firefox");
    const open = extraDisplayActionCommand(extraDisplayLayout(0, ":0"), {
      kind: "open",
      path: "https://example.com",
    });
    expect(open).toContain("xdg-open");
    expect(open).toContain("windowsize");
  });

  it("installs Chrome and locks the desktop to a fullscreen window", () => {
    expect(ensureGoogleChromeCommand()).toContain("google-chrome-stable_current_amd64.deb");
    const lock = lockDesktopBrowserCommand(":0");
    expect(lock).toContain("--kiosk");
    expect(lock).toContain("nohup");
    expect(lock).toContain("xfce4-panel");
    expect(lock).not.toContain("xfce4-panel -q");
    expect(lock).toContain("Failed to quit the panel");
    expect(lock).toContain("about:blank");
    expect(lock).not.toContain("pkill -f '[g]oogle-chrome'");
    expect(lock).not.toContain("firefox");
    const open = openDesktopUrlCommand("https://example.com/docs", ":0");
    expect(open).toContain("https://example.com/docs");
    expect(open).not.toContain("pkill -f '[g]oogle-chrome'");
    expect(lock).toContain("/opt/google/chrome/chrome");
    expect(lock).toContain("windowclose");
    expect(chromeIsRunningCommand()).toContain("/opt/google/chrome/chrome");
    expect(trimDesktopBrowserWindowsCommand(":0")).toContain("windowclose");
  });

  it("requires an authenticated password for view-only VNC", () => {
    expect(parseExtraDisplayViewPassword("RAKAZO_SCREEN_PASSWORD=sandbox_secret-1\n")).toBe(
      "sandbox_secret-1",
    );
    expect(() => parseExtraDisplayViewPassword("no password\n")).toThrow(
      ComputerScreenUnavailableError,
    );
  });
});
