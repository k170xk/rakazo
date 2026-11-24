import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Alert, Linking, Platform } from "react-native";
import { rpc } from "./api";
import { t } from "./i18n";
import { registerPushToken } from "./push";

/** Bump when the prompt's copy or timing should show again for everyone. */
const PROMPT_VERSION = "v1";

const promptKey = (userId: string) => `rakazo:notifications-prompt:${PROMPT_VERSION}:${userId}`;
const consentKey = (userId: string) => `rakazo:push-consent:${PROMPT_VERSION}:${userId}`;

const offered = new Set<string>();
const OFFER_DELAY_MS = 1_200;

export type PushOsPermission = "default" | "granted" | "denied";

export function shouldOfferPushConsentPrompt(options: {
  userId: string | undefined;
  permission: PushOsPermission | undefined;
  pushEnabled: boolean;
  promptSeen: boolean;
}): boolean {
  const { userId, permission, pushEnabled, promptSeen } = options;
  return Boolean(userId && pushEnabled && permission === "default" && !promptSeen);
}

export async function hasSeenPushConsentPrompt(userId: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(promptKey(userId))) === "1";
  } catch {
    return false;
  }
}

export async function markPushConsentPromptSeen(userId: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(promptKey(userId), "1");
  } catch {
    // Storage blocked: the prompt may show again next visit.
  }
}

export async function hasPushPermissionConsent(userId: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(consentKey(userId))) === "1";
  } catch {
    return false;
  }
}

export async function grantPushPermissionConsent(userId: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(consentKey(userId), "1");
  } catch {
    // Registration may still succeed this session if the OS prompt returns granted.
  }
}

export async function readPushOsPermission(): Promise<PushOsPermission> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return "granted";
    if (current.status === "denied" || current.canAskAgain === false) return "denied";
    return "default";
  } catch {
    return "default";
  }
}

/** Register when the user already consented, or when the OS already granted (no new prompt). */
export async function syncPushRegistration(userId: string | undefined): Promise<void> {
  if (!userId) return;
  if (await hasPushPermissionConsent(userId)) {
    await registerPushToken({ requestPermission: true });
    return;
  }
  await registerPushToken();
}

/**
 * First-run dialogue after login when push is on and the OS has not decided yet.
 * Enable requests the system permission; Not now only dismisses the offer.
 */
export async function offerPushConsentOnce(
  userId: string,
  isActive: () => boolean,
): Promise<void> {
  if (offered.has(userId)) return;
  offered.add(userId);
  let promptSeen: boolean;
  try {
    promptSeen = await hasSeenPushConsentPrompt(userId);
  } catch {
    offered.delete(userId);
    return;
  }
  if (promptSeen) return;

  await new Promise<void>((resolve) => setTimeout(resolve, OFFER_DELAY_MS));
  if (!isActive()) {
    offered.delete(userId);
    return;
  }

  let pushEnabled = true;
  try {
    const prefs = await rpc("notifications/preferences");
    pushEnabled = prefs.push;
  } catch {
    offered.delete(userId);
    return;
  }
  if (!isActive()) {
    offered.delete(userId);
    return;
  }

  const permission = await readPushOsPermission();
  if (!isActive()) {
    offered.delete(userId);
    return;
  }

  if (permission === "granted") {
    await grantPushPermissionConsent(userId);
    await markPushConsentPromptSeen(userId);
    await registerPushToken({ requestPermission: true }).catch(() => undefined);
    return;
  }
  if (permission === "denied") {
    await markPushConsentPromptSeen(userId);
    return;
  }
  if (
    !shouldOfferPushConsentPrompt({
      userId,
      permission,
      pushEnabled,
      promptSeen: false,
    })
  ) {
    return;
  }

  Alert.alert(
    t("Stay in the loop"),
    t("Get notified when a bot needs you or finishes important work."),
    [
      {
        text: t("Not now"),
        style: "cancel",
        onPress: () => {
          void markPushConsentPromptSeen(userId);
        },
      },
      {
        text: t("Enable notifications"),
        onPress: () => {
          void (async () => {
            await markPushConsentPromptSeen(userId);
            await grantPushPermissionConsent(userId);
            await rpc("notifications/updatePreferences", { inApp: true, push: true }).catch(
              () => undefined,
            );
            await registerPushToken({ requestPermission: true }).catch(() => undefined);
            if (Platform.OS === "ios" && (await readPushOsPermission()) === "denied") {
              void Linking.openSettings().catch(() => undefined);
            }
          })();
        },
      },
    ],
  );
}

/** Test-only: forget in-process offer state. */
export function resetPushConsentForTests(): void {
  offered.clear();
}
