import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type {
  AdapterContext,
  IncomingCallNotification,
  NotificationMessage,
  NotificationProvider,
} from "@rakazo/adapter-kit";
import { getLogger } from "@rakazo/logging";
import { combineSignals } from "./connector-safety.js";
import { expoPushData, ExpoPushProvider } from "./expo-push.js";
import { readBodyCapped, withAbort } from "./web-ssrf.js";

const ONESIGNAL_PUSH_URL = "https://api.onesignal.com/notifications";
const ONESIGNAL_PUSH_TIMEOUT_MS = 15_000;
const ONESIGNAL_PUSH_RETRY_DELAYS_MS = [1_000, 2_000];
const MAX_PUSH_TITLE_CHARS = 100;
const MAX_PUSH_BODY_CHARS = 180;
const MAX_PUSH_PAYLOAD_BYTES = 3300;
export const MAX_ONESIGNAL_PUSH_RESPONSE_BYTES = 64 * 1024;
const RESPONSE_TOO_LARGE = "Push response is too large.";

export type OneSignalPushConfig = {
  appId: string;
  /** REST API key; never logged. */
  apiKey: string;
  fetch?: typeof fetch;
  retryDelaysMs?: number[];
};

export type OneSignalPushDelivery = "delivered" | "undeliverable";

type OneSignalCreateResponse = {
  id?: string;
  errors?: unknown;
};

/**
 * Delivers run notifications through OneSignal by authenticated account id
 * (`external_id`), without storing device tokens in Rakazo.
 */
export class OneSignalPushProvider implements NotificationProvider {
  private readonly fetch: typeof fetch;
  private readonly retryDelaysMs: number[];

  constructor(private readonly config: OneSignalPushConfig) {
    this.fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.retryDelaysMs = config.retryDelaysMs ?? ONESIGNAL_PUSH_RETRY_DELAYS_MS;
  }

  describe() {
    return {
      id: "onesignal-push",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { push: true, email: false },
    };
  }

  async send(message: NotificationMessage, context: AdapterContext): Promise<void> {
    await this.deliver(message, context);
  }

  /**
   * Posts one push to the account's OneSignal subscriptions. Empty/no-subscription
   * replies are `undeliverable` (not thrown), matching Expo's no-token path.
   */
  async deliver(
    message: NotificationMessage,
    context: AdapterContext,
  ): Promise<OneSignalPushDelivery> {
    if (!context.userId) return "undeliverable";
    const title = capped(message.title, MAX_PUSH_TITLE_CHARS);
    let bodyChars = MAX_PUSH_BODY_CHARS;
    let text = capped(message.body, bodyChars);
    const deliveryId = randomUUID();
    const data = expoPushData(message, context.spaceId, deliveryId);
    const urgent =
      message.kind === "help" || message.kind === "takeover" || message.kind === "failure";
    const build = (): Record<string, unknown> => ({
      app_id: this.config.appId,
      include_aliases: { external_id: [context.userId] },
      target_channel: "push",
      headings: { en: title },
      contents: { en: text },
      data,
      collapse_id: message.threadId,
      ...(urgent ? { priority: 10 } : {}),
      ...(message.badge === undefined
        ? {}
        : { ios_badgeType: "SetTo", ios_badgeCount: message.badge }),
    });
    let payload = build();
    while (Buffer.byteLength(JSON.stringify(payload)) > MAX_PUSH_PAYLOAD_BYTES && bodyChars > 1) {
      bodyChars = Math.floor(bodyChars / 2);
      text = capped(message.body, bodyChars);
      payload = build();
    }
    const { status, body } = await this.postWithBackoff(payload, context.signal, deliveryId);
    if (status < 300 && body === undefined) {
      throw new Error("Push provider returned an invalid response.");
    }
    if (isNoSubscription(body, status)) return "undeliverable";
    const failure = onesignalErrorMessage(body, status);
    if (failure) {
      getLogger().error(failure);
      throw new Error(failure);
    }
    return "delivered";
  }

  private async postWithBackoff(
    payload: unknown,
    signal: AbortSignal | undefined,
    idempotencyKey: string,
  ) {
    for (let attempt = 0; ; attempt += 1) {
      const reply = await postToOneSignal(
        this.fetch,
        this.config.apiKey,
        payload,
        idempotencyKey,
        signal,
      );
      const retryDelay = this.retryDelaysMs[attempt];
      if (retryDelay === undefined || !onesignalAskedToBackOff(reply.status)) return reply;
      await delay(retryDelay, undefined, { signal });
    }
  }
}

/**
 * Sends the same notification through every provider. One success is enough; if every
 * provider rejects, the first rejection is rethrown.
 */
export class FanoutNotificationProvider implements NotificationProvider {
  constructor(readonly providers: readonly NotificationProvider[]) {}

  describe() {
    return {
      id: "fanout-push",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { push: true, email: false },
    };
  }

