import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const shell = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "Shell.tsx"),
  "utf8",
);

describe("computer chrome", () => {
  it("keeps Close in the full-window tree and never covers the app with a boot veil", () => {
    expect(shell).not.toContain("Booting up {active?.name}");
    expect(shell).not.toContain("setBooting(");
    expect(shell).toContain("aria-label={t`Close computer`}");
    expect(shell).toContain("Waking desktop");
    expect(shell).toContain("ensureComputer");
    expect(shell).toContain("recoveringScreen");
  });

  it("opens the full window as watch-only and takes control on double-click", () => {
    expect(shell).toContain("async function openComputer()");
    expect(shell).toContain("async function takeComputerControl()");
    expect(shell).toContain("onDoubleClick={() => void takeComputerControl()}");
    expect(shell).toContain("Watching — double-click to take control");
    expect(shell).toContain("computerReleaseClosesViewer(reason)");
    expect(shell).not.toContain("takeControl: needsTakeover && !blocked");
  });

  it("keeps one live screen iframe when opening full window", () => {
    expect(shell).toContain("previewScreenRef");
    expect(shell).toContain("overlayScreenRef");
    expect(shell).toContain("pinnedScreenLayout");
    expect(shell).toContain("desktopScreenSize");
    expect(shell).toContain("showPinnedScreen");
    expect(shell).toContain("if (screenUrlRef.current) return;");
    expect(shell.match(/<iframe/g)?.length).toBe(1);
  });

  it("lets the computer panel be dragged wider on desktop", () => {
    expect(shell).toContain('data-testid="side-panel-resize"');
    expect(shell).toContain("aria-label={t`Resize panel`}");
    expect(shell).toContain("md:w-[var(--rk-side-panel-width)]");
    expect(shell).toContain("readSidePanelWidth");
    expect(shell).not.toContain(
      'className="rk-scroll h-full w-full overflow-y-auto px-5 py-[17px] md:w-[384px]"',
    );
  });

  it("lets the same-origin noVNC viewer keep its origin so the stream can connect", () => {
    expect(shell).toContain(
      'pathname.startsWith("/novnc/")\n      ? "allow-scripts allow-same-origin allow-pointer-lock allow-forms"',
    );
    expect(shell).not.toContain('className="h-full w-full border-0 bg-black"');
    expect(shell).not.toContain("key={`${embeddedScreenUrl}:${screenEpoch}`}");
    expect(shell).toContain("sameComputerScreen");
  });

  it("shows who holds the desktop and who can use a Shared one", () => {
    expect(shell).toContain("Using desktop");
    expect(shell).toContain('return "Waiting"');
    expect(shell).toContain("is waiting for");
    expect(shell).toContain("desktop-access");
    expect(shell).toContain("This bot only");
    expect(shell).not.toContain("Team Computer");
  });

  it("renders bot-to-bot deliveries as To/From cards with their text", () => {
    expect(shell).toContain("bot_message_sent");
    expect(shell).toContain("t`Messaged ${peer}`");
    expect(shell).toContain("t`Message from ${peer}`");
    expect(shell).toContain("<ChatMarkdown>{block.text}</ChatMarkdown>");
    expect(shell).toContain("isMessageBotLabel");
  });
});
