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
    <div
      ref={scroller}
      className="-mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="sr-only">{t`Recent messages and actions`}</div>
      {shown.map((card) => (
        <button
          key={card.id}
          type="button"
          data-haptic="tap"
          data-testid="studio-activity-card"
          data-live={card.live || undefined}
          onClick={onOpen}
          className={`flex w-[min(220px,62vw)] shrink-0 snap-start flex-col rounded-xl border px-2.5 py-1.5 text-left shadow-[0_4px_16px_-8px_rgb(0_0_0/0.25)] backdrop-blur-md ${
            card.live
              ? "border-primary/25 bg-primary/10 dark:bg-primary/15"
              : "border-foreground/[0.08] bg-background/75 hover:bg-background/90"
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
