/**
 * Capacitor-shell push: initialises the native push plugin, binds the signed-in
 * account, and routes notification taps into the app. Browser and Electron builds
 * are no-ops. Vendor SDK details stay in this composition module.
 */

import { openOrganizationSpace } from "./organizations";
import { selectedSpaceId } from "./rpc";

const PLUGIN = "OneSignalCapacitor";
const OPEN_PUSH_CHAT_EVENT = "rakazo:open-push-chat";

type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
  registerPlugin?: (name: string) => NativePushPlugin;
};

type NativePushPlugin = {
  initialize(options: { appId: string }): Promise<void>;
  login(options: { externalId: string }): Promise<void>;
  logout(): Promise<void>;
  requestPermission?(options?: { fallbackToSettings?: boolean }): Promise<{
    permission?: boolean;
  }>;
  getPermission?(): Promise<{ permission?: boolean }>;
  /** Raw OS status: 0 not determined, 1 denied, 2 authorised, 3 provisional, 4 ephemeral. */
  permissionNative?(): Promise<{ permission?: number }>;
  canRequestPermission?(): Promise<{ canRequest?: boolean }>;
  addListener(
    event: string,
    listener: (event: Record<string, unknown>) => void,
  ): Promise<{ remove: () => Promise<void> | void }> | { remove: () => Promise<void> | void };
};

export type NativePushChatTarget = {
  spaceId?: string;
  botId?: string;
  groupId?: string;
  threadId?: string;
  messageId?: string;
  runId?: string;
  category?: string;
  kind?: string;
};

let plugin: NativePushPlugin | undefined;
let initializedAppId: string | undefined;
let boundUserId: string | null = null;
let clickListenerInstalled = false;
let pendingTarget: NativePushChatTarget | null = null;
let openChatSubscriberCount = 0;
/** Test-only override for the public push app id. */
let appIdForTest: string | undefined | null = null;

function capacitor(): CapacitorBridge | undefined {
  return (globalThis as { Capacitor?: CapacitorBridge }).Capacitor;
}

/** True only inside the Capacitor shell with the native push plugin present. */
export function nativePushAvailable(): boolean {
  const cap = capacitor();
  return Boolean(cap?.isNativePlatform?.() && cap.isPluginAvailable?.(PLUGIN));
}

