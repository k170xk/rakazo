import { describe, expect, it } from "vitest";
import { applyCompanyChatSettings } from "./company-chat-settings";
import { getComposerEnterToSend } from "./composer-enter-to-send-pref";
import { getRemoteImagesEnabled } from "./remote-images-preference";
import { getResponseStreamingEnabled } from "./response-streaming";
import { getToolActivityEnabled } from "./tool-activity-preference";

describe("company chat settings", () => {
  it("replaces each chat preference with the company value", () => {
    applyCompanyChatSettings(
      { sendWithEnter: true, streamReplies: true, toolActivity: true, webImages: true },
      false,
    );
    expect(getComposerEnterToSend()).toBe(true);
    expect(getResponseStreamingEnabled()).toBe(true);
    expect(getToolActivityEnabled()).toBe(true);
    expect(getRemoteImagesEnabled()).toBe(true);

    applyCompanyChatSettings(
      { sendWithEnter: false, streamReplies: false, toolActivity: false, webImages: false },
      false,
    );
    expect(getComposerEnterToSend()).toBe(false);
    expect(getResponseStreamingEnabled()).toBe(false);
    expect(getToolActivityEnabled()).toBe(false);
    expect(getRemoteImagesEnabled()).toBe(false);
  });

  it("keeps Enter as a new line on touch screens", () => {
    applyCompanyChatSettings({ sendWithEnter: true }, true);
    expect(getComposerEnterToSend()).toBe(false);
  });

  it("leaves preferences alone before company settings arrive", () => {
    applyCompanyChatSettings({ streamReplies: true }, false);
    applyCompanyChatSettings(undefined);
    expect(getResponseStreamingEnabled()).toBe(true);
  });
});
