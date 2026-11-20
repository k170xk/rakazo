import { describe, expect, it } from "vitest";
import {
  documentOverlaySearch,
  readShellOverlay,
  searchString,
  shellOverlaySearch,
  withDocumentOverlay,
  withShellOverlay,
} from "./shell-overlay";

const read = (search: string) => readShellOverlay(new URLSearchParams(search));

describe("readShellOverlay", () => {
  it("opens nothing without overlay params", () => {
    expect(read("")).toBeNull();
    expect(read("?m=msg_1&routine=r_1")).toBeNull();
  });

  it("opens a settings section, falling back to Work Space for bare, general or unknown values", () => {
    expect(read("?settings=voice")).toEqual({ kind: "settings", section: "voice", spaceId: null });
    expect(read("?settings=space&space=sp_1")).toEqual({
      kind: "settings",
      section: "space",
      spaceId: "sp_1",
    });
    expect(read("?settings")).toEqual({
      kind: "settings",
      section: "organization",
      spaceId: null,
    });
    expect(read("?settings=general")).toEqual({
      kind: "settings",
      section: "organization",
      spaceId: null,
    });
    expect(read("?settings=nope")).toEqual({
      kind: "settings",
      section: "organization",
      spaceId: null,
    });
  });

  it("binds settings to a space only alongside settings", () => {
    expect(read("?settings=models&space=sp_1")).toEqual({
      kind: "settings",
      section: "models",
      spaceId: "sp_1",
    });
    expect(read("?space=sp_1")).toBeNull();
  });

  it("reads flag overlays with or without a value", () => {
    expect(read("?integrations")).toEqual({ kind: "integrations" });
    expect(read("?whiteboards")).toEqual({ kind: "whiteboards" });
    expect(read("?apps")).toEqual({ kind: "apps" });
    expect(read("?mcp=")).toEqual({ kind: "mcp" });
    expect(read("?mcp=srv_1")).toEqual({ kind: "mcp", serverId: "srv_1" });
  });

  it("opens Messaging settings from the old messaging link", () => {
    expect(read("?messaging")).toEqual({ kind: "settings", section: "messaging", spaceId: null });
  });
});

describe("withShellOverlay", () => {
  const write = (search: string, overlay: Parameters<typeof withShellOverlay>[1]) =>
    searchString(withShellOverlay(new URLSearchParams(search), overlay));

  it("keeps unrelated params and writes flags bare", () => {
    expect(write("?m=msg_1", { kind: "integrations" })).toBe("?m=msg_1&integrations");
  });

  it("replaces the open overlay instead of stacking another", () => {
    expect(write("?integrations&routine=r_1", { kind: "mcp" })).toBe("?routine=r_1&mcp");
    expect(write("", { kind: "mcp", serverId: "srv_1" })).toBe("?mcp=srv_1");
    expect(write("?settings=models&space=sp_1", { kind: "integrations" })).toBe("?integrations");
  });

  it("writes the settings section and space", () => {
    expect(write("", { kind: "settings", section: "models", spaceId: "sp_1" })).toBe(
      "?settings=models&space=sp_1",
    );
    expect(write("?space=sp_1", { kind: "settings", section: "usage", spaceId: null })).toBe(
      "?settings=usage",
    );
  });

  it("closing removes only overlay params", () => {
    expect(write("?m=msg_1&settings=voice&space=sp_1", null)).toBe("?m=msg_1");
    expect(write("?mcp", null)).toBe("");
  });

  it("round-trips through readShellOverlay", () => {
    const overlay = { kind: "settings", section: "billing", spaceId: "sp_2" } as const;
    expect(readShellOverlay(withShellOverlay(new URLSearchParams(), overlay))).toEqual(overlay);
  });

  it("opens a document studio by id and type, or the newest of a type", () => {
    expect(write("?m=msg_1", { kind: "doc", id: "art_1", format: "docx" })).toBe(
      "?m=msg_1&doc=art_1&kind=docx",
    );
    expect(write("?whiteboards", { kind: "doc", id: null, format: "xlsx" })).toBe("?doc&kind=xlsx");
    expect(write("?doc=art_1&kind=docx&m=msg_1", null)).toBe("?m=msg_1");
    expect(write("?doc=art_1&kind=docx", { kind: "apps" })).toBe("?apps");
    const overlay = { kind: "doc", id: "art_2", format: "pptx" } as const;
    expect(readShellOverlay(withShellOverlay(new URLSearchParams(), overlay))).toEqual(overlay);
  });
});

