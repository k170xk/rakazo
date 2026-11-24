import type { NotificationProvider } from "@rakazo/adapter-kit";
import { createLogger, installLogger } from "@rakazo/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapturingNotificationProvider } from "./artifacts.js";
import { ExpoPushProvider } from "./expo-push.js";
import {
  expoPushFrom,
  FanoutNotificationProvider,
  MAX_ONESIGNAL_PUSH_RESPONSE_BYTES,
  notificationChannelCanDeliver,
  onesignalErrorMessage,
  OneSignalPushProvider,
} from "./onesignal-push.js";
import { MemoryPushTokenStore } from "./push-token-store.test-support.js";

afterEach(async () => {
  vi.unstubAllGlobals();
  installLogger(createLogger({ service: "test", level: "off", sinks: [] }));
});

const notifyContext = {
  operationId: "n",
  traceId: "n",
  spaceId: "space-1",
  userId: "user-1",
  signal: new AbortController().signal,
};

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status });
}

describe("onesignal push errors", () => {
  it("names auth failures without echoing the key", () => {
    expect(onesignalErrorMessage({ errors: ["Unauthorized"] }, 401)).toBe(
      "Push provider rejected the API key.",
    );
    expect(onesignalErrorMessage(undefined, 502)).toBe("Push provider failed (502)");
    expect(
      onesignalErrorMessage({ id: "", errors: ["All included players are not subscribed"] }, 200),
    ).toBeUndefined();
  });
});

describe("onesignal push", () => {
  it("targets the account external id with deep-link data and an idempotency key", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse({ id: "msg-1" })));
    vi.stubGlobal("fetch", fetchMock);
    const push = new OneSignalPushProvider({
      appId: "app-1",
      apiKey: "secret-key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await push.send(
      {
        kind: "completion",
        title: "Done",
        body: "Finished the report",
        botId: "bot-1",
        threadId: "th-1",
        badge: 2,
      },
      notifyContext,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.onesignal.com/notifications");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Key secret-key");
    expect(headers.get("idempotency-key")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      app_id: "app-1",
      include_aliases: { external_id: ["user-1"] },
      target_channel: "push",
      headings: { en: "Done" },
      contents: { en: "Finished the report" },
      collapse_id: "th-1",
      ios_badgeType: "SetTo",
      ios_badgeCount: 2,
      data: {
        kind: "completion",
        botId: "bot-1",
        threadId: "th-1",
        spaceId: "space-1",
      },
    });
    expect(String(init.body)).not.toContain("secret-key");
  });

  it("raises priority for help and approval pauses", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse({ id: "msg-2" })));
    const push = new OneSignalPushProvider({
      appId: "app-1",
      apiKey: "secret-key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await push.send(
      {
        kind: "help",
        title: "Needs you",
        body: "Approve the spend",
        botId: "bot-1",
        threadId: "th-1",
        groupId: "group-1",
      },
      notifyContext,
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      priority: 10,
      data: { groupId: "group-1", kind: "help" },
    });
  });

  it("treats an empty subscription set as undeliverable", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        jsonResponse({ id: "", errors: ["All included players are not subscribed"] }),
      ),
    );
    const push = new OneSignalPushProvider({
      appId: "app-1",
      apiKey: "secret-key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(
      push.deliver(
        { kind: "completion", title: "Done", body: "ok", botId: "b", threadId: "t" },
        notifyContext,
      ),
    ).resolves.toBe("undeliverable");
  });

  it("retries on 429 then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ errors: ["rate limited"] }, 429))
      .mockResolvedValueOnce(jsonResponse({ id: "msg-3" }));
    const push = new OneSignalPushProvider({
      appId: "app-1",
      apiKey: "secret-key",
      fetch: fetchMock as unknown as typeof fetch,
      retryDelaysMs: [1],
    });
    await push.send(
      { kind: "failure", title: "Failed", body: "boom", botId: "b", threadId: "t" },
      notifyContext,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects oversized responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("x".repeat(MAX_ONESIGNAL_PUSH_RESPONSE_BYTES + 1), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const push = new OneSignalPushProvider({
      appId: "app-1",
      apiKey: "secret-key",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(
      push.send(
        { kind: "completion", title: "Done", body: "ok", botId: "b", threadId: "t" },
        notifyContext,
      ),
    ).rejects.toThrow(/too large/i);
  });
});

describe("fanout notification provider", () => {
  it("delivers through every child and survives one failure", async () => {
    const ok = new CapturingNotificationProvider();
    const failing: NotificationProvider = {
      describe: () => ({
        id: "failing",
        contractVersion: "1",
        adapterVersion: "0.1.0",
        capabilities: { push: true, email: false },
      }),
      send: async () => {
        throw new Error("downstream failed");
      },
    };
    const fanout = new FanoutNotificationProvider([failing, ok]);
    await fanout.send(
      { kind: "takeover", title: "Take over", body: "screen", botId: "b", threadId: "t" },
      notifyContext,
    );
    expect(ok.sent).toHaveLength(1);
  });

  it("unwraps Expo for receipt checks and treats OneSignal as always tryable", async () => {
    const tokens = new MemoryPushTokenStore();
    const expo = new ExpoPushProvider(tokens);
    const onesignal = new OneSignalPushProvider({ appId: "a", apiKey: "k" });
    const fanout = new FanoutNotificationProvider([expo, onesignal]);
    expect(expoPushFrom(fanout)).toBe(expo);
    await expect(notificationChannelCanDeliver(fanout, "missing")).resolves.toBe(true);
    await expect(notificationChannelCanDeliver(expo, "missing")).resolves.toBe(false);
  });
});
