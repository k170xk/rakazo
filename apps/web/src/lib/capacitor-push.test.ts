/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installNativePushRouting,
  nativePushAvailable,
  nativePushChatPath,
  nativePushOpenTarget,
  openNativePushChat,
  resetNativePushForTest,
  setNativePushAppIdForTest,
  subscribeOpenPushChat,
  syncNativePushUser,
} from "./capacitor-push";

afterEach(() => {
  resetNativePushForTest();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "Capacitor");
});

function installCapacitor(plugin: Record<string, unknown>) {
  const registerPlugin = vi.fn(() => plugin);
  (globalThis as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    isPluginAvailable: (name: string) => name === "OneSignalCapacitor",
    registerPlugin,
  };
  return registerPlugin;
}

describe("native push routing", () => {
  it("is unavailable outside the Capacitor shell", () => {
    expect(nativePushAvailable()).toBe(false);
  });

  it("maps click payloads onto chat targets", () => {
    expect(
      nativePushOpenTarget({
        notification: {
          additionalData: {
            spaceId: "space-1",
            botId: "bot-1",
            threadId: "th-1",
            kind: "completion",
          },
        },
      }),
    ).toEqual({
      spaceId: "space-1",
      botId: "bot-1",
      threadId: "th-1",
      kind: "completion",
    });
    expect(
      nativePushOpenTarget({
        notification: { additionalData: { groupId: "group-1", botId: "bot-1" } },
      }),
    ).toEqual({ groupId: "group-1", botId: "bot-1" });
    expect(nativePushOpenTarget({ notification: { additionalData: {} } })).toBeNull();
  });

  it("builds chat paths for bots, threads and groups", () => {
    expect(nativePushChatPath({ botId: "bot-1" })).toBe("/app/bot-1");
    expect(nativePushChatPath({ botId: "bot-1", threadId: "th-1" })).toBe("/app/bot-1/c/th-1");
    expect(nativePushChatPath({ groupId: "group-1" })).toBe("/app/g/group-1");
  });

  it("initialises, logs in and logs out through the native plugin", async () => {
    setNativePushAppIdForTest("app-public");
    const initialize = vi.fn(async () => undefined);
    const login = vi.fn(async () => undefined);
    const logout = vi.fn(async () => undefined);
    installCapacitor({
      initialize,
      login,
      logout,
      addListener: vi.fn(async () => ({ remove: () => undefined })),
    });
    await syncNativePushUser("user-1");
    expect(initialize).toHaveBeenCalledWith({ appId: "app-public" });
    expect(login).toHaveBeenCalledWith({ externalId: "user-1" });
    await syncNativePushUser("user-1");
    expect(login).toHaveBeenCalledOnce();
    await syncNativePushUser(null);
    expect(logout).toHaveBeenCalledOnce();
  });

  it("queues a cold-start click until a subscriber is ready", async () => {
    setNativePushAppIdForTest("app-public");
    let clickListener: ((event: Record<string, unknown>) => void) | undefined;
    installCapacitor({
      initialize: vi.fn(async () => undefined),
      login: vi.fn(async () => undefined),
      logout: vi.fn(async () => undefined),
      addListener: vi.fn(async (_event: string, listener: (event: Record<string, unknown>) => void) => {
        clickListener = listener;
        return { remove: () => undefined };
      }),
    });
    installNativePushRouting();
    await vi.waitFor(() => expect(clickListener).toBeTypeOf("function"));
    clickListener?.({
      notification: { additionalData: { botId: "bot-9", spaceId: "space-9" } },
    });
    const received: unknown[] = [];
    const stop = subscribeOpenPushChat((target) => received.push(target));
    await vi.waitFor(() => expect(received).toEqual([{ botId: "bot-9", spaceId: "space-9" }]));
    stop();
  });

  it("opens a chat through the shell space switcher when available", async () => {
    const openSpaceChat = vi.fn();
    await openNativePushChat(
      { spaceId: "space-2", botId: "bot-2", threadId: "th-2" },
      { userId: "user-1", openSpaceChat },
    );
    expect(openSpaceChat).toHaveBeenCalledWith("space-2", "/app/bot-2/c/th-2");
  });
});
