import { describe, expect, it } from "vitest";
import {
  botHoldsDesktop,
  computerModeKind,
  desktopAccessNames,
  isWorkingRunStatus,
  rosterRunTone,
} from "./computer-mode";

describe("computerModeKind", () => {
  it("maps team to shared and dedicated to own", () => {
    expect(computerModeKind("team")).toBe("shared");
    expect(computerModeKind("dedicated")).toBe("own");
  });
});

describe("roster and desktop occupancy", () => {
  it("humanizes run status and treats waits as work", () => {
    expect(rosterRunTone("queued")).toBe("queued");
    expect(rosterRunTone("leased")).toBe("starting");
    expect(rosterRunTone("running")).toBe("working");
    expect(rosterRunTone("waiting_input")).toBe("needs_reply");
    expect(rosterRunTone("waiting_takeover")).toBe("needs_desktop");
    expect(rosterRunTone("idle")).toBe("idle");
    expect(isWorkingRunStatus("waiting_takeover")).toBe(true);
    expect(isWorkingRunStatus("idle")).toBe(false);
  });

  it("lists every Shared bot on a shared desktop and only the owner on Own", () => {
    const bots = [
      { name: "Writer", computerMode: "team" as const },
      { name: "Analyst", computerMode: "team" as const },
      { name: "Private", computerMode: "dedicated" as const },
    ];
    expect(desktopAccessNames(bots, bots[0]!)).toEqual(["Writer", "Analyst"]);
    expect(desktopAccessNames(bots, bots[2]!)).toEqual(["Private"]);
  });

  it("matches the occupant by id when present, otherwise by name", () => {
    expect(
      botHoldsDesktop({
        botId: "a",
        botName: "Writer",
        busyBotId: "a",
        busyBotName: "Writer",
      }),
    ).toBe(true);
    expect(
      botHoldsDesktop({
        botId: "b",
        botName: "Analyst",
        busyBotId: "a",
        busyBotName: "Writer",
      }),
    ).toBe(false);
    expect(
      botHoldsDesktop({
        botId: "b",
        botName: "Writer",
        busyBotId: null,
        busyBotName: "Writer",
      }),
    ).toBe(true);
  });
});
