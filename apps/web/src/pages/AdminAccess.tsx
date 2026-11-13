import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { AccessGroup, Audience, CompanyAdminState } from "@rakazo/contracts";
import { Badge, Button, Input, NativeSelect, NativeSelectOption, toast } from "@rakazo/ui-web";
import { X } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

type Person = CompanyAdminState["computers"]["people"][number];

function personLabel(person: Person | undefined, userId: string) {
  return person ? person.name || person.email : userId;
}

/** Chips for the chosen people, with a picker that adds anyone not yet chosen. */
function PeoplePicker({
  userIds,
  people,
  disabled,
  addLabel,
  groups,
  groupIds,
  onChange,
}: {
  userIds: string[];
  people: Person[];
  disabled: boolean;
  addLabel: string;
  groups?: AccessGroup[];
  groupIds?: string[];
  onChange: (next: { userIds: string[]; groupIds: string[] }) => void;
}) {
  const { t } = useLingui();
  const chosenGroups = groupIds ?? [];
  const byId = new Map(people.map((person) => [person.userId, person]));
  const addableGroups = (groups ?? []).filter((group) => !chosenGroups.includes(group.id));
  const addablePeople = people.filter((person) => !userIds.includes(person.userId));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chosenGroups.map((id) => {
        const name = groups?.find((group) => group.id === id)?.name ?? id;
        return (
          <Badge key={`g:${id}`} variant="secondary" className="gap-1">
            {name}
            <button
              type="button"
              aria-label={t`Remove ${name}`}
              disabled={disabled}
              onClick={() =>
                onChange({ userIds, groupIds: chosenGroups.filter((other) => other !== id) })
              }
            >
              <X className="size-3" />
            </button>
          </Badge>
        );
      })}
      {userIds.map((id) => {
        const name = personLabel(byId.get(id), id);
        return (
          <Badge key={`u:${id}`} variant="outline" className="gap-1">
            {name}
            <button
              type="button"
              aria-label={t`Remove ${name}`}
              disabled={disabled}
              onClick={() =>
                onChange({
                  userIds: userIds.filter((other) => other !== id),
                  groupIds: chosenGroups,
                })
              }
            >
              <X className="size-3" />
            </button>
          </Badge>
        );
      })}
      {addableGroups.length + addablePeople.length > 0 ? (
        <NativeSelect
          aria-label={addLabel}
          value=""
          disabled={disabled}
          className="w-auto"
          onChange={(event) => {
            const [kind, id] = [event.target.value.slice(0, 2), event.target.value.slice(2)];
            if (!id) return;
            if (kind === "g:") onChange({ userIds, groupIds: [...chosenGroups, id] });
            else onChange({ userIds: [...userIds, id], groupIds: chosenGroups });
          }}
        >
          <NativeSelectOption value="">{addLabel}</NativeSelectOption>
          {addableGroups.map((group) => (
            <NativeSelectOption key={group.id} value={`g:${group.id}`}>
              {t`Group: ${group.name}`}
            </NativeSelectOption>
          ))}
          {addablePeople.map((person) => (
            <NativeSelectOption key={person.userId} value={`u:${person.userId}`}>
              {person.name ? `${person.name} (${person.email})` : person.email}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : null}
    </div>
  );
}

/** Who may use one switch or app: everyone, or only the chosen people and groups. */
export function AudienceControl({
  name,
  audience,
  state,
  disabled,
  onChange,
}: {
  name: string;
  audience: Audience | undefined;
  state: CompanyAdminState;
  disabled: boolean;
  onChange: (next: Audience | undefined) => Promise<void>;
}) {
  const { t } = useLingui();
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted-foreground">
          <Trans>Who can use it</Trans>
        </span>
        <NativeSelect
          aria-label={t`Who can use ${name}`}
          value={audience ? "chosen" : "everyone"}
          disabled={disabled}
          className="w-auto"
          onChange={(event) =>
            void onChange(
              event.target.value === "chosen" ? { userIds: [], groupIds: [] } : undefined,
            )
          }
        >
          <NativeSelectOption value="everyone">{t`Everyone`}</NativeSelectOption>
          <NativeSelectOption value="chosen">{t`Only people I choose`}</NativeSelectOption>
        </NativeSelect>
      </div>
      {audience ? (
        <>
          <PeoplePicker
            userIds={audience.userIds}
            groupIds={audience.groupIds}
            groups={state.access.groups}
            people={state.computers.people}
            disabled={disabled}
            addLabel={t`Add a person or group`}
            onChange={(next) => void onChange(next)}
          />
          {audience.userIds.length + audience.groupIds.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              <Trans>Only admins can use it until you add someone.</Trans>
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Named sets of staff, such as Developers, that features and apps can be opened to. */
export function AccessGroupsSection({
  state,
  onSaved,
}: {
  state: CompanyAdminState;
  onSaved: (next: CompanyAdminState) => Promise<void>;
}) {
  const { t } = useLingui();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const groups = state.access.groups;

  async function save(next: AccessGroup[]) {
    setBusy(true);
    try {
      await onSaved(await rpc.companyAdmin.setTools({ accessGroups: next }));
      return true;
    } catch (err) {
      toast.error(errorText(err, t`Could not update the group`));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (await save([...groups, { id: crypto.randomUUID(), name: trimmed, userIds: [] }])) {
      setName("");
    }
  }

  return (
    <div className="space-y-2">
      <h3 className="px-1 text-sm font-medium">
        <Trans>Groups</Trans>
      </h3>
      <p className="px-1 text-[13px] text-muted-foreground">
        <Trans>
          Put people in groups, such as Developers, then open a feature or app to a group on the
          Features page. Removing someone from a group takes their access away within a few seconds.
          Admins can always use everything.
        </Trans>
      </p>
      {groups.length > 0 ? (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {groups.map((group) => (
            <li key={group.id} className="space-y-2 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{group.name}</span>
                <span className="text-[13px] text-muted-foreground">
                  <Plural value={group.userIds.length} one="# person" other="# people" />
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void save(groups.filter((other) => other.id !== group.id))}
                >
                  <Trans>Delete</Trans>
                </Button>
              </div>
              <PeoplePicker
                userIds={group.userIds}
                people={state.computers.people}
                disabled={busy}
                addLabel={t`Add a person`}
                onChange={(next) =>
                  void save(
                    groups.map((other) =>
                      other.id === group.id ? { ...other, userIds: next.userIds } : other,
                    ),
                  )
                }
              />
            </li>
          ))}
        </ul>
      ) : null}
      <form onSubmit={(event) => void add(event)} className="flex gap-2">
        <Input
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          aria-label={t`New group name`}
          placeholder={t`New group, for example Developers`}
        />
        <Button type="submit" variant="outline" disabled={busy || !name.trim()}>
          <Trans>Add group</Trans>
        </Button>
      </form>
    </div>
  );
}
