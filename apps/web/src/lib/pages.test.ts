import { openStudioNote } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import { createPageSession } from "./pages";

vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: String.raw }) }));

const card = {
  id: "m1",
  blocks: [{ kind: "page" as const, pageId: "p1", version: 1, title: "Plan" }],
};

describe("page session", () => {
  it("replies to the open page's card unless the user picked a reply themselves", () => {
    const session = createPageSession();
    session.dock.set({ page: { id: "p1", title: "Plan" } });
    expect(session.send("bigger", [card])).toEqual({ text: "bigger", replyToMessageId: "m1" });
    expect(session.send("bigger", [card], "m0")).toEqual({ text: "bigger" });
    session.dock.set({ page: null });
    expect(session.send("bigger", [card])).toEqual({ text: "bigger" });
  });

  it("opens Share only on the page it was asked with, once", () => {
    const session = createPageSession();
    session.askShare("A");
    expect(session.takeShare("B")).toBe(false);
    expect(session.takeShare("A")).toBe(false);
    session.askShare("A");
    expect(session.takeShare("A")).toBe(true);
    // Back to the same page in history does not ask again.
    expect(session.takeShare("A")).toBe(false);
  });

  it("tells the open app when the chat moves beside it and while the agent works", () => {
    const session = createPageSession();
    const listener = vi.fn();
    session.dock.subscribe(listener);
    const slot = {} as HTMLElement;
    session.dock.set({ chat: slot });
    session.dock.set({ chat: slot });
    expect(listener).toHaveBeenCalledTimes(1);
    session.dock.set({ running: true });
    session.dock.set({ running: true });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(session.dock.get()).toMatchObject({ chat: slot, running: true });
    session.dock.set({ chat: null, running: false });
    expect(listener).toHaveBeenCalledTimes(3);
    const card = { id: "a", who: "action" as const, text: "Saving the board", live: true };
    session.dock.set({ activity: [card] });
    session.dock.set({ activity: [{ ...card }] });
    expect(listener).toHaveBeenCalledTimes(4);
    session.dock.set({ activity: [{ ...card, text: "Saved the board" }] });
    expect(listener).toHaveBeenCalledTimes(5);
    expect(session.dock.get().activity?.[0]?.text).toBe("Saved the board");
  });
});

describe("page replies", () => {
  it("hands a page's reply to the composer collapsed, only while a page is open", () => {
    const session = createPageSession();
    const received: string[] = [];
    const stop = session.subscribeReply((text) => received.push(text));
    session.offerReply("closed page");
    session.dock.set({ page: { id: "p1", title: "Plan" } });
    session.offerReply("  Watch   the\n shirt ");
    session.offerReply("   ");
    session.offerReply("x".repeat(301));
    session.offerReply({ text: "object" });
    session.offerReply("x".repeat(300));
    stop();
    session.offerReply("after unsubscribe");
    expect(received).toEqual(["Watch the shirt", "x".repeat(300)]);
  });

  it("sends a new app as its own message, then keeps later sends on the open page", () => {
    const session = createPageSession();
    session.dock.set({ page: { id: "p1", title: "Plan" } });
    const sent: string[] = [];
    session.subscribeSubmit((text) => {
      sent.push(text);
      expect(session.send(text, [card])).toEqual({ text });
    });
    session.submit("  Build me an app: a diary  ");
    expect(sent).toEqual(["Build me an app: a diary"]);
    expect(session.send("tweak", [card])).toEqual({ text: "tweak", replyToMessageId: "m1" });
  });

  it("tells the model which studio is open, including a blank app canvas", () => {
    const session = createPageSession();
    const note = openStudioNote({ kind: "app", title: "Site diary", id: "p1" });
    session.dock.set({ page: { id: "p1", title: "Site diary", note } });
    const sent = session.send("add a map", [card]);
    expect(sent.replyToMessageId).toBe("m1");
    expect(sent.text).toContain("App Studio");
    expect(sent.text).toContain("appId p1");
    expect(sent.text).toContain("add a map");

    session.dock.set({ page: { note: openStudioNote({ kind: "app", blank: true }) } });
    const sentBlank: string[] = [];
    session.subscribeSubmit((text) => {
      sentBlank.push(session.send(text, []).text);
    });
    session.submit("Build me an app: a diary");
    expect(sentBlank[0]).toContain("the canvas is blank");
    expect(sentBlank[0]).toContain("Build me an app: a diary");
  });

  it("leaves the selection out of one message when it is dropped, then sends it again", () => {
    const session = createPageSession();
    const chip = {
      kind: "word" as const,
      title: "Brief",
      label: "Page 3 · Table",
      bareLabel: "Page 3",
      hasSelection: true,
    };
    session.dock.set({
      page: {
        id: "doc:r1",
        title: "Brief",
        note: "WITH-SELECTION",
        bareNote: "WITHOUT-SELECTION",
        chip,
      },
    });
    session.dock.dropSelection();
    expect(session.dock.selectionDropped()).toBe(true);
    expect(session.send("shorter", []).text).toContain("WITHOUT-SELECTION");
    expect(session.dock.selectionDropped()).toBe(false);
    expect(session.send("shorter", []).text).toContain("WITH-SELECTION");
  });
});
