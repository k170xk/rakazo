import { useLingui } from "@lingui/react/macro";
import { getSlides, isSlideHidden } from "@office-kit/pptx";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { showOrder } from "./commands";
import type { Deck } from "./deck";
import { slideSvg } from "./render";

const NEXT = new Set(["ArrowRight", "ArrowDown", "PageDown", " ", "Enter", "n", "N"]);
const PREVIOUS = new Set(["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p", "P"]);

/** The deck as a full-screen slideshow, from `start`. Arrow keys move; Esc ends it. */
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
  const slides = getSlides(deck.pres);
  const [order] = useState(() => showOrder(slides.map(isSlideHidden)));
  const [step, setStep] = useState(() => Math.max(0, order.indexOf(start)));
  const ended = step >= order.length;
  const slide = ended ? null : slides[order[step] ?? 0];
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

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
      let handled = true;
      if (event.key === "Escape") closeRef.current();
      else if (NEXT.has(event.key)) {
        if (ended) closeRef.current();
        else setStep((s) => s + 1);
      } else if (PREVIOUS.has(event.key)) setStep((s) => Math.max(0, s - 1));
      else if (event.key === "Home") setStep(0);
      else if (event.key === "End") setStep(order.length - 1);
      else handled = false;
      if (!handled) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ended, order.length]);

  const number = (order[step] ?? 0) + 1;
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
      onClick={() => (ended ? onClose() : setStep((s) => s + 1))}
    >
      {slide ? (
        <div
          className="max-h-full max-w-full [&>svg]:block [&>svg]:size-full"
          style={{
            aspectRatio: `${deck.width} / ${deck.height}`,
            width: `min(100vw, calc(100vh * ${deck.width / deck.height}))`,
          }}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: the SVG is drawn locally from the deck, with no scripts.
          dangerouslySetInnerHTML={{ __html: slideSvg(deck, slide) }}
        />
      ) : (
        <p className="text-[15px] text-white/70">{t`End of slideshow. Click to exit.`}</p>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 p-3 text-[12px] text-white/70 opacity-0 transition-opacity group-hover:opacity-100">
        <span>{ended ? "" : t`Slide ${number} of ${total}`}</span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          aria-label={t`End slideshow`}
          className="pointer-events-auto grid size-8 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
