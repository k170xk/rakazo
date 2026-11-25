/**
 * Capacitor-shell AI data-sharing consent (Guideline 5.1.2(i)).
 * Browser and Electron builds are no-ops. Prompt UI lives in AiConsentDialog.
 */

import type { AiConsentStatus, AiDataUse, AiRecipient, SettingsScope } from "@rakazo/contracts";
import { aiConsentTarget, ensureAiDataConsent } from "@rakazo/core";

type CapacitorBridge = {
  isNativePlatform?: () => boolean;
};

type ConsentPromptRequest = {
  recipient: AiRecipient;
  privacyUrl?: string;
  resolve: (allowed: boolean) => void;
};

type ConsentTarget = {
  botId?: string;
  groupId?: string;
  routineId?: string;
  settingsScope?: SettingsScope;
};

let nativeOverride: boolean | null = null;
let promptRequest: ConsentPromptRequest | null = null;
/** Stable snapshot for useSyncExternalStore — must not allocate on every read. */
let promptSnapshot: {
  recipient: AiRecipient;
  privacyUrl?: string;
} | null = null;
const promptListeners = new Set<() => void>();

function capacitor(): CapacitorBridge | undefined {
  return (globalThis as { Capacitor?: CapacitorBridge }).Capacitor;
}

function notifyPromptListeners() {
  for (const listener of promptListeners) listener();
}

function setPromptRequest(next: ConsentPromptRequest | null) {
  promptRequest = next;
  promptSnapshot = next
    ? {
        recipient: next.recipient,
        ...(next.privacyUrl ? { privacyUrl: next.privacyUrl } : {}),
      }
    : null;
  notifyPromptListeners();
}

/** Test-only override. Pass `null` to restore real Capacitor detection. */
export function setCapacitorNativeForTest(value: boolean | null) {
  nativeOverride = value;
}

/** True only inside the Capacitor native shell. */
export function isCapacitorNative(): boolean {
  if (nativeOverride !== null) return nativeOverride;
  return Boolean(capacitor()?.isNativePlatform?.());
}

export function subscribeAiConsentPrompt(listener: () => void): () => void {
  promptListeners.add(listener);
  return () => {
    promptListeners.delete(listener);
  };
}

export function getAiConsentPrompt(): {
  recipient: AiRecipient;
  privacyUrl?: string;
} | null {
  return promptSnapshot;
}

export function answerAiConsentPrompt(allowed: boolean) {
  if (!promptRequest) return;
  const { resolve } = promptRequest;
  setPromptRequest(null);
  resolve(allowed);
}

/** Opens the React consent dialog and resolves with the person's choice. */
export function promptCapacitorAiConsent(
  recipient: AiRecipient,
  privacyUrl?: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (promptRequest) {
      // A newer prompt replaces a stranded one so the UI cannot get stuck open.
      promptRequest.resolve(false);
    }
    setPromptRequest({
      recipient,
      ...(privacyUrl ? { privacyUrl } : {}),
      resolve,
    });
  });
}

export function capacitorAiConsentCoalesceKey(spaceId: string | null | undefined): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return [origin, spaceId ?? ""].join("\u0000");
}

/** Clears an open prompt between tests. */
export function resetCapacitorAiConsentForTest() {
  if (promptRequest) {
    promptRequest.resolve(false);
    promptRequest = null;
    promptSnapshot = null;
  }
  promptListeners.clear();
  nativeOverride = null;
}

/**
 * Before a Capacitor action that can send personal data to a third-party AI provider,
 * disclose recipients and obtain Allow. No-op outside the Capacitor shell.
 */
export async function ensureCapacitorAiConsent(options: {
  uses: AiDataUse[];
  target?: ConsentTarget;
  spaceId?: string | null;
  status: (query: {
    uses: AiDataUse[];
    botId?: string;
    groupId?: string;
    routineId?: string;
    settingsScope?: SettingsScope;
  }) => Promise<AiConsentStatus>;
  allow: (input: {
    scope: string;
    version: string;
    keys: string[];
    settingsScope?: SettingsScope;
  }) => Promise<unknown>;
}) {
  if (!isCapacitorNative() || options.uses.length === 0) return;
  const target = options.target ?? {};
  await ensureAiDataConsent({
    uses: options.uses,
    coalesceKey: capacitorAiConsentCoalesceKey(options.spaceId),
    status: () =>
      options.status({
        uses: options.uses,
        ...(target.botId ? { botId: target.botId } : {}),
        ...(target.groupId ? { groupId: target.groupId } : {}),
        ...(target.routineId ? { routineId: target.routineId } : {}),
        ...(target.settingsScope ? { settingsScope: target.settingsScope } : {}),
      }),
    prompt: promptCapacitorAiConsent,
    allow: (input) =>
      options.allow(
        target.settingsScope ? { ...input, settingsScope: target.settingsScope } : input,
      ),
  });
}

export { aiConsentTarget };
