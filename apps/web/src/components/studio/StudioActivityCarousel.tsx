import { useLingui } from "@lingui/react/macro";
import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { StudioCard } from "../../lib/studio-activity";

/**
 * A sideways strip of the latest messages and actions, shown above the composer when the
 * chat itself is hidden behind a whiteboard or app. The newest card stays in view.
 */
export function StudioActivityCarousel({
  cards,
  running,
  onOpen,
}: {
  cards: readonly StudioCard[];
  running: boolean;
  onOpen: () => void;
}) {
  const { t } = useLingui();
  const scroller = useRef<HTMLDivElement>(null);
  const live = running && !cards.some((card) => card.live);
  const shown: StudioCard[] = live
    ? [...cards, { id: "working", who: "action", text: t`Working…`, live: true }]
    : [...cards];

  const signature = shown.map((card) => `${card.id}:${card.live}`).join("|");
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTo({ left: node.scrollWidth, behavior: "smooth" });
  }, [signature]);

  if (!shown.length) return null;

  const who = (card: StudioCard) =>
    card.live ? t`Now` : card.who === "you" ? t`You` : card.who === "agent" ? t`Reply` : t`Action`;

  return (
    <div ref={scroller} className="rk-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
      <div className="sr-only">{t`Recent messages and actions`}</div>
      {shown.map((card) => (
        <button
          key={card.id}
          type="button"
          data-haptic="tap"
          data-testid="studio-activity-card"
          data-live={card.live || undefined}
          onClick={onOpen}
          className={`flex w-[min(240px,70vw)] shrink-0 snap-start flex-col gap-0.5 rounded-2xl border px-3 py-2 text-left shadow-sm ${
            card.live
              ? "border-primary/30 bg-primary/10"
              : "border-foreground/[0.08] bg-card/95 backdrop-blur"
          }`}
        >
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            {card.live ? (
              <Loader2 className="size-3 animate-spin text-primary" aria-hidden="true" />
            ) : null}
            {who(card)}
          </span>
          <span className="truncate text-[13px] text-foreground">{card.text}</span>
        </button>
      ))}
    </div>
  );
}

/** How far the board sits above a closed chat: the composer, plus the strip when it is showing. */
export function studioChromeClass(chatOpen: boolean, showActivity: boolean): string {
  if (chatOpen) return "bottom-0";
  return showActivity ? "bottom-[9.25rem]" : "bottom-[72px]";
}
