import { useLingui } from "@lingui/react/macro";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@rakazo/ui-web";
import { History, Loader2, MessageSquare, User, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { StudioCard } from "../../lib/studio-activity";

/** The newest settled card; a later one than the viewer last saw lights the button's dot. */
function newestId(cards: readonly StudioCard[]): string | undefined {
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    if (!cards[index]!.live) return cards[index]!.id;
  }
  return undefined;
}

function useStudioActivityOpen(cards: readonly StudioCard[]) {
  const [open, setOpen] = useState(false);
  const latest = newestId(cards);
  const [seen, setSeen] = useState(latest);
  const unseen = latest !== undefined && latest !== seen && !open;
  useEffect(() => {
    if (open) setSeen(latest);
  }, [open, latest]);
  return { open, setOpen, unseen };
}

function StudioActivityList({
  cards,
  running,
  onOpen,
  onPick,
}: {
  cards: readonly StudioCard[];
  running: boolean;
  onOpen: () => void;
  onPick: () => void;
}) {
  const { t } = useLingui();
  const list = useRef<HTMLDivElement>(null);
  const shown: StudioCard[] =
    running && !cards.some((card) => card.live)
      ? [...cards, { id: "working", who: "action", text: t`Working…`, live: true }]
      : [...cards];

  const who = (card: StudioCard) =>
    card.live ? t`Now` : card.who === "you" ? t`You` : card.who === "agent" ? t`Reply` : t`Action`;
  const Icon = (card: StudioCard) =>
    card.live ? Loader2 : card.who === "you" ? User : card.who === "agent" ? MessageSquare : Wrench;

  return (
    <PopoverContent
      side="top"
      align="start"
      sideOffset={8}
      collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
      initialFocus={() => list.current?.lastElementChild as HTMLElement | null}
      className="w-[min(340px,calc(100vw-24px))] gap-1 p-1.5"
    >
      <div className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground">
        {t`Recent messages and actions`}
      </div>
      <div ref={list} className="flex max-h-[200px] flex-col overflow-y-auto">
        {shown.map((card) => {
          const CardIcon = Icon(card);
          return (
            <button
              key={card.id}
              type="button"
              data-haptic="tap"
              data-testid="studio-activity-row"
              data-live={card.live || undefined}
              onClick={() => {
                onPick();
                onOpen();
              }}
              className="flex h-8 w-full shrink-0 items-center gap-2 rounded-md px-2 text-start text-[13px] outline-none hover:bg-accent focus-visible:bg-accent"
            >
              <CardIcon
                size={14}
                strokeWidth={1.8}
                aria-hidden="true"
                className={`shrink-0 ${card.live ? "animate-spin text-primary" : "text-muted-foreground"}`}
              />
              <span className="w-12 shrink-0 truncate text-[11px] font-medium text-muted-foreground">
                {who(card)}
              </span>
              <span dir="auto" className="min-w-0 flex-1 truncate text-foreground">
                {card.text}
              </span>
            </button>
          );
        })}
      </div>
    </PopoverContent>
  );
}

function ActivityMarks({ running, unseen }: { running: boolean; unseen: boolean }) {
  const { t } = useLingui();
  return (
    <>
      {running ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-px animate-spin rounded-full border-2 border-primary/15 border-t-primary"
        />
      ) : null}
      {running ? <span className="sr-only">{t`Working…`}</span> : null}
      {unseen ? (
        <span className="absolute end-1.5 top-1.5 size-2 rounded-full bg-primary ring-2 ring-card">
          <span className="sr-only">{t`New`}</span>
        </span>
      ) : null}
    </>
  );
}

/**
 * A round button beside the floating composer that opens the latest messages and actions,
 * while the chat itself is hidden behind a whiteboard, document or app. Choosing one opens the chat.
 */
