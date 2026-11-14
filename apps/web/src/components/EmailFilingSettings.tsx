import { Trans, useLingui } from "@lingui/react/macro";
import type { EmailFilingProfile, EmailFilingSettings as Settings } from "@rakazo/contracts";
import {
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  Spinner,
  Switch,
  toast,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { SettingsGroup, SettingsRow } from "./SettingsRows";

/** Each person's own Outlook filing choices; filing always waits for their press of File. */
export function EmailFilingSettings() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const options = queries.emailFiling.settings.get.queryOptions({ input: {} });
  const profile = useQuery(options);
  const folders = useQuery({
    ...queries.emailFiling.folders.queryOptions({ input: {} }),
    enabled: profile.data?.outlookConnected === true,
  });
  const [busy, setBusy] = useState(false);
  const [confidence, setConfidence] = useState("");
  const [sender, setSender] = useState("");

  useEffect(() => {
    if (profile.data) setConfidence(String(profile.data.settings.confidence));
  }, [profile.data]);

  async function update(patch: Partial<Settings>, rule?: string) {
    setBusy(true);
    try {
      const next: EmailFilingProfile = rule
        ? await rpc.emailFiling.settings.removeRule({ ruleId: rule })
        : await rpc.emailFiling.settings.set(patch);
      queryClient.setQueryData(options.queryKey, next);
      setConfidence(String(next.settings.confidence));
    } catch (err) {
      toast.error(errorText(err, t`Could not save your filing settings`));
    } finally {
      setBusy(false);
    }
  }

  if (profile.isPending) return <Spinner />;
  if (!profile.data) {
    return (
      <p role="alert" className="text-[13px] text-destructive">
        {errorText(profile.error, t`Could not load your filing settings`)}
      </p>
    );
  }
  const { settings, rules, policy, outlookConnected } = profile.data;
  const folderList = folders.data?.folders ?? [];
  const folderPath = (id: string) => folderList.find((folder) => folder.id === id)?.path ?? id;
  const defaultParent = t`Inbox › ${policy.defaultParentFolder}`;

  function saveConfidence() {
    const value = Math.round(Number(confidence));
    if (!Number.isFinite(value) || value === settings.confidence) {
      setConfidence(String(settings.confidence));
      return;
    }
    void update({ confidence: Math.min(Math.max(value, policy.minConfidence), 100) });
  }

  function addSender() {
    const value = sender.trim().toLowerCase();
    if (!/^([^\s@]+@[^\s@]+\.[^\s@]+|@[^\s@]+\.[^\s@]+)$/.test(value)) {
      toast.error(
        t`Enter an address such as ann@example.com, or a whole domain such as @example.com.`,
      );
      return;
    }
    setSender("");
    void update({ excludedSenders: [...new Set([...settings.excludedSenders, value])] });
  }

  return (
    <div className="space-y-6" data-testid="email-filing-settings">
      <SettingsGroup title={t`Email filing`}>
        <div className="px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
          <Trans>
            Your assistants can look through your Inbox, in chat or in a routine, and suggest a
            folder for each email. Nothing moves until you press File on the card, and Undo puts an
            email back.
          </Trans>
          {!outlookConnected ? (
            <p className="mt-2 text-foreground">
              <Trans>Connect Outlook in Connectors to use filing.</Trans>
            </p>
          ) : null}
        </div>
        <SettingsRow
          label={<Trans>Let assistants suggest filing</Trans>}
          control={
            <Switch
              aria-label={t`Let assistants suggest filing`}
              checked={settings.enabled}
              disabled={busy}
              onCheckedChange={(checked) => void update({ enabled: checked })}
            />
          }
        />
        <SettingsRow
          label={
            <div>
              <p>
                <Trans>Confidence for Ready</Trans>
              </p>
              <p className="text-[12.5px] text-muted-foreground">
                <Trans>
                  Emails at or above this start ticked. Your company's lowest is{" "}
                  {policy.minConfidence}%.
                </Trans>
              </p>
            </div>
          }
          control={
            <div className="flex items-center gap-1">
              <Input
                aria-label={t`Confidence for Ready`}
                type="number"
                className="w-20"
                min={policy.minConfidence}
                max={100}
                value={confidence}
                disabled={busy}
                onChange={(event) => setConfidence(event.target.value)}
                onBlur={saveConfidence}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveConfidence();
                }}
              />
              <span className="text-[13px] text-muted-foreground">%</span>
            </div>
          }
        />
        {policy.sentItems === "optional" ? (
          <SettingsRow
            label={
              <div>
                <p>
                  <Trans>Also file Sent Items</Trans>
                </p>
                <p className="text-[12.5px] text-muted-foreground">
                  <Trans>Off: only email you receive is suggested.</Trans>
                </p>
              </div>
            }
            control={
              <Switch
                aria-label={t`Also file Sent Items`}
                checked={settings.includeSentItems}
                disabled={busy}
                onCheckedChange={(checked) => void update({ includeSentItems: checked })}
              />
            }
          />
        ) : policy.sentItems === "on" ? (
          <SettingsRow
            label={
              <p className="text-[13px] text-muted-foreground">
                <Trans>Your company files Sent Items as well as your Inbox.</Trans>
              </p>
            }
          />
        ) : null}
        {policy.allowFolderCreation ? (
          <SettingsRow
            label={
              <div>
                <p>
                  <Trans>New project folders go in</Trans>
                </p>
                <p className="text-[12.5px] text-muted-foreground">
                  <Trans>Created once, when you first file into a new project.</Trans>
                </p>
              </div>
            }
            control={
              <NativeSelect
                aria-label={t`New project folders go in`}
                className="max-w-64"
                value={settings.parentFolderId ?? ""}
                disabled={busy || !outlookConnected || folders.isPending}
                onChange={(event) => void update({ parentFolderId: event.target.value || null })}
              >
                <NativeSelectOption value="">{defaultParent}</NativeSelectOption>
                {settings.parentFolderId &&
                !folderList.some((folder) => folder.id === settings.parentFolderId) ? (
                  <NativeSelectOption value={settings.parentFolderId}>
                    {settings.parentFolderPath ?? settings.parentFolderId}
                  </NativeSelectOption>
                ) : null}
                {folderList.map((folder) => (
                  <NativeSelectOption key={folder.id} value={folder.id}>
                    {folder.path}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            }
          />
        ) : null}
      </SettingsGroup>

      <SettingsGroup title={t`Never suggest`}>
        <SettingsRow
          label={
            <p className="text-[12.5px] text-muted-foreground">
              <Trans>Email from these senders or domains stays in your Inbox.</Trans>
            </p>
          }
        >
          <form
            className="mt-2 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              addSender();
            }}
          >
            <Input
              aria-label={t`Sender or @domain`}
              placeholder={t`ann@example.com or @example.com`}
              value={sender}
              disabled={busy}
              onChange={(event) => setSender(event.target.value)}
            />
            <Button type="submit" size="sm" variant="outline" disabled={busy || !sender.trim()}>
              <Trans>Add</Trans>
            </Button>
          </form>
          {settings.excludedSenders.length ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {settings.excludedSenders.map((entry) => (
                <li
                  key={entry}
                  className="flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-[12.5px]"
                >
                  {entry}
                  <button
                    type="button"
                    aria-label={t`Remove ${entry}`}
                    disabled={busy}
                    onClick={() =>
                      void update({
                        excludedSenders: settings.excludedSenders.filter((item) => item !== entry),
                      })
                    }
                  >
                    <XIcon className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </SettingsRow>
        <SettingsRow
          label={
            <p className="text-[12.5px] text-muted-foreground">
              <Trans>Folders never suggested as a destination.</Trans>
            </p>
          }
          control={
            <NativeSelect
              aria-label={t`Add a folder never to suggest`}
              className="max-w-64"
              value=""
              disabled={busy || !outlookConnected || folders.isPending}
              onChange={(event) =>
                event.target.value &&
                void update({
                  excludedFolderIds: [
                    ...new Set([...settings.excludedFolderIds, event.target.value]),
                  ],
                })
              }
            >
              <NativeSelectOption value="">{t`Add a folder…`}</NativeSelectOption>
              {folderList
                .filter((folder) => !settings.excludedFolderIds.includes(folder.id))
                .map((folder) => (
                  <NativeSelectOption key={folder.id} value={folder.id}>
                    {folder.path}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          }
        >
          {settings.excludedFolderIds.length ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {settings.excludedFolderIds.map((id) => (
                <li
                  key={id}
                  className="flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-[12.5px]"
                >
                  {folderPath(id)}
                  <button
                    type="button"
                    aria-label={t`Remove ${folderPath(id)}`}
                    disabled={busy}
                    onClick={() =>
                      void update({
                        excludedFolderIds: settings.excludedFolderIds.filter((item) => item !== id),
                      })
                    }
                  >
                    <XIcon className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t`What filing has learned`}>
        {rules.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-muted-foreground">
            <Trans>
              When you file an email somewhere else and choose to remember it, the choice for that
              sender, domain or conversation shows here.
            </Trans>
          </p>
        ) : (
          rules.map((rule) => (
            <SettingsRow
              key={rule.id}
              label={
                <p className="break-words text-[13px]">
                  {rule.label} <span className="text-muted-foreground">→</span> {rule.folderPath}
                </p>
              }
              control={
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={t`Forget ${rule.label}`}
                  onClick={() => void update({}, rule.id)}
                >
                  <Trans>Forget</Trans>
                </Button>
              }
            />
          ))
        )}
      </SettingsGroup>
    </div>
  );
}