describe("readShellOverlay documents", () => {
  it("reads the id, ignoring an unknown type", () => {
    expect(read("?doc=art_1")).toEqual({ kind: "doc", id: "art_1", format: null });
    expect(read("?doc=art_1&kind=odt")).toEqual({ kind: "doc", id: "art_1", format: null });
    expect(read("?doc=art_1&kind=pdf")).toEqual({ kind: "doc", id: "art_1", format: "pdf" });
    expect(read("?doc=art_1&kind=jantt")).toEqual({ kind: "doc", id: "art_1", format: "jantt" });
    expect(read("?doc&kind=docx")).toEqual({ kind: "doc", id: null, format: "docx" });
    expect(read("?doc&kind=jantt")).toEqual({ kind: "doc", id: null, format: "jantt" });
  });
});

describe("shellOverlaySearch", () => {
  it("carries only the overlay into a redirect", () => {
    expect(shellOverlaySearch(new URLSearchParams("?m=msg_1&settings=voice"))).toBe(
      "?settings=voice",
    );
    expect(shellOverlaySearch(new URLSearchParams("?routine=r_1"))).toBe("");
  });
});

describe("withDocumentOverlay", () => {
  const current = new URLSearchParams("?m=msg_1&routine=r_1&doc=art_1&kind=docx");

  it("keeps the open document when moving to another chat", () => {
    expect(documentOverlaySearch(current)).toBe("?doc=art_1&kind=docx");
    expect(withDocumentOverlay("/app/bot_2", current)).toBe("/app/bot_2?doc=art_1&kind=docx");
    expect(withDocumentOverlay("/app/bot_2", "?m=msg_1&doc=art_1&kind=docx")).toBe(
      "/app/bot_2?doc=art_1&kind=docx",
    );
    expect(withDocumentOverlay("/app/g/group_2", current)).toBe(
      "/app/g/group_2?doc=art_1&kind=docx",
    );
    expect(withDocumentOverlay("/app", current)).toBe("/app?doc=art_1&kind=docx");
  });

  it("keeps an empty studio and a message the destination already asked for", () => {
    const empty = new URLSearchParams("?doc&kind=pptx");
    expect(withDocumentOverlay("/app/bot_2", empty)).toBe("/app/bot_2?doc&kind=pptx");
    expect(withDocumentOverlay("/app/bot_2?m=msg_2", current)).toBe(
      "/app/bot_2?m=msg_2&doc=art_1&kind=docx",
    );
  });

  it("leaves a chosen document, a page, and every non-chat route alone", () => {
    expect(withDocumentOverlay("/app/bot_2?doc=art_9&kind=pdf", current)).toBe(
      "/app/bot_2?doc=art_9&kind=pdf",
    );
    expect(withDocumentOverlay("/app/bot_2?page=page_1", current)).toBe("/app/bot_2?page=page_1");
    expect(withDocumentOverlay("/app/bot_2?page=page_1&view=1", current)).toBe(
      "/app/bot_2?page=page_1&view=1",
    );
    expect(withDocumentOverlay("/app/board", current)).toBe("/app/board");
    expect(withDocumentOverlay("/app/artifacts", current)).toBe("/app/artifacts");
    expect(withDocumentOverlay("/app/artifacts/art_1", current)).toBe("/app/artifacts/art_1");
    expect(withDocumentOverlay("/app/x/link_1", current)).toBe("/app/x/link_1");
    expect(withDocumentOverlay("/admin#models", current)).toBe("/admin#models");
  });

  it("adds nothing when no document studio is open", () => {
    expect(withDocumentOverlay("/app/bot_2", new URLSearchParams("?settings=voice&m=msg_1"))).toBe(
      "/app/bot_2",
    );
    expect(withDocumentOverlay("/app/bot_2?routine=r_1", new URLSearchParams(""))).toBe(
      "/app/bot_2?routine=r_1",
    );
  });
});
