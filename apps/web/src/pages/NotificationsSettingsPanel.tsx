import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, NotificationPreferences } from "@rakazo/contracts";
import { writeSaved } from "@rakazo/core/query";
import { Button, Switch } from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsGroup, SettingsRow } from "../components/SettingsRows";
import type { BrowserNotificationPermission } from "../lib/browser-notifications";
import { requestBrowserNotificationPermission } from "../lib/browser-notifications";
import {
  nativePushAvailable,
  nativePushPermissionState,
  openNativePushSettings,
  requestNativePushPermission,
  syncNativePushUser,
} from "../lib/capacitor-push";
import { useQueryUserId, useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

const PREFERENCE_DEFAULTS: NotificationPreferences = {
  inApp: true,
  push: true,
  actionNeeded: true,
  updates: true,
  problems: true,
};

async function readOsPermission(): Promise<BrowserNotificationPermission | undefined> {
  if (nativePushAvailable()) return nativePushPermissionState();
  if (typeof Notification === "undefined") return undefined;
  return Notification.permission;
}

/** Channels, categories, and per-bot completion toggles for the signed-in user. */
export function NotificationsSettingsPanel() {
  const { t } = useLingui();
  const userId = useQueryUserId();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const prefsOptions = queries.notifications.preferences.queryOptions();
  const botsOptions = queries.bots.list.queryOptions();
  const prefsQuery = useQuery(prefsOptions);
  const botsQuery = useQuery(botsOptions);
  const prefs = prefsQuery.data ?? PREFERENCE_DEFAULTS;
  const bots = botsQuery.data ?? [];
  const [permission, setPermission] = useState<BrowserNotificationPermission | undefined>();
  const [botsOpen, setBotsOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const loadFailed = prefsQuery.error ?? botsQuery.error;
  const error =
    actionError ??
    (loadFailed ? errorText(loadFailed, t`Couldn't load notification settings`) : null);
  const native = nativePushAvailable();
  const pushDenied = permission === "denied";

  useEffect(() => {
    let cancelled = false;
    void readOsPermission().then((next) => {
      if (!cancelled) setPermission(next);
    });
    const onFocus = () => {
      void readOsPermission().then((next) => {
        if (!cancelled) setPermission(next);
      });
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  async function savePrefs(
    patch: Partial<NotificationPreferences>,
    key: string,
    after?: (next: NotificationPreferences) => Promise<void>,
  ) {
    if (busyKey) return;
    setBusyKey(key);
    setActionError(null);
    try {
      const next = await rpc.notifications.updatePreferences(patch);
      await writeSaved(queryClient, prefsOptions.queryKey, () => next);
      await after?.(next);
    } catch (err) {
      setActionError(errorText(err, t`Couldn't update notification settings`));
    } finally {
      setBusyKey(null);
    }
  }

  async function enablePushChannel() {
    await savePrefs({ push: true }, "push", async () => {
      let current = await readOsPermission();
      if (current === "default") {
        if (native) await requestNativePushPermission();
        else await requestBrowserNotificationPermission();
        current = await readOsPermission();
      }
      setPermission(current);
      if (current === "granted" && userId) {
        await syncNativePushUser(userId).catch(() => undefined);
      }
    });
  }

  async function saveBotNotify(bot: Bot, notifyOnFinish: boolean) {
    const key = `bot:${bot.id}`;
    if (busyKey) return;
    setBusyKey(key);
    setActionError(null);
    try {
      const saved = await rpc.bots.update({ botId: bot.id, notifyOnFinish });
      await writeSaved(queryClient, botsOptions.queryKey, (current) =>
        (current ?? []).map((item) => (item.id === saved.id ? saved : item)),
      );
    } catch (err) {
      setActionError(errorText(err, t`Couldn't update bot notifications`));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-8" data-testid="notifications-settings">
      {error ? (
        <p className="text-[13px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <SettingsGroup title={t`Channels`}>
        <SettingsRow
          label={<Trans>In-app notifications</Trans>}
          control={
            <Switch
              aria-label={t`In-app notifications`}
              checked={prefs.inApp}
              disabled={busyKey !== null || prefsQuery.isPending}
              onCheckedChange={(checked) => void savePrefs({ inApp: checked }, "inApp")}
            />
          }
        />
        {pushDenied ? (
          <SettingsRow
            label={
              <div>
                <p>
                  <Trans>Push notifications</Trans>
                </p>
                <p className="text-[12.5px] text-muted-foreground">
                  <Trans>Blocked in system settings</Trans>
                </p>
              </div>
            }
            control={
              native ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  data-testid="notifications-open-device-settings"
                  disabled={busyKey !== null}
                  onClick={() => void openNativePushSettings()}
                >
                  <Trans>Open device settings</Trans>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <SettingsRow
            label={<Trans>Push notifications</Trans>}
            control={
              <Switch
                aria-label={t`Push notifications`}
                checked={prefs.push}
                disabled={busyKey !== null || prefsQuery.isPending || permission === undefined}
                onCheckedChange={(checked) => {
                  if (checked) void enablePushChannel();
                  else void savePrefs({ push: false }, "push");
                }}
              />
            }
          />
        )}
      </SettingsGroup>

      <SettingsGroup title={t`Notify me about`}>
        <SettingsRow
          label={<Trans>Action needed</Trans>}
          control={
            <Switch
              aria-label={t`Action needed`}
              checked={prefs.actionNeeded}
              disabled={busyKey !== null || prefsQuery.isPending}
              onCheckedChange={(checked) => void savePrefs({ actionNeeded: checked }, "actionNeeded")}
            />
          }
        />
        <SettingsRow
          label={<Trans>Updates</Trans>}
          control={
            <Switch
              aria-label={t`Updates`}
              checked={prefs.updates}
              disabled={busyKey !== null || prefsQuery.isPending}
              onCheckedChange={(checked) => void savePrefs({ updates: checked }, "updates")}
            />
          }
        />
        <SettingsRow
          label={<Trans>Problems</Trans>}
          control={
            <Switch
              aria-label={t`Problems`}
              checked={prefs.problems}
              disabled={busyKey !== null || prefsQuery.isPending}
              onCheckedChange={(checked) => void savePrefs({ problems: checked }, "problems")}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title={t`Bot updates`} data-testid="notifications-bot-updates">
        <div className="px-4 py-3">
          <button
            type="button"
            data-testid="notifications-choose-bots"
            aria-expanded={botsOpen}
            className="flex w-full items-center justify-between gap-3 text-start text-[14px] text-foreground"
            onClick={() => setBotsOpen((open) => !open)}
          >
            <span>
              <Trans>Choose bots</Trans>
            </span>
            {botsOpen ? (
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
              <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
            )}
          </button>
        </div>
        {botsOpen && bots.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-muted-foreground" data-testid="notifications-bot-list">
            <Trans>No bots yet</Trans>
          </p>
        ) : null}
        {botsOpen
          ? bots.map((bot) => (
              <SettingsRow
                key={bot.id}
                label={<p className="break-words">{bot.name}</p>}
                control={
                  <Switch
                    aria-label={t`Notify when ${bot.name} finishes or needs you`}
                    checked={bot.notifyOnFinish}
                    disabled={busyKey !== null || botsQuery.isPending}
                    onCheckedChange={(checked) => void saveBotNotify(bot, checked)}
                  />
                }
              />
            ))
          : null}
      </SettingsGroup>
    </div>
  );
}
