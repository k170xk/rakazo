import { newClientId } from "@rakazo/core";
import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo-modules-core";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { rpc } from "./api";
import { currentSessionGeneration } from "./session";

export type RegisterPushOptions = {
  /**
   * When true, may show the OS permission prompt. Default false so registration
   * never prompts until the user consents in the first-run dialogue or settings.
   */
  requestPermission?: boolean;
};

async function notificationsAllowed(allowRequest: boolean) {
  // On iOS getPermissionsAsync holds Expo's shared native queue until the system answers,
  // which can take minutes after a restart, and SecureStore waits behind it. Avoid it on the
  // hot path: only requestPermissionsAsync (which does not hold the queue the same way) when
  // the user has consented, otherwise skip.
  if (Platform.OS === "ios") {
    if (!allowRequest) return false;
    return (await Notifications.requestPermissionsAsync()).granted;
  }
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  if (!allowRequest) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

export async function registerPushToken(options: RegisterPushOptions = {}) {
  if (!(await notificationsAllowed(options.requestPermission === true))) return;
  try {
    const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    if (!token) return;
    await rpc("notifications/registerPush", {
      token,
      ...(Platform.OS === "android" &&
      requireOptionalNativeModule<{ supportsSenderAvatars?: boolean }>("RakazoNotifications")
        ?.supportsSenderAvatars
        ? { presentation: "android_sender" as const }
        : {}),
    });
    await registerCallPushToken({ expoToken: token });
  } catch {
    // Expo Go without an EAS project id and Android builds without a Firebase config
    // cannot mint an Expo push token.
  }
}

export async function unregisterPushToken() {
  await rpc("notifications/unregisterPush").catch(() => undefined);
}

let callTokens: { expoToken?: string; voipToken?: string } = {};
let tokenGeneration = -1;
let registeredKey: string | undefined;
let deviceIdPromise: Promise<string> | undefined;
async function installationId() {
  deviceIdPromise ??= (async () => {
    const stored = await SecureStore.getItemAsync("rakazo.call-device");
    if (stored) return stored;
    const id = newClientId();
    await SecureStore.setItemAsync("rakazo.call-device", id);
    return id;
  })();
  const pending = deviceIdPromise;
  try {
    return await pending;
  } catch (error) {
    if (deviceIdPromise === pending) deviceIdPromise = undefined;
    throw error;
  }
}
/** Builds without native call handling keep the account's ordinary push for incoming calls. */
const nativeCalls = Boolean(
  requireOptionalNativeModule<{ incomingState?: unknown }>("RakazoNotifications")?.incomingState,
);

export async function registerCallPushToken(tokens: { expoToken?: string; voipToken?: string }) {
  if (!nativeCalls) return;
  const generation = currentSessionGeneration();
  if (generation !== tokenGeneration) {
    callTokens = {};
    registeredKey = undefined;
    tokenGeneration = generation;
  }
  const registration = { ...callTokens, ...tokens };
  const key = JSON.stringify(registration);
  if (key === registeredKey) return;
  callTokens = registration;
  const deviceId = await installationId();
  if (generation !== currentSessionGeneration()) return;
  if (Platform.OS !== "ios" && Platform.OS !== "android") return;
  await rpc("notifications/registerCallPush", { deviceId, platform: Platform.OS, ...registration });
  if (generation === currentSessionGeneration()) registeredKey = key;
}
