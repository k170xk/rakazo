import { Trans, useLingui } from "@lingui/react/macro";
import type { GroupPeople } from "@rakazo/contracts";
import { Button, Input, SectionHeading } from "@rakazo/ui-web";
import { Mail, UserRound, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { rpcForSpace } from "../lib/rpc";
import { errorText } from "../lib/user-error";

/** Colleagues the owner adds by work email; they chat with the group's bots in safe mode. */
export function GroupPeopleSection({ groupId, spaceId }: { groupId: string; spaceId: string }) {
  const { t } = useLingui();
  const emailId = useId();
  const [people, setPeople] = useState<GroupPeople | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = rpcForSpace(spaceId);

  useEffect(() => {
    let cancelled = false;
    client.groups
      .people({ groupId })
      .then((loaded) => {
        if (!cancelled) setPeople(loaded);
      })
      .catch((cause) => {
        if (!cancelled) setError(errorText(cause, t`Could not load people`));
      });
    return () => {
      cancelled = true;
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

  const add = async () => {
    const trimmed = email.trim();
    if (!trimmed || busy) return;
    const added = await run(
      () => client.groups.addPerson({ groupId, email: trimmed }),
      t`Could not add that email`,
    );
    if (added) setEmail("");
  };

  return (
    <section className="mt-6" aria-labelledby={`${emailId}-heading`}>
      <SectionHeading variant="label" className="mb-1" id={`${emailId}-heading`}>
        <Trans>People</Trans>
      </SectionHeading>
      <p className="mb-3 text-sm text-muted-foreground">
        <Trans>
          Colleagues chat with this group's bots. Bots answer them without your memory, notes, saved
          logins or connected apps.
        </Trans>
      </p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <Input
          id={emailId}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t`Work email`}
          aria-label={t`Colleague's work email`}
          autoComplete="off"
        />
        <Button type="submit" disabled={busy || !email.trim()}>
          <Trans>Add</Trans>
        </Button>
      </form>
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
