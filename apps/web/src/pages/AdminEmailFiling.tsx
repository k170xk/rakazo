import { Trans, useLingui } from "@lingui/react/macro";
import type { CompanyAdminState, EmailFilingPolicy } from "@rakazo/contracts";
import {
  Button,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
  Switch,
  toast,
} from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(Math.round(value) || min, min), max);

/** The company's rules for Outlook email filing, shown beside the switch while it is on. */
export function EmailFilingPolicySection({
  state,
  onSaved,
}: {
  state: CompanyAdminState;
  onSaved: (next: CompanyAdminState) => Promise<void>;
}) {
  const { t } = useLingui();
  const [draft, setDraft] = useState<EmailFilingPolicy>(state.emailFiling);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(state.emailFiling), [state.emailFiling]);

  const changed = JSON.stringify(draft) !== JSON.stringify(state.emailFiling);
  const folderValid =
    draft.defaultParentFolder.trim() !== "" && !/[\\/]/.test(draft.defaultParentFolder);

  async function save() {
    setSaving(true);
    try {
      await onSaved(
        await rpc.companyAdmin.setTools({
          emailFiling: {
            ...draft,
            minConfidence: clamp(draft.minConfidence, 50, 99),
            maxPerBatch: clamp(draft.maxPerBatch, 5, 100),
            defaultParentFolder: draft.defaultParentFolder.trim(),
          },
        }),
      );
      toast.success(t`Email filing settings saved`);
    } catch (err) {
      toast.error(errorText(err, t`Could not save the email filing settings`));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4" data-testid="admin-email-filing">
      <div>
        <h2 className="text-base font-medium">
          <Trans>Email filing</Trans>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          <Trans>
            Filing always waits for each person to press File; assistants cannot move email on their
            own. People can raise their own confidence bar in Settings, but not lower it below
            yours.
          </Trans>
        </p>
      </div>
      <div className="grid gap-5 rounded-xl border border-border p-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="filing-min-confidence">
            <Trans>Lowest confidence for Ready</Trans>
          </FieldLabel>
          <Input
            id="filing-min-confidence"
            type="number"
            min={50}
            max={99}
            value={draft.minConfidence}
            onChange={(event) => setDraft({ ...draft, minConfidence: Number(event.target.value) })}
          />
          <FieldDescription>
            <Trans>
              Emails at or above this start ticked on the card. Less certain ones wait for the
              person to choose a folder.
            </Trans>
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="filing-batch">
            <Trans>Most emails per card</Trans>
          </FieldLabel>
          <Input
            id="filing-batch"
            type="number"
            min={5}
            max={100}
            value={draft.maxPerBatch}
            onChange={(event) => setDraft({ ...draft, maxPerBatch: Number(event.target.value) })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="filing-sent">
            <Trans>Sent Items</Trans>
          </FieldLabel>
          <NativeSelect
            id="filing-sent"
            value={draft.sentItems}
            onChange={(event) =>
              setDraft({
                ...draft,
                sentItems: event.target.value as EmailFilingPolicy["sentItems"],
              })
            }
          >
            <NativeSelectOption value="off">{t`Inbox only`}</NativeSelectOption>
            <NativeSelectOption value="optional">
              {t`Inbox; each person may add Sent Items`}
            </NativeSelectOption>
            <NativeSelectOption value="on">{t`Inbox and Sent Items for everyone`}</NativeSelectOption>
          </NativeSelect>
          <FieldDescription>
            <Trans>
              Most people only file incoming email, so Sent Items is off for each person until they
              add it.
            </Trans>
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="filing-parent">
            <Trans>Folder for new project folders</Trans>
          </FieldLabel>
          <Input
            id="filing-parent"
            value={draft.defaultParentFolder}
            maxLength={120}
            aria-invalid={!folderValid}
            onChange={(event) => setDraft({ ...draft, defaultParentFolder: event.target.value })}
          />
          <FieldDescription>
            <Trans>
              Created once under each person's Inbox when first needed, unless they chose their own
              folder in Settings.
            </Trans>
          </FieldDescription>
        </Field>
        <div className="flex items-center gap-4 sm:col-span-2">
          <label htmlFor="filing-create" className="min-w-0 flex-1 cursor-pointer">
            <span className="block text-sm font-medium">
              <Trans>Create missing project folders</Trans>
            </span>
            <span className="block text-[13px] text-muted-foreground">
              <Trans>
                When an email is about an Evolve project with no folder yet, the card proposes one
                named from Evolve's job number and title. It is made only when the person presses
                File, and never twice.
              </Trans>
            </span>
          </label>
          <Switch
            id="filing-create"
            checked={draft.allowFolderCreation}
            onCheckedChange={(checked) => setDraft({ ...draft, allowFolderCreation: checked })}
          />
        </div>
        <div className="sm:col-span-2">
          <Button
            type="button"
            disabled={!changed || !folderValid || saving}
            onClick={() => void save()}
          >
            {saving ? <Trans>Saving…</Trans> : <Trans>Save email filing</Trans>}
          </Button>
        </div>
      </div>
    </section>
  );
}