  async send(message: NotificationMessage, context: AdapterContext): Promise<void> {
    const results = await Promise.allSettled(
      this.providers.map((provider) => provider.send(message, context)),
    );
    if (results.some((result) => result.status === "fulfilled")) return;
    const first = results.find((result) => result.status === "rejected");
    if (first && first.status === "rejected") throw first.reason;
  }

  async incomingCall(userId: string, call: IncomingCallNotification): Promise<void> {
    await Promise.allSettled(
      this.providers.map((provider) =>
        provider.incomingCall ? provider.incomingCall(userId, call) : Promise.resolve(),
      ),
    );
  }
}

/** The Expo child inside a fan-out (or the provider itself when it is Expo). */
export function expoPushFrom(
  notifications: NotificationProvider | undefined,
): ExpoPushProvider | undefined {
  if (!notifications) return undefined;
  if (notifications instanceof ExpoPushProvider) return notifications;
  if (notifications instanceof FanoutNotificationProvider) {
    for (const provider of notifications.providers) {
      if (provider instanceof ExpoPushProvider) return provider;
    }
  }
  return undefined;
}

/** True when at least one configured channel might reach this user. */
export async function notificationChannelCanDeliver(
  notifications: NotificationProvider,
  userId: string,
): Promise<boolean> {
  if (notifications instanceof FanoutNotificationProvider) {
    const children = notifications.providers;
    if (children.some((provider) => !(provider instanceof ExpoPushProvider))) return true;
    const expo = expoPushFrom(notifications);
    return expo ? expo.hasPushRecipient(userId) : true;
  }
  if (notifications instanceof ExpoPushProvider) return notifications.hasPushRecipient(userId);
  return true;
}

export function onesignalErrorMessage(body: unknown, status: number): string | undefined {
  if (status === 401 || status === 403) return "Push provider rejected the API key.";
  if (isNoSubscription(body, status)) return undefined;
  if (status >= 300) {
    const fromBody = firstErrorString(body);
    return fromBody ?? `Push provider failed (${status})`;
  }
  const errors = firstErrorString(body);
  // A 2xx with only soft "not subscribed" errors is handled above; any other error is hard.
  if (errors && !isNoSubscription(body, status)) return errors;
  return undefined;
}

function isNoSubscription(body: unknown, status: number): boolean {
  if (status >= 300) return false;
  if (!body || typeof body !== "object") return false;
  const id = (body as OneSignalCreateResponse).id;
  if (typeof id === "string" && id.length > 0) return false;
  const message = firstErrorString(body)?.toLowerCase() ?? "";
  if (!message) {
    // Empty id with no errors: treated as nothing to deliver.
    return id === "" || id === undefined;
  }
  return (
    message.includes("not subscribed") ||
    message.includes("no subscribed") ||
    message.includes("all included players are not subscribed")
  );
}

function firstErrorString(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const errors = (body as OneSignalCreateResponse).errors;
  if (typeof errors === "string" && errors.trim()) return errors.trim();
  if (Array.isArray(errors)) {
    const parts = errors
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
    return parts.length > 0 ? parts.join("; ") : undefined;
  }
  if (errors && typeof errors === "object") {
    const values = Object.values(errors as Record<string, unknown>)
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
    return values.length > 0 ? values.join("; ") : undefined;
  }
  return undefined;
}

function onesignalAskedToBackOff(status: number): boolean {
  return status === 429 || status >= 500;
}

async function postToOneSignal(
  fetchImpl: typeof fetch,
  apiKey: string,
  payload: unknown,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<{ status: number; body: unknown }> {
  const attempt = combineSignals(signal, AbortSignal.timeout(ONESIGNAL_PUSH_TIMEOUT_MS));
  try {
    const response = await fetchImpl(ONESIGNAL_PUSH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Key ${apiKey}`,
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: attempt,
    });
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > MAX_ONESIGNAL_PUSH_RESPONSE_BYTES) {
      await withAbort(response.body?.cancel() ?? Promise.resolve(), attempt).catch(() => undefined);
      throw new Error(RESPONSE_TOO_LARGE);
    }
    const bytes = await readBodyCapped(response, MAX_ONESIGNAL_PUSH_RESPONSE_BYTES, attempt);
    if (bytes.byteLength === 0) return { status: response.status, body: undefined };
    try {
      return {
        status: response.status,
        body: JSON.parse(new TextDecoder().decode(bytes)) as unknown,
      };
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("Push provider returned an invalid response.");
      throw error;
    }
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.message === RESPONSE_TOO_LARGE)) {
      throw error;
    }
    if (error instanceof Error && error.message === "Response is too large") {
      throw new Error(RESPONSE_TOO_LARGE);
    }
    getLogger().warn("push request failed", { error });
    return { status: 503, body: { errors: ["Push provider request failed"] } };
  }
}

function capped(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
