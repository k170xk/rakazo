import { Trans, useLingui } from "@lingui/react/macro";
import type { DirectoryPerson, GroupPeople } from "@rakazo/contracts";
import { Button, Input, SectionHeading } from "@rakazo/ui-web";
import { Mail, Search, UserRound, X } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { rpcForSpace } from "../lib/rpc";
import { errorText } from "../lib/user-error";

/** Colleagues the owner adds by work email; they chat with the group's bots in safe mode. */
export function GroupPeopleSection({ groupId, spaceId }: { groupId: string; spaceId: string }) {
  const { t } = useLingui();
  const emailId = useId();
  const [people, setPeople] = useState<GroupPeople | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = rpcForSpace(spaceId);

  useEffect(() => {
    let cancelled = false;
    // Invites turn into people when the colleague first opens the app, so look again on return.
    const load = () =>
      client.groups
        .people({ groupId })
        .then((loaded) => {
          if (!cancelled) setPeople(loaded);
        })
        .catch((cause) => {
          if (!cancelled) setError(errorText(cause, t`Could not load people`));
        });
    void load();
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
    };
  }, [client, groupId, t]);

  const run = async (change: () => Promise<GroupPeople>, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      setPeople(await change());
      return true;
    } catch (cause) {
      setError(errorText(cause, failure));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const searchDirectory = useCallback(
    (query: string) => client.groups.searchDirectory({ groupId, query }),
    [client, groupId],
  );

  const add = async (address: string) => {
    const trimmed = address.trim();
    if (!trimmed || busy) return false;
    return run(
      () => client.groups.addPerson({ groupId, email: trimmed }),
      t`Could not add that person`,
    );
  };

  return (
    <section className="mt-6" aria-labelledby={`${emailId}-heading`}>
      <SectionHeading variant="label" className="mb-1" id={`${emailId}-heading`}>
        <Trans>People</Trans>
      </SectionHeading>
      <p className="mb-3 text-sm text-muted-foreground">
        <Trans>
          Colleagues chat with this group's bots. Bots answer them without your memory, notes, saved
          logins or connectors.
        </Trans>
      </p>
      <PeoplePicker inputId={emailId} busy={busy} search={searchDirectory} onPick={add} />
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ul className="mt-3 space-y-1">
        {people?.people.map((person) => (
          <li
            key={person.userId}
            className="flex items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-accent"
          >
            <PersonAvatar name={person.name} image={person.image} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] text-foreground" dir="auto">
                {person.name}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {person.owner ? <Trans>Owner</Trans> : person.email}
              </span>
            </span>
            {person.owner ? null : (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t`Remove ${person.name}`}
                disabled={busy}
                onClick={() =>
                  void run(
                    () => client.groups.removePerson({ groupId, userId: person.userId }),
                    t`Could not remove that person`,
                  )
                }
              >
                <X size={16} />
              </Button>
            )}
          </li>
        ))}
        {people?.invites.map((invite) => (
          <li key={invite.email} className="flex items-center gap-3 rounded-xl px-2.5 py-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Mail size={15} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] text-foreground">{invite.email}</span>
              <span className="block truncate text-xs text-muted-foreground">
                <Trans>Joins when they open OCSC Intelligence from Evolve</Trans>
              </span>
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Cancel the invite for ${invite.email}`}
              disabled={busy}
              onClick={() =>
                void run(
                  () => client.groups.removePerson({ groupId, email: invite.email }),
                  t`Could not cancel that invite`,
                )
              }
            >
              <X size={16} />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SEARCH_DELAY_MS = 250;

export type DirectoryResult = { available: boolean; people: DirectoryPerson[] };

/** Search-as-you-type over active Evolve profiles; a typed work email still works as a fallback. */
export function PeoplePicker({
  inputId,
  busy,
  search,
  onPick,
}: {
  inputId: string;
  busy: boolean;
  search: (query: string) => Promise<DirectoryResult>;
  onPick: (email: string, person: DirectoryPerson | null) => Promise<boolean>;
}) {
  const { t } = useLingui();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<DirectoryResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const trimmed = query.trim();
  useEffect(() => {
    if (trimmed.length < 2) {
      setResult(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      search(trimmed)
        .then((found) => {
          if (!cancelled) setResult(found);
        })
        .catch(() => {
          if (!cancelled) setResult({ available: false, people: [] });
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, trimmed]);

  const typedEmail = EMAIL_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
  const people = result?.people ?? [];
  const options: { email: string; person: DirectoryPerson | null }[] = [
    ...people.map((person) => ({ email: person.email, person })),
    ...(typedEmail && !people.some((person) => person.email === typedEmail)
      ? [{ email: typedEmail, person: null }]
      : []),
  ];
  const pickable = (option: (typeof options)[number]) => option.person?.status == null;

  const pick = async (option: (typeof options)[number] | undefined) => {
    if (!option || !pickable(option) || busy) return;
    if (await onPick(option.email, option.person)) {
      setQuery("");
      setResult(null);
      setOpen(false);
    }
  };

  const showList = open && trimmed.length >= 2;
  const activeOption = options[Math.min(highlight, options.length - 1)];

  return (
    <div className="relative">
      <div className="relative">
        <Search
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={inputId}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            showList && activeOption ? `${listId}-${activeOption.email}` : undefined
          }
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setHighlight((index) => Math.min(index + 1, Math.max(options.length - 1, 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlight((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              void pick(activeOption);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={t`Search Evolve people`}
          aria-label={t`Search Evolve people to add`}
          autoComplete="off"
          className="ps-9"
        />
      </div>
      {showList ? (
        <div
          id={listId}
          role="listbox"
          aria-label={t`Evolve people`}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {options.map((option, index) => {
            const person = option.person;
            const disabled = !pickable(option) || busy;
            return (
              <div
                key={option.email}
                id={`${listId}-${option.email}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === highlight}
                aria-disabled={disabled}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void pick(option);
                }}
                className={`flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 ${
                  index === highlight ? "bg-accent" : ""
                } ${disabled ? "cursor-default opacity-60" : ""}`}
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void pick(option)}
              >
                {person ? (
                  <PersonAvatar name={person.name} image={person.photo} />
                ) : (
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Mail size={15} aria-hidden="true" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-foreground" dir="auto">
                    {person ? person.name : t`Invite ${option.email}`}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {person
                      ? [person.jobTitle, person.office, person.email].filter(Boolean).join(" · ")
                      : t`Not found in Evolve; joins if they sign in with this email`}
                  </span>
                </span>
                {person?.status === "member" ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    <Trans>Added</Trans>
                  </span>
                ) : person?.status === "invited" ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    <Trans>Invited</Trans>
                  </span>
                ) : person && !person.canOpen ? (
                  <span
                    className="shrink-0 text-xs text-warning"
                    title={t`Give them OCSC Intelligence in Evolve's menu access so they can open the chat`}
                  >
                    <Trans>No access yet</Trans>
                  </span>
                ) : null}
              </div>
            );
          })}
          {options.length === 0 ? (
            <p className="px-2.5 py-3 text-sm text-muted-foreground">
              {searching || !result ? (
                <Trans>Searching Evolve…</Trans>
              ) : result && !result.available ? (
                <Trans>Evolve search is unavailable. Type a full work email instead.</Trans>
              ) : (
                <Trans>No active Evolve profile matches.</Trans>
              )}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function PersonAvatar({
  name,
  image,
  size = 32,
}: {
  name: string;
  image: string | null;
  size?: number;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  if (image) {
    return (
      <img
        src={image}
        alt=""
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-success/15 font-semibold text-success"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials || <UserRound size={Math.round(size * 0.5)} />}
    </span>
  );
}
