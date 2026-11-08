import { Trans, useLingui } from "@lingui/react/macro";
import type { CompanyAdminState } from "@rakazo/contracts";
import { Switch, toast } from "@rakazo/ui-web";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { VaultSettings } from "../components/VaultSettings";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { VoiceSettingsOverlay } from "./VoiceSettingsOverlay";

/** Voice for the whole company: on or off for everyone, and the one connection they all use. */
export function CompanyVoiceSection({
  state,
  onSaved,
}: {
  state: CompanyAdminState;
  onSaved: (next: CompanyAdminState) => Promise<void>;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const me = useQuery(queries.me.queryOptions());
  const [busy, setBusy] = useState(false);
  const voiceOn = state.features.voice;
  const { sharedBy, provider } = state.voice;
  const sharedByMe = Boolean(sharedBy && sharedBy.userId === me.data?.userId);

  async function run(action: () => Promise<CompanyAdminState>) {
    setBusy(true);
    try {
      await onSaved(await action());
    } catch (err) {
      toast.error(errorText(err, t`Could not update voice`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="voice" className="scroll-mt-6 space-y-4" data-testid="company-voice">
      <div>
        <h2 className="text-base font-medium">
          <Trans>Voice</Trans>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          <Trans>
            Spoken replies, dictation and calls. Staff never set voice up themselves: everyone uses
            the connection shared here.
          </Trans>
        </p>
      </div>

      <div className="flex items-center gap-4 rounded-xl border border-border px-4 py-3">
        <label htmlFor="company-voice-on" className="min-w-0 flex-1 cursor-pointer">
          <span className="block text-sm font-medium">
            <Trans>Voice for everyone</Trans>
          </span>
          <span className="block text-[13px] text-muted-foreground">
            <Trans>Off hides voice, dictation and calls for every member, admins included.</Trans>
          </span>
        </label>
        <Switch
          id="company-voice-on"
          checked={voiceOn}
          disabled={busy}
          onCheckedChange={(on) => void run(() => rpc.companyAdmin.setFeatures({ voice: on }))}
        />
      </div>

      {voiceOn ? (
        <>
          <p className="text-[13px] text-muted-foreground" data-testid="company-voice-status">
            {sharedBy ? (
              provider ? (
                <Trans>
                  Everyone uses {sharedBy.name}'s {provider} connection.
                </Trans>
              ) : (
                <Trans>
                  {sharedBy.name} shares their voice connection, but it has been removed. Connect
                  one again below.
                </Trans>
              )
            ) : (
              <Trans>No connection is shared yet, so staff have no voice.</Trans>
            )}
          </p>
          <div className="rounded-xl border border-border px-4 py-4">
            <h3 className="mb-3 text-sm font-medium">
              <Trans>Your voice connection</Trans>
            </h3>
            <VoiceSettingsOverlay embedded scope="account" onClose={() => undefined} />
          </div>
          <div className="flex items-center gap-4 rounded-xl border border-border px-4 py-3">
            <label htmlFor="company-voice-share" className="min-w-0 flex-1 cursor-pointer">
              <span className="block text-sm font-medium">
                <Trans>Share my connection with everyone</Trans>
              </span>
              <span className="block text-[13px] text-muted-foreground">
                <Trans>
                  Members use it with the voice you picked, and their use is billed to this
                  connection's account.
                </Trans>
              </span>
            </label>
            <Switch
              id="company-voice-share"
              checked={sharedByMe}
              disabled={busy}
              onCheckedChange={(share) => void run(() => rpc.companyAdmin.shareVoice({ share }))}
            />
          </div>
        </>
      ) : null}
    </section>
  );
}

/** Logins, API keys and command variables every member's assistants can use. */
export function CompanyVaultSection() {
  return (
    <section id="vault" className="scroll-mt-6 space-y-4" data-testid="company-vault">
      <div>
        <h2 className="text-base font-medium">
          <Trans>Company vault</Trans>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          <Trans>
            Logins, API keys and variables every member's assistants can use, for shared company
            accounts. Members see each item's name, never its value; one of their own with the same
            name is used instead. Anyone with a full computer can run commands with these variables,
            so add only what you would trust them with. Cards and contacts stay in each person's own
            vault.
          </Trans>
        </p>
      </div>
      <VaultSettings company />
    </section>
  );
}
