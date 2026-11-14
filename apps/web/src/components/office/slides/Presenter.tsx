import { useLingui } from "@lingui/react/macro";
import { getSlides, isSlideHidden } from "@office-kit/pptx";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { showOrder } from "./commands";
import type { Deck } from "./deck";
import type { ShowState } from "./player";
import { SlideShow } from "./player";

const NEXT = new Set(["ArrowRight", "ArrowDown", "PageDown", " ", "Enter", "n", "N"]);
const PREVIOUS = new Set(["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p", "P"]);

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * The deck as a full-screen slideshow, from `start`, with its transitions and builds. A click or
 * the arrow keys move a build or slide at a time; Esc ends it.
 */
export function Presenter({
  deck,
  start,
  onClose,
}: {
  deck: Deck;
  start: number;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const show = useRef<SlideShow | null>(null);
  const slides = getSlides(deck.pres);
  const [order] = useState(() => showOrder(slides.map(isSlideHidden)));
  const [state, setState] = useState<ShowState>(() => ({
    step: Math.max(0, order.indexOf(start)),
    ended: false,
  }));
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const player = new SlideShow(
      node,
      deck,
      slides,
      order,
      state.step,
      prefersReducedMotion(),
      setState,
    );
    show.current = player;
    player.begin();
    return () => {
      player.destroy();
      show.current = null;
    };
  }, []);

  useEffect(() => {
    const node = root.current;
    let entered = false;
    node?.focus();
    node
      ?.requestFullscreen?.()
      .then(() => {
        entered = true;
      })
      .catch(() => {});
    const onFullscreen = () => {
      if (entered && !document.fullscreenElement) closeRef.current();
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const player = show.current;
      let handled = true;
      if (event.key === "Escape") closeRef.current();
      else if (NEXT.has(event.key)) {
        if (!player?.next()) closeRef.current();
      } else if (PREVIOUS.has(event.key)) player?.previous();
      else if (event.key === "Home") player?.first();
      else if (event.key === "End") player?.last();
      else handled = false;
      if (!handled) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const number = (order[state.step] ?? 0) + 1;
  const total = slides.length;
  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: the arrow keys move between slides.
    <div
      ref={root}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={t`Slideshow`}
      data-testid="slides-presenter"
      className="group fixed inset-0 z-[100] grid place-items-center bg-black outline-none"
      onClick={() => {
        if (!show.current?.next()) onClose();
      }}
    >
      <div
        ref={stage}
        data-testid="slides-presenter-stage"
        className={`relative max-h-full max-w-full overflow-hidden ${state.ended ? "hidden" : ""}`}
        style={{
          aspectRatio: `${deck.width} / ${deck.height}`,
          width: `min(100vw, calc(100vh * ${deck.width / deck.height}))`,
        }}
      />
      {state.ended ? (
        <p className="absolute text-[15px] text-white/70">{t`End of slideshow. Click to exit.`}</p>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 p-3 text-[12px] text-white/70">
        <span
          className={`rounded bg-black/40 px-1.5 py-0.5 tabular-nums ${state.ended ? "invisible" : ""}`}
          data-testid="slides-presenter-counter"
        >
          {t`Slide ${number} of ${total}`}
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          aria-label={t`End slideshow`}
          className="pointer-events-auto grid size-8 place-items-center rounded-full bg-white/10 text-white opacity-0 transition-opacity hover:bg-white/20 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