function pushAppId(): string | undefined {
  if (appIdForTest !== null) {
    const trimmed = appIdForTest?.trim();
    return trimmed || undefined;
  }
  const value = (import.meta as ImportMeta).env?.VITE_PUSH_APP_ID;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function nativePlugin(): NativePushPlugin | undefined {
  if (plugin) return plugin;
  if (!nativePushAvailable()) return undefined;
  const cap = capacitor();
  if (!cap?.registerPlugin) return undefined;
  plugin = cap.registerPlugin(PLUGIN);
  return plugin;
}

async function ensureInitialized(): Promise<NativePushPlugin | undefined> {
  const native = nativePlugin();
  if (!native) return undefined;
  const appId = pushAppId();
  if (!appId) return undefined;
  if (initializedAppId === appId) return native;
  await native.initialize({ appId });
  initializedAppId = appId;
  return native;
}

/**
 * Installs click routing early so a cold-start tap is not lost before React mounts.
 * Safe to call from `main.tsx`; no-ops outside the Capacitor shell.
 */
export function installNativePushRouting(): () => void {
  if (!nativePushAvailable()) return () => undefined;
  let cancelled = false;
  let remove: (() => void) | undefined;
  void (async () => {
    const native = await ensureInitialized();
    if (!native || cancelled || clickListenerInstalled) return;
    clickListenerInstalled = true;
    const handle = await native.addListener("notificationClick", (event) => {
      const target = nativePushOpenTarget(event);
      if (!target) return;
      if (openChatSubscriberCount === 0) {
        pendingTarget = target;
        return;
      }
      dispatchOpenPushChat(target);
    });
    remove = () => {
      void Promise.resolve(handle.remove()).catch(() => undefined);
    };
  })().catch(() => undefined);
  return () => {
    cancelled = true;
    clickListenerInstalled = false;
    remove?.();
  };
}

/** Bind or clear the native push identity when the session changes. */
export async function syncNativePushUser(userId: string | null | undefined): Promise<void> {
  const native = await ensureInitialized();
  if (!native) return;
  const next = userId?.trim() || null;
  if (next === boundUserId) return;
  if (next) {
    await native.login({ externalId: next });
    boundUserId = next;
    return;
  }
  await native.logout();
  boundUserId = null;
}

function permissionFromNativeCode(
  code: number | undefined,
): "default" | "granted" | "denied" | undefined {
  if (code === 2 || code === 3 || code === 4) return "granted";
  if (code === 1) return "denied";
  if (code === 0) return "default";
  return undefined;
}

export async function nativePushPermissionState(): Promise<"default" | "granted" | "denied"> {
  const native = await ensureInitialized();
  // The plugin not being ready is not an OS refusal. Treat it as not-yet-asked so the
  // first-run invitation still appears; Enable no-ops until the plugin can prompt.
  if (!native) return "default";
  try {
    const coded = permissionFromNativeCode((await native.permissionNative?.())?.permission);
    if (coded) return coded;
    if ((await native.getPermission?.())?.permission) return "granted";
    // `canRequest === false` is also what the plugin reports before it has read the
    // system status. That is not a denial, and hiding the invitation on it means the
    // person is never asked.
    return "default";
  } catch {
    return "default";
  }
}

/** Prompts for notification permission after the user opts in. */
export async function requestNativePushPermission(): Promise<boolean> {
  const native = await ensureInitialized();
  if (!native?.requestPermission) return false;
  try {
    const result = await native.requestPermission({ fallbackToSettings: false });
    return Boolean(result?.permission);
  } catch {
    return false;
  }
}

/** Opens the OS notification settings when permission was previously denied. */
export async function openNativePushSettings(): Promise<void> {
  const native = await ensureInitialized();
  if (!native?.requestPermission) return;
  try {
    await native.requestPermission({ fallbackToSettings: true });
  } catch {
    // Settings may be unavailable on some devices; the row still shows the blocked state.
  }
}

export function subscribeOpenPushChat(listener: (target: NativePushChatTarget) => void): () => void {
  const onEvent = (event: Event) => {
    const detail = (event as CustomEvent<NativePushChatTarget>).detail;
    if (detail) listener(detail);
  };
  openChatSubscriberCount += 1;
  window.addEventListener(OPEN_PUSH_CHAT_EVENT, onEvent);
  if (pendingTarget) {
    const queued = pendingTarget;
    pendingTarget = null;
    queueMicrotask(() => listener(queued));
  }
  return () => {
    openChatSubscriberCount = Math.max(0, openChatSubscriberCount - 1);
    window.removeEventListener(OPEN_PUSH_CHAT_EVENT, onEvent);
  };
}

function dispatchOpenPushChat(target: NativePushChatTarget): boolean {
  return window.dispatchEvent(
    new CustomEvent(OPEN_PUSH_CHAT_EVENT, { detail: target, cancelable: true }),
  );
}

/** Maps a native click payload onto the chat route fields used by mobile and web. */
export function nativePushOpenTarget(event: unknown): NativePushChatTarget | null {
  if (!event || typeof event !== "object") return null;
  const record = event as Record<string, unknown>;
  const notification =
    record.notification && typeof record.notification === "object"
      ? (record.notification as Record<string, unknown>)
      : record;
  const data =
    notification.additionalData && typeof notification.additionalData === "object"
      ? (notification.additionalData as Record<string, unknown>)
      : notification.data && typeof notification.data === "object"
        ? (notification.data as Record<string, unknown>)
        : notification;
  const field = (key: string): string | undefined => {
    const direct = data[key];
    const prefixed = data[`rakazo.${key}`];
    const value = typeof direct === "string" ? direct : typeof prefixed === "string" ? prefixed : undefined;
    const trimmed = value?.trim();
    return trimmed || undefined;
  };
  const groupId = field("groupId");
  const botId = field("botId");
  if (!groupId && !botId) return null;
  return {
    ...(field("spaceId") ? { spaceId: field("spaceId") } : {}),
    ...(botId ? { botId } : {}),
    ...(groupId ? { groupId } : {}),
    ...(field("threadId") ? { threadId: field("threadId") } : {}),
    ...(field("messageId") ? { messageId: field("messageId") } : {}),
    ...(field("runId") ? { runId: field("runId") } : {}),
    ...(field("category") ? { category: field("category") } : {}),
    ...(field("kind") ? { kind: field("kind") } : {}),
  };
}

export function nativePushChatPath(target: NativePushChatTarget): string | null {
  let path: string | null = null;
  if (target.groupId) path = `/app/g/${encodeURIComponent(target.groupId)}`;
  else if (target.botId) {
    path = target.threadId
      ? `/app/${encodeURIComponent(target.botId)}/c/${encodeURIComponent(target.threadId)}`
      : `/app/${encodeURIComponent(target.botId)}`;
  }
  if (!path) return null;
  if (target.messageId) {
    const params = new URLSearchParams({ m: target.messageId });
    return `${path}?${params.toString()}`;
  }
  return path;
}

/**
 * Opens the chat a push pointed at, switching Space when needed. Prefer the shell's
 * `openSpaceChat` when the subscriber provides one.
 */
export async function openNativePushChat(
  target: NativePushChatTarget,
  options: {
    userId: string | null;
    openSpaceChat?: (spaceId: string, path: string) => void;
  },
): Promise<void> {
  const path = nativePushChatPath(target);
  if (!path) return;
  const spaceId = target.spaceId ?? selectedSpaceId() ?? undefined;
  if (spaceId && options.openSpaceChat) {
    options.openSpaceChat(spaceId, path);
    return;
  }
  if (target.spaceId) {
    await openOrganizationSpace(options.userId, target.spaceId, path);
    return;
  }
  window.location.assign(path);
}

export function setNativePushAppIdForTest(appId: string | undefined) {
  appIdForTest = appId;
}

export function resetNativePushForTest() {
  plugin = undefined;
  initializedAppId = undefined;
  boundUserId = null;
  clickListenerInstalled = false;
  pendingTarget = null;
  openChatSubscriberCount = 0;
  appIdForTest = null;
}
