import type { Bot, NotificationPreferences } from "@rakazo/contracts";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
} from "react-native";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSwitch,
  useStackedSettings,
} from "../../components/settings-group";
import {
  currentApiBase,
  loadSessionToken,
  rpc,
  selectedSpaceId,
  type MobileMe,
} from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import type { LiveNotificationSettings } from "../../lib/live-notifications";
import {
  canPostPromotedNotifications,
  DEFAULT_LIVE_NOTIFICATION_SETTINGS,
  getLiveNotificationSettings,
  hasLiveUpdateSettings,
  openLiveNotificationSettings,
  openPromotedNotificationSettings,
  setLiveNotificationSettings,
} from "../../lib/live-notifications";
import { native, useThemedStyles } from "../../lib/native";
import { registerPushToken, unregisterPushToken } from "../../lib/push";
import type { PushOsPermission } from "../../lib/push-consent";
import {
  grantPushPermissionConsent,
  markPushConsentPromptSeen,
  readPushOsPermission,
} from "../../lib/push-consent";
import { createQueuedSave } from "../../lib/queued-save";
import { useSideInsets } from "../../lib/side-insets";
import { errorText } from "../../lib/user-error";

const PREFERENCE_DEFAULTS: NotificationPreferences = {
  inApp: true,
  push: true,
  actionNeeded: true,
  updates: true,
  problems: true,
};

