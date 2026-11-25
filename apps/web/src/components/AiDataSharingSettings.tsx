import { Trans, useLingui } from "@lingui/react/macro";
import type { AiConsentStatus, AiDataUse, AiRecipient } from "@rakazo/contracts";
import { AI_PRIVACY_URL } from "@rakazo/contracts";
import {
  aiDataSharingPlaceholder,
  aiPrivacyLinks,
  groupAiRecipients,
} from "@rakazo/core";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Switch,
} from "@rakazo/ui-web";
import { useCallback, useEffect, useState } from "react";
import { promptCapacitorAiConsent } from "../lib/capacitor-ai-consent";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { SettingsGroup, SettingsRow } from "./SettingsRows";

function useLabel(use: AiDataUse) {
  const { t } = useLingui();
  switch (use) {
    case "model":
      return t`AI models`;
    case "voice":
      return t`Voice`;
    case "memory":
      return t`Memory`;
    default: {
      const _exhaustive: never = use;
      return _exhaustive;
    }
  }
}

function DataUseFooter({ use }: { use: AiDataUse }) {
  switch (use) {
    case "model":
      return (
        <Trans>
          Messages, chat history, agent instructions, memories, attachments, screenshots and
          connected-app content are sent to run your agents, including routines.
        </Trans>
      );
    case "voice":
      return (
        <Trans>
          Your recordings are sent for transcription, and text you play is sent to generate speech.
        </Trans>
      );
    case "memory":
      return (
        <Trans>
          Conversation summaries, memories, searches and agent and Space IDs are sent to store and
          recall context.
        </Trans>
      );
    default: {
      const _exhaustive: never = use;
      return _exhaustive;
    }
  }
}

function RecipientGroup({
  use,
  recipients,
  pending,
  onToggle,
}: {
  use: AiDataUse;
  recipients: AiRecipient[];
  pending: boolean;
  onToggle: (recipient: AiRecipient, allowed: boolean) => void;
}) {
  const { t } = useLingui();
  const label = useLabel(use);
  return (
    <SettingsGroup title={label}>
      {recipients.map((recipient) => (
        <SettingsRow
          key={recipient.key}
          label={
            <div>
              <p>{recipient.name}</p>
              {recipient.detail ? (
                <p className="text-[12.5px] text-muted-foreground">{recipient.detail}</p>
              ) : null}
            </div>
          }
          control={
            <Switch
              aria-label={t`Allow ${recipient.name} on mobile`}
              checked={recipient.allowed}
              disabled={pending}
              onCheckedChange={(checked) => onToggle(recipient, checked)}
              data-testid={`ai-data-sharing-toggle-${recipient.key}`}
            />
          }
        />
      ))}
      <div className="px-4 py-3 text-[12.5px] text-muted-foreground">
        <DataUseFooter use={use} />
      </div>
    </SettingsGroup>
  );
}

/**
 * Capacitor Account settings for reviewing and withdrawing AI data-sharing permissions.
 */
export function AiDataSharingSettings() {
  const { t } = useLingui();
  const [status, setStatus] = useState<AiConsentStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const placeholder = aiDataSharingPlaceholder(status, loadFailed);

  const reload = useCallback(() => {
    setLoadFailed(false);
    setError(null);
    void rpc.aiConsent
      .status({})
      .then(setStatus)
      .catch((cause: unknown) => {
        setLoadFailed(true);
        setError(errorText(cause, t`Could not load permissions.`));
      });
  }, [t]);

  useEffect(() => {
    reload();
  }, [reload]);

  function setAllowed(recipient: AiRecipient, allowed: boolean) {
    if (!status) return;
    setPending(true);
    setError(null);
    void (async () => {
      if (!allowed) {
        setStatus(await rpc.aiConsent.revoke({ key: recipient.key }));
        return;
      }
      if (!(await promptCapacitorAiConsent(recipient, status.privacyUrl))) return;
      setStatus(
        await rpc.aiConsent.allow({
          scope: status.scope,
          version: status.version,
          keys: [recipient.key],
        }),
      );
    })()
      .catch((cause: unknown) => {
        setError(errorText(cause, t`Could not update permissions.`));
      })
      .finally(() => setPending(false));
  }

  function withdrawAll() {
    setPending(true);
    setError(null);
    void rpc.aiConsent
      .revoke({ key: null })
      .then(setStatus)
      .catch((cause: unknown) => {
        setError(errorText(cause, t`Could not update permissions.`));
      })
      .finally(() => {
        setPending(false);
        setWithdrawOpen(false);
      });
  }

  return (
    <div className="space-y-6" data-testid="ai-data-sharing-settings">
      <h3 className="px-1 text-[14px] font-medium text-foreground">
        <Trans>AI data sharing</Trans>
      </h3>
      {placeholder === "loading" ? (
        <p className="px-1 text-[13px] text-muted-foreground">
          <Trans>Loading…</Trans>
        </p>
      ) : null}
      {placeholder === "failed" ? (
        <div className="space-y-2 px-1">
          <p className="text-[13px] text-destructive" role="alert">
            {error ?? <Trans>Could not load permissions.</Trans>}
          </p>
          <Button variant="outline" size="sm" onClick={reload}>
            <Trans>Retry</Trans>
          </Button>
        </div>
      ) : null}
      {placeholder === "empty" ? (
        <p className="px-1 text-[13px] text-muted-foreground">
          <Trans>No AI services configured.</Trans>
        </p>
      ) : null}
      {status && status.recipients.length > 0 ? (
        <>
          {groupAiRecipients(status.recipients).map((group) => (
            <RecipientGroup
              key={group.use}
              use={group.use}
              recipients={group.recipients}
              pending={pending}
              onToggle={setAllowed}
            />
          ))}
          <SettingsGroup title={<Trans>Privacy policies</Trans>}>
            {aiPrivacyLinks(status.recipients).map(({ name, url }) => (
              <SettingsRow
                key={JSON.stringify([name, url])}
                label={name}
                control={
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] text-foreground underline underline-offset-2"
                  >
                    <Trans>Open</Trans>
                  </a>
                }
              />
            ))}
            <SettingsRow
              label={<Trans>OCSC Intelligence</Trans>}
              control={
                <a
                  href={status.privacyUrl ?? AI_PRIVACY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] text-foreground underline underline-offset-2"
                  data-testid="ai-data-sharing-privacy"
                >
                  <Trans>Open</Trans>
                </a>
              }
            />
          </SettingsGroup>
          <SettingsGroup>
            <SettingsRow
              label={<Trans>Withdraw all permissions</Trans>}
              control={
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  disabled={pending}
                  data-testid="ai-data-sharing-withdraw-all"
                  onClick={() => setWithdrawOpen(true)}
                >
                  <Trans>Withdraw</Trans>
                </Button>
              }
            />
          </SettingsGroup>
        </>
      ) : null}
      {error && placeholder !== "failed" ? (
        <p className="px-1 text-[13px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <AlertDialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <AlertDialogContent data-testid="ai-data-sharing-withdraw-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Withdraw all permissions?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>
                New mobile actions won&apos;t send data to these services. Runs already in progress
                and routines keep going until you stop them.
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              <Trans>Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              data-testid="ai-data-sharing-withdraw-confirm"
              onClick={(event) => {
                event.preventDefault();
                withdrawAll();
              }}
            >
              <Trans>Withdraw</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
