import { describe, expect, it } from "vitest";
import {
  runStudioBeforeSend,
  setStudioBeforeSend,
  setStudioSelectionImage,
  studioSelectionImage,
} from "./studio-send";

const attachment = {
  artifactId: "v2",
  familyArtifactIds: ["v1", "v2"],
  botId: "bot-1",
  groupId: null,
};

describe("runStudioBeforeSend", () => {
  it("attaches the open studio's newest version to its own chat", async () => {
    const session = {};
    const off = setStudioBeforeSend(session, async () => attachment);
    expect(await runStudioBeforeSend(session, { botId: "bot-1" }, [])).toEqual(["v2"]);
    expect(await runStudioBeforeSend(session, { botId: "bot-2" }, [])).toEqual([]);
    off();
    expect(await runStudioBeforeSend(session, { botId: "bot-1" }, [])).toEqual([]);
  });

  it("never blocks sending when the studio fails or does not answer", async () => {
    const failing = {};
    setStudioBeforeSend(failing, async () => {
      throw new Error("offline");
    });
    expect(await runStudioBeforeSend(failing, { botId: "bot-1" }, [])).toEqual([]);
    const hanging = {};
    setStudioBeforeSend(hanging, () => new Promise(() => {}));
    expect(await runStudioBeforeSend(hanging, { botId: "bot-1" }, [], 10)).toEqual([]);
    expect(await runStudioBeforeSend(null, { botId: "bot-1" }, [])).toEqual([]);
  });
});

describe("studioSelectionImage", () => {
  it("reads the selected picture, and never blocks when it fails or hangs", async () => {
    const session = {};
    const file = new File([new Uint8Array([1])], "picture.png", { type: "image/png" });
    const off = setStudioSelectionImage(session, async () => file);
    expect(await studioSelectionImage(session)).toBe(file);
    off();
    expect(await studioSelectionImage(session)).toBeNull();
    setStudioSelectionImage(session, () => new Promise(() => {}));
    expect(await studioSelectionImage(session, 10)).toBeNull();
    setStudioSelectionImage(session, async () => {
      throw new Error("gone");
    });
    expect(await studioSelectionImage(session)).toBeNull();
  });
});