export function StudioActivityButton({
  cards,
  running,
  onOpen,
  className = "",
}: {
  cards: readonly StudioCard[];
  running: boolean;
  onOpen: () => void;
  className?: string;
}) {
  const { t } = useLingui();
  const { open, setOpen, unseen } = useStudioActivityOpen(cards);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-haptic="tap"
        data-testid="studio-activity-button"
        data-running={running || undefined}
        data-unseen={unseen || undefined}
        aria-label={t`Recent messages and actions`}
        title={t`Recent messages and actions`}
        className={`relative grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card/85 text-muted-foreground shadow-[0_10px_30px_-12px_rgb(0_0_0/0.3)] backdrop-blur-xl transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:text-foreground ${className}`}
      >
        <History size={18} strokeWidth={1.8} aria-hidden="true" />
        <ActivityMarks running={running} unseen={unseen} />
      </PopoverTrigger>
      {open ? (
        <StudioActivityList
          cards={cards}
          running={running}
          onOpen={onOpen}
          onPick={() => setOpen(false)}
        />
      ) : null}
    </Popover>
  );
}

/**
 * History control for the composer's plus tray on phones: same list as the round dock button,
 * without stealing width from the message field.
 */
export function StudioActivityToolsItem({
  cards,
  running,
  onOpen,
  onOpened,
}: {
  cards: readonly StudioCard[];
  running: boolean;
  onOpen: () => void;
  /** Folds the plus tray away once this popover is open (trigger stays laid out). */
  onOpened?: () => void;
}) {
  const { t } = useLingui();
  const { open, setOpen, unseen } = useStudioActivityOpen(cards);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) onOpened?.();
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="outline" size="icon" className="relative size-8 shrink-0 rounded-full" />
        }
        data-haptic="tap"
        data-testid="studio-activity-tools-item"
        data-running={running || undefined}
        data-unseen={unseen || undefined}
        aria-label={t`Recent messages and actions`}
        title={t`Recent messages and actions`}
      >
        <History size={16} strokeWidth={2} aria-hidden="true" />
        <ActivityMarks running={running} unseen={unseen} />
      </PopoverTrigger>
      {open ? (
        <StudioActivityList
          cards={cards}
          running={running}
          onOpen={onOpen}
          onPick={() => setOpen(false)}
        />
      ) : null}
    </Popover>
  );
}

/**
 * Spinning ring and unread dot for the composer's Add (+) button while recent studio activity
 * lives behind that menu on phones.
 */
export function StudioActivityPlusMarks({
  cards,
  running,
  toolsOpen,
}: {
  cards: readonly StudioCard[];
  running: boolean;
  toolsOpen: boolean;
}) {
  const latest = newestId(cards);
  const [seen, setSeen] = useState(latest);
  useEffect(() => {
    if (toolsOpen) setSeen(latest);
  }, [toolsOpen, latest]);
  const unseen = latest !== undefined && latest !== seen && !toolsOpen;
  return <ActivityMarks running={running} unseen={unseen} />;
}

/**
 * One slim line above the floating composer while the assistant works, naming its latest action.
 * It stays mounted so it can fold away when the run ends.
 */
export function StudioWorkingLine({
  cards,
  running,
  onOpen,
}: {
  cards: readonly StudioCard[];
  running: boolean;
  onOpen: () => void;
}) {
  const { t } = useLingui();
  const live = cards.findLast((card) => card.live)?.text;
  const last = useRef(live);
  if (running) last.current = live;
  const text = (running ? live : last.current) || t`Working…`;

  return (
    <div
      data-testid="studio-working-line"
      data-running={running || undefined}
      aria-hidden={!running}
      inert={!running}
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
        running ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
    >
      <div className="flex min-h-0 justify-center overflow-hidden">
        <button
          type="button"
          data-haptic="tap"
          onClick={onOpen}
          className="mb-1 flex h-6 max-w-full items-center gap-1.5 rounded-full border border-foreground/[0.08] bg-background/85 px-2.5 text-[12px] text-foreground shadow-[0_4px_14px_-8px_rgb(0_0_0/0.3)] backdrop-blur-md"
        >
          <Loader2 className="size-3 shrink-0 animate-spin text-primary" aria-hidden="true" />
          <span dir="auto" className="truncate" role="status">
            {text}
          </span>
        </button>
      </div>
    </div>
  );
}
