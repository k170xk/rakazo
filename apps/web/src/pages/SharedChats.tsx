import { Trans, useLingui } from "@lingui/react/macro";
import type { SharedGroup, ThreadMessage, ThreadSnapshot } from "@rakazo/contracts";
import { BotAvatar, Button, GroupAvatar, Textarea } from "@rakazo/ui-web";
import { ArrowLeft, ArrowUp, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PersonAvatar } from "../components/GroupPeople";
import { authClient } from "../lib/auth";
import { rpc, rpcForSpace } from "../lib/rpc";
import { reduceThreadSnapshot } from "../lib/thread-events";
import { errorText } from "../lib/user-error";
import { MessageView } from "./shell/message-view";

const noop = () => {};
const iconLink =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground";
const asyncNoop = async () => {};

/** Group chats other people own that you were added to; their bots answer you in safe mode. */
export function SharedChatsPage() {
  const { spaceId, groupId } = useParams();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<SharedGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLingui();

  useEffect(() => {
    rpc.groups
      .shared(undefined, { context: { spaceId: null } })
      .then(setGroups)
      .catch((cause) => {
        setGroups([]);
        setError(errorText(cause, t`Could not load your shared chats`));
      });
  }, [t]);

  useEffect(() => {
    const first = groups?.[0];
    if (!groupId && first && window.matchMedia("(min-width: 768px)").matches) {
      navigate(`/shared/${first.spaceId}/${first.id}`, { replace: true });
    }
  }, [groups, groupId, navigate]);

  const open = groups?.find((group) => group.id === groupId && group.spaceId === spaceId);

  return (
    <div className="flex h-dvh min-h-0 bg-background text-foreground">
      <aside
        className={`w-full shrink-0 flex-col border-e border-border md:flex md:w-72 ${
          groupId ? "hidden" : "flex"
        }`}
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <Link to="/app" aria-label={t`Back to your chats`} className={iconLink}>
            <ArrowLeft size={16} />
          </Link>
          <h1 className="text-base font-semibold">
            <Trans>Shared with you</Trans>
          </h1>
        </div>
        {error ? <p className="px-4 text-sm text-destructive">{error}</p> : null}
        {groups && groups.length === 0 && !error ? (
          <p className="px-4 text-sm text-muted-foreground">
            <Trans>Nobody has added you to a group chat yet.</Trans>
          </p>
        ) : null}
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-4">
          {groups?.map((group) => {
            const active = group.id === groupId;
            return (
              <Link
                key={group.id}
                to={`/shared/${group.spaceId}/${group.id}`}
                className={`flex items-center gap-3 rounded-xl px-2.5 py-2.5 ${
                  active ? "bg-accent" : "hover:bg-accent"
                }`}
              >
                <GroupAvatar members={group.members} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]" dir="auto">
                    {group.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    <Trans>Owned by {group.ownerName}</Trans>
                  </span>
                </span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className={`min-w-0 flex-1 flex-col ${groupId ? "flex" : "hidden md:flex"}`}>
        {open ? (
          <SharedGroupThread key={open.id} group={open} />
        ) : groupId && groups ? (
          <p className="m-auto text-sm text-muted-foreground">
            <Trans>This chat is no longer shared with you.</Trans>
          </p>
        ) : null}
      </main>
    </div>
  );
}

function SharedGroupThread({ group }: { group: SharedGroup }) {
  const { t } = useLingui();
  const me = authClient.useSession().data?.user.id;
  const client = useMemo(() => rpcForSpace(group.spaceId), [group.spaceId]);
  const [snapshot, setSnapshot] = useState<ThreadSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const snapshotRef = useRef<ThreadSnapshot | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  snapshotRef.current = snapshot;

  useEffect(() => {
    const abort = new AbortController();
    const follow = async () => {
      while (!abort.signal.aborted) {
        try {
          const loaded = await client.threads.get({ groupId: group.id });
          if (abort.signal.aborted) return;
          setSnapshot(loaded);
          setError(null);
          const events = await client.threads.subscribe(
            { groupId: group.id, cursor: loaded.cursor },
            { signal: abort.signal },
          );
          for await (const event of events) {
            if (event.type === "heartbeat") continue;
            setSnapshot((previous) => reduceThreadSnapshot(previous, event));
          }
        } catch (cause) {
          if (abort.signal.aborted) return;
          setError(errorText(cause, t`Lost the connection. Reconnecting…`));
          await new Promise((resolve) => setTimeout(resolve, 3_000));
        }
      }
    };
    void follow();
    return () => abort.abort();
  }, [client, group.id, t]);

  const messageCount = snapshot?.messages.length ?? 0;
  useEffect(() => {
    if (messageCount === 0) return;
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [messageCount]);

  const people = snapshot?.people;
  const members = snapshot?.members ?? group.members;
  const authorName = useCallback(
    (message: ThreadMessage) => {
      if (message.role !== "user") return undefined;
      if (message.authorUserId === me) return t`You`;
      const author = message.authorUserId
        ? people?.find((person) => person.userId === message.authorUserId)
        : people?.find((person) => person.owner);
      return author?.name ?? (message.authorUserId ? t`A colleague` : group.ownerName);
    },
    [me, people, group.ownerName, t],
  );
  const memberName = useCallback(
    (botId: string | undefined) => members.find((member) => member.botId === botId)?.name,
    [members],
  );
  const peerBot = useCallback(
    (botId: string) => members.find((member) => member.botId === botId),
    [members],
  );
  const working = snapshot?.activeRuns?.length
    ? (snapshot.activeRuns
        .map((run) => memberName(run.botId))
        .filter(Boolean)
        .join(", ") ?? "")
    : "";

  const send = async () => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    try {
      await client.threads.send({
        groupId: group.id,
        text: message,
        clientNonce: crypto.randomUUID(),
      });
      setText("");
    } catch (cause) {
      setError(errorText(cause, t`Could not send that message`));
    } finally {
      setSending(false);
    }
  };

  const artifactTarget = useMemo(
    () => ({ groupId: group.id, spaceId: group.spaceId }),
    [group.id, group.spaceId],
  );

  return (
    <>
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link to="/shared" aria-label={t`Back`} className={`${iconLink} md:hidden`}>
          <ArrowLeft size={16} />
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold" dir="auto">
            {group.name}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            <Trans>Owned by {group.ownerName}</Trans>
          </p>
        </div>
        <div className="flex items-center -space-x-1.5">
          {members.map((member) => (
            <BotAvatar
              key={member.botId}
              color={member.color}
              avatarSet={member.avatarSet}
              identity={member.botId}
              size={26}
            />
          ))}
          {people
            ?.filter((person) => person.userId !== me)
            .map((person) => (
              <span key={person.userId} title={person.name}>
                <PersonAvatar name={person.name} image={person.image} size={26} />
              </span>
            ))}
        </div>
      </header>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {snapshot?.messages.map((message) => (
            <div
              key={message.id}
              className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}
            >
              <MessageView
                artifactTarget={artifactTarget}
                canAnswer={false}
                canDismiss={false}
                message={message}
                onAnswer={asyncNoop}
                onOpenBot={noop}
                onOpenPeerMessages={noop}
                speakerName={message.role === "bot" ? memberName(message.botId) : undefined}
                authorName={authorName(message)}
                memberName={memberName}
                peerBot={peerBot}
                onRefresh={asyncNoop}
                onBotChanged={asyncNoop}
                onAddRoutine={noop}
                voiceReady={false}
                speaking={false}
                onSpeak={noop}
                onOpenComputer={noop}
                rpc={client}
                showToolActivity={false}
                onReply={noop}
                onMarkUnread={noop}
                onReact={asyncNoop}
              />
            </div>
          ))}
          {snapshot && snapshot.messages.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">
              <Trans>No messages yet. Say hello to the team.</Trans>
            </p>
          ) : null}
        </div>
      </div>
      <footer className="border-t border-border px-4 py-3">
        <div className="mx-auto max-w-3xl">
          {working ? (
            <p className="mb-2 text-xs text-muted-foreground">
              <Trans>{working} is working…</Trans>
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mb-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={t`Message ${group.name}. Use @Name to ask one bot.`}
              aria-label={t`Message`}
              rows={1}
              className="max-h-40 min-h-11 resize-none"
            />
            <Button
              type="submit"
              size="icon"
              disabled={sending || !text.trim()}
              aria-label={t`Send`}
            >
              <ArrowUp size={18} />
            </Button>
          </form>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck size={13} aria-hidden="true" />
            <Trans>
              Bots answer you with the web, cards and files, without {group.ownerName}'s private
              memory, logins or apps.
            </Trans>
          </p>
        </div>
      </footer>
    </>
  );
}
