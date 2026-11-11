import { Trans, useLingui } from "@lingui/react/macro";
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
  Field,
  FieldLabel,
  Input,
} from "@rakazo/ui-web";
import { Plus } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { CreateOrganizationDialog } from "../components/CreateOrganizationDialog";
import { SettingsGroup, SettingsRow } from "../components/SettingsRows";
import { canDeleteOrganization } from "../lib/organization-access";
import type { Organization } from "../lib/organizations";
import { deleteOrganization, renameOrganization, useOrganizations } from "../lib/organizations";
import { useQueryUserId } from "../lib/query";
import { errorText } from "../lib/user-error";

/** The work space (organization) the app is showing: its name, and, for its owner, renaming and deletion. */
export function OrganizationSettingsPanel({
  onBusyChange,
}: {
  onBusyChange?: (busy: boolean) => void;
}) {
  const { organizations, activeOrganizationId } = useOrganizations();
  const organization = organizations.find((candidate) => candidate.id === activeOrganizationId);
  if (!organization) return null;
  return (
    <OrganizationSettings
      key={organization.id}
      organization={organization}
      canDelete={canDeleteOrganization(organization, organizations)}
      onBusyChange={onBusyChange}
    />
  );
}

function OrganizationSettings({
  organization,
  canDelete,
  onBusyChange,
}: {
  organization: Organization;
  canDelete: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const userId = useQueryUserId();
  const nameId = useId();
  const [draft, setDraft] = useState(organization.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    onBusyChange?.(pending);
  }, [pending, onBusyChange]);

  async function save() {
    const trimmed = draft.trim();
    if (pending) return;
    if (!trimmed || trimmed === organization.name) {
      setDraft(organization.name);
      setError(null);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await renameOrganization(userId, organization, trimmed);
      setDraft(trimmed);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-8" data-testid="organization-settings">
      <SettingsGroup>
        <SettingsRow
          label={
            organization.canManage ? (
              <label htmlFor={nameId}>
                <Trans>Name</Trans>
              </label>
            ) : (
              <Trans>Name</Trans>
            )
          }
          control={
            organization.canManage ? (
              <Input
                id={nameId}
                className="w-56"
                maxLength={60}
                value={draft}
                disabled={pending}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setError(null);
                }}
                onBlur={() => void save()}
                onKeyDown={(event) => {
                  if (event.key === "Escape") event.stopPropagation();
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    setDraft(organization.name);
                    setError(null);
                  }
                }}
              />
            ) : (
              <p className="break-words text-sm">{organization.name}</p>
            )
          }
        >
          {error ? (
            <p role="alert" className="pt-2 text-[12.5px] text-destructive">
              {error}
            </p>
          ) : null}
        </SettingsRow>
      </SettingsGroup>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="rounded-full" onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" />
          <Trans>Create work space</Trans>
        </Button>
        {canDelete ? (
          <Button
            variant="destructive"
            className="rounded-full"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trans>Delete work space</Trans>
          </Button>
        ) : null}
      </div>
      <CreateOrganizationDialog open={creating} onOpenChange={setCreating} />
      {confirmingDelete ? (
        <DeleteOrganizationDialog
          organization={organization}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => deleteOrganization(userId, organization)}
        />
      ) : null}
    </div>
  );
}

export function DeleteOrganizationDialog({
  organization,
  onCancel,
  onConfirm,
}: {
  organization: Organization;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useLingui();
  const confirmId = useId();
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = organization.name;
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !deleting) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">
            <Trans>Delete {organization.name}?</Trans>
          </AlertDialogTitle>
          <AlertDialogDescription>
            <Trans>
              This permanently deletes every agent, chat, message and file in it, cancels its plan
              and removes everyone else's access. This cannot be undone.
            </Trans>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <FieldLabel htmlFor={confirmId} className="break-words">
            {t`Type ${name} to confirm`}
          </FieldLabel>
          <Input
            id={confirmId}
            value={typed}
            disabled={deleting}
            autoComplete="off"
            onChange={(event) => setTyped(event.target.value)}
          />
        </Field>
        {error ? (
          <p role="alert" className="text-[13.5px] text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>
            <Trans>Cancel</Trans>
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleting || typed !== name}
            onClick={() => {
              setDeleting(true);
              setError(null);
              void onConfirm().catch((reason: unknown) => {
                setError(errorText(reason));
                setDeleting(false);
              });
            }}
          >
            {deleting ? <Trans>Deleting…</Trans> : <Trans>Delete</Trans>}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