/** Channels, categories, per-bot completion toggles, and Android live delivery. */
export default function NotificationsSettings() {
  const sideInsets = useSideInsets();
  const { t } = useI18n();
  const stacked = useStackedSettings();
  const styles = useThemedStyles(createStyles);
  const [me, setMe] = useState<Pick<MobileMe, "userId"> | null>(null);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [botsOpen, setBotsOpen] = useState(false);
  const [permission, setPermission] = useState<PushOsPermission | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveNotificationSettings>(DEFAULT_LIVE_NOTIFICATION_SETTINGS);
  const [liveReady, setLiveReady] = useState(Platform.OS !== "android");
  const [liveError, setLiveError] = useState<string | null>(null);
  const liveQueue = useRef<ReturnType<typeof createQueuedSave<LiveNotificationSettings>> | null>(
    null,
  );
  const loading = prefs === null || bots === null || permission === null;

  const refreshPermission = useCallback(() => {
    void readPushOsPermission()
      .then(setPermission)
      .catch(() => setPermission("default"));
  }, []);

  useEffect(() => {
    void rpc("me")
      .then((next) => setMe({ userId: next.userId }))
      .catch(() => undefined);
    void rpc("notifications/preferences")
      .then(setPrefs)
      .catch((cause: unknown) => {
        setPrefs(PREFERENCE_DEFAULTS);
        setError(errorText(cause, t("Could not load notification settings")));
      });
    void rpc("bots/list")
      .then(setBots)
      .catch((cause: unknown) => {
        setBots([]);
        setError((current) => current ?? errorText(cause, t("Could not load notification settings")));
      });
    if (Platform.OS === "android") {
      void getLiveNotificationSettings()
        .then(setLive)
        .catch(() => undefined)
        .finally(() => setLiveReady(true));
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      refreshPermission();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") refreshPermission();
      });
      return () => subscription.remove();
    }, [refreshPermission]),
  );

  async function savePrefs(patch: Partial<NotificationPreferences>, key: string) {
    if (busyKey) return;
    setBusyKey(key);
    setError(null);
    const previous = prefs ?? PREFERENCE_DEFAULTS;
    setPrefs({ ...previous, ...patch });
    try {
      const next = await rpc("notifications/updatePreferences", patch);
      setPrefs(next);
      if (patch.push === true) {
        const userId = me?.userId;
        if (userId) {
          await markPushConsentPromptSeen(userId);
          await grantPushPermissionConsent(userId);
        }
        await registerPushToken({ requestPermission: true });
        refreshPermission();
      } else if (patch.push === false) {
        await unregisterPushToken();
      }
    } catch (cause) {
      setPrefs(previous);
      setError(errorText(cause, t("Could not update notification settings")));
    } finally {
      setBusyKey(null);
    }
  }

  async function enablePushChannel() {
    await savePrefs({ push: true }, "push");
  }

  async function saveBotNotify(bot: Bot, notifyOnFinish: boolean) {
    const key = `bot:${bot.id}`;
    if (busyKey) return;
    setBusyKey(key);
    setError(null);
    setBots((current) =>
      (current ?? []).map((item) => (item.id === bot.id ? { ...item, notifyOnFinish } : item)),
    );
    try {
      const saved = await rpc("bots/update", { botId: bot.id, notifyOnFinish });
      setBots((current) =>
        (current ?? []).map((item) => (item.id === saved.id ? { ...item, ...saved } : item)),
      );
    } catch (cause) {
      setBots((current) =>
        (current ?? []).map((item) =>
          item.id === bot.id ? { ...item, notifyOnFinish: bot.notifyOnFinish } : item,
        ),
      );
      setError(errorText(cause, t("Could not update bot notifications")));
    } finally {
      setBusyKey(null);
    }
  }

  function updateLive(next: LiveNotificationSettings) {
    liveQueue.current ??= createQueuedSave(live, {
      onChange: setLive,
      equals: (a, b) =>
        a.liveConnection === b.liveConnection &&
        a.messages === b.messages &&
        a.scheduledTasks === b.scheduledTasks &&
        a.needsAttention === b.needsAttention,
      save: async (settings) => {
        await setLiveNotificationSettings(
          settings,
          currentApiBase(),
          await loadSessionToken(),
          selectedSpaceId() ?? "",
        );
      },
      onSaved: async (settings) => {
        if (settings.liveConnection && !(await canPostPromotedNotifications())) {
          await openPromotedNotificationSettings();
        }
        const userId = me?.userId;
        if (userId) await grantPushPermissionConsent(userId);
        await registerPushToken({ requestPermission: true });
      },
      onError: (cause) => setLiveError(errorText(cause, t("Could not update notifications"))),
    });
    setLiveError(null);
    liveQueue.current.update(next);
  }

  const current = prefs ?? PREFERENCE_DEFAULTS;
  const pushDenied = permission === "denied";

  return (
    <ScrollView
      style={[styles.screen, sideInsets]}
      contentContainerStyle={[styles.container, stacked && styles.compactContainer]}
      contentInsetAdjustmentBehavior="automatic"
    >
      {loading ? <ActivityIndicator /> : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <SettingsGroup label={t("Channels")}>
        <SettingsSwitch
          label={t("In-app notifications")}
          value={current.inApp}
          disabled={busyKey !== null || loading}
          onChange={(inApp) => void savePrefs({ inApp }, "inApp")}
        />
        {pushDenied ? (
          <SettingsRow
            title={t("Push notifications")}
            detail={t("Blocked in system settings")}
            accessibilityRole="button"
            onPress={() => {
              if (Platform.OS === "android") void openLiveNotificationSettings();
              else void Linking.openSettings();
            }}
          />
        ) : (
          <SettingsSwitch
            label={t("Push notifications")}
            value={current.push}
            disabled={busyKey !== null || loading}
            onChange={(checked) => {
              if (checked) void enablePushChannel();
              else void savePrefs({ push: false }, "push");
            }}
          />
        )}
      </SettingsGroup>

      <SettingsGroup label={t("Notify me about")}>
        <SettingsSwitch
          label={t("Action needed")}
          value={current.actionNeeded}
          disabled={busyKey !== null || loading}
          onChange={(actionNeeded) => void savePrefs({ actionNeeded }, "actionNeeded")}
        />
        <SettingsSwitch
          label={t("Updates")}
          value={current.updates}
          disabled={busyKey !== null || loading}
          onChange={(updates) => void savePrefs({ updates }, "updates")}
        />
        <SettingsSwitch
          label={t("Problems")}
          value={current.problems}
          disabled={busyKey !== null || loading}
          onChange={(problems) => void savePrefs({ problems }, "problems")}
        />
      </SettingsGroup>

      <SettingsGroup label={t("Bot updates")}>
        <SettingsRow
          title={t("Choose bots")}
          accessibilityRole="button"
          accessibilityState={{ expanded: botsOpen }}
          chevron={botsOpen ? "down" : "right"}
          onPress={() => setBotsOpen((open) => !open)}
        />
        {botsOpen ? (
          bots && bots.length > 0 ? (
            bots.map((bot) => (
              <SettingsSwitch
                key={bot.id}
                label={bot.name}
                value={bot.notifyOnFinish}
                disabled={busyKey !== null || loading}
                onChange={(notifyOnFinish) => void saveBotNotify(bot, notifyOnFinish)}
              />
            ))
          ) : (
            <SettingsRow title={t("No bots yet")} />
          )
        ) : null}
      </SettingsGroup>

      {Platform.OS === "android" ? (
        <SettingsGroup accessibilityLabel={t("Live delivery")} label={t("Live delivery")}>
          {permission === "denied" ? (
            <SettingsRow
              accessibilityRole="button"
              detail={t("Android blocked notifications.")}
              onPress={() => void openLiveNotificationSettings()}
              title={t("Notifications")}
            />
          ) : null}
          <SettingsSwitch
            label={t("Live working status")}
            value={live.liveConnection}
            disabled={!liveReady}
            onChange={(liveConnection) => void updateLive({ ...live, liveConnection })}
          />
          <SettingsSwitch
            label={t("Agent messages")}
            detail={t("Replies and completed work")}
            value={live.messages}
            disabled={!liveReady}
            onChange={(messages) => void updateLive({ ...live, messages })}
          />
          <SettingsSwitch
            label={t("Scheduled tasks")}
            value={live.scheduledTasks}
            disabled={!liveReady}
            onChange={(scheduledTasks) => void updateLive({ ...live, scheduledTasks })}
          />
          <SettingsSwitch
            label={t("Needs attention")}
            detail={t("Questions, approvals, takeover")}
            value={live.needsAttention}
            disabled={!liveReady}
            onChange={(needsAttention) => void updateLive({ ...live, needsAttention })}
          />
          {hasLiveUpdateSettings() ? (
            <SettingsRow
              accessibilityRole="button"
              onPress={() => void openPromotedNotificationSettings()}
              title={t("Live update settings")}
            />
          ) : null}
          <SettingsRow
            accessibilityRole="button"
            onPress={() => void openLiveNotificationSettings()}
            title={t("Notification settings")}
          />
          {liveError ? <Text style={styles.error}>{liveError}</Text> : null}
        </SettingsGroup>
      ) : null}
    </ScrollView>
  );
}

function createStyles() {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: native.groupedPage },
    container: { paddingVertical: 24, gap: 24 },
    compactContainer: { paddingVertical: 16, gap: 16 },
    error: { color: native.destructive, paddingHorizontal: 20, fontSize: 13 },
  });
}
