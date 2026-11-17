import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "./basic.js";
import { cn } from "./cn.js";

export type SwipeDirection = "left" | "right";

/** How far a drag has to travel, as a fraction of the card, before it counts. */
export function swipeDecision(dx: number, width: number): SwipeDirection | null {
  const need = Math.max(72, width * 0.28);
  if (dx >= need) return "right";
  if (dx <= -need) return "left";
  return null;
}

/**
 * One card at a time. A drag or the two buttons sends it left or right, then the next card
 * shows. Use it for reviews, approvals and sorting a pile (keep / pass, accept / reject).
 */
export function SwipeDeck<T>({
  items,
  render,
  onSwipe,
  leftLabel = "Pass",
  rightLabel = "Keep",
  empty,
  className,
}: {
  items: T[];
  render: (item: T, index: number) => ReactNode;
  onSwipe?: (direction: SwipeDirection, item: T, index: number) => void;
  leftLabel?: string;
  rightLabel?: string;
  empty?: ReactNode;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState(0);
  const reduced = useReducedMotion();
  const item = items[index];
  if (!item) {
    return <div className={cn("text-muted-foreground text-sm", className)}>{empty ?? "Nothing left in the pile."}</div>;
  }
  const go = (direction: SwipeDirection) => {
    onSwipe?.(direction, item, index);
    setDrag(0);
    setIndex((current) => current + 1);
  };
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <motion.div
        key={index}
        className="bg-card touch-pan-y cursor-grab rounded-xl border p-4 shadow-sm active:cursor-grabbing"
        drag={reduced ? false : "x"}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.7}
        onDrag={(_event, info) => setDrag(info.offset.x)}
        onDragEnd={(_event, info) => {
          const decision = swipeDecision(info.offset.x, 320);
          if (decision) go(decision);
          else setDrag(0);
        }}
        animate={reduced ? undefined : { x: 0, rotate: drag / 40 }}
        role="group"
        tabIndex={0}
        aria-label={`Card ${index + 1} of ${items.length}. Arrow keys swipe.`}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") go("left");
          if (event.key === "ArrowRight") go("right");
        }}
      >
        {render(item, index)}
      </motion.div>
      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="outline" onClick={() => go("left")}>
          {leftLabel}
        </Button>
        <span className="text-muted-foreground text-xs">
          {index + 1} of {items.length}
        </span>
        <Button type="button" onClick={() => go("right")}>
          {rightLabel}
        </Button>
      </div>
    </div>
  );
}
