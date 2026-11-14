import { Trans, useLingui } from "@lingui/react/macro";
import type { SlideData } from "@office-kit/pptx";
import { isSlideHidden } from "@office-kit/pptx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@rakazo/ui-web";
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Deck } from "./deck";
import { slideSvg } from "./render";

export type SlideOp = "add" | "duplicate" | "up" | "down" | "hide" | "delete";

/** A slide drawn to an image link, made after the rail paints so a long deck opens quickly. */
export function useSlideImage(deck: Deck, slide: SlideData, rev: number): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let made: string | null = null;
    const timer = window.setTimeout(() => {
      try {
        const svg = slideSvg(deck, slide);
        made = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        setUrl(made);
      } catch {
        setUrl(null);
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (made) {
        const old = made;
        // Kept briefly so the old picture stays until the new one has loaded.
        window.setTimeout(() => URL.revokeObjectURL(old), 1000);
      }
    };
  }, [deck, slide, rev]);
  return url;
}

function Thumb({
  deck,
  slide,
  rev,
  index,
  count,
  current,
  changed,
  readOnly,
  onPick,
  onOp,
  onDropAt,
}: {
  deck: Deck;
  slide: SlideData;
  rev: number;
  index: number;
  count: number;
  current: boolean;
  changed: boolean;
  readOnly: boolean;
  onPick: (index: number) => void;
  onOp: (op: SlideOp, index: number) => void;
  onDropAt: (from: number, to: number) => void;
}) {
  const { t } = useLingui();
  const url = useSlideImage(deck, slide, rev);
  const hidden = isSlideHidden(slide);
  const number = index + 1;
  const [over, setOver] = useState(false);

  return (
    <li
      className="group relative flex shrink-0 items-start gap-1.5 max-md:w-32"
      draggable={!readOnly}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-slide-index", String(index));
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(event) => {
        if (readOnly || !event.dataTransfer.types.includes("application/x-slide-index")) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        const from = Number(event.dataTransfer.getData("application/x-slide-index"));
        if (Number.isInteger(from) && from !== index) onDropAt(from, index);
      }}
      data-testid="slides-thumb"
    >
      <span className="w-5 shrink-0 pt-0.5 text-right text-[11px] tabular-nums text-muted-foreground max-md:hidden">
        {number}
      </span>
      <button
        type="button"
        onClick={() => onPick(index)}
        aria-label={t`Slide ${number}`}
        aria-current={current ? "true" : undefined}
        className={`relative block w-full overflow-hidden rounded-md bg-white ring-offset-1 ring-offset-background transition-shadow ${
          current ? "ring-2 ring-primary" : "ring-1 ring-border hover:ring-foreground/30"
        } ${over ? "outline-2 outline-primary outline-dashed" : ""} ${
          changed ? "shadow-[0_0_0_4px] shadow-primary/40" : ""
        }`}
        style={{ aspectRatio: `${deck.width} / ${deck.height}` }}
      >
        {url ? (
          <img
            src={url}
            alt=""
            draggable={false}
            className={`block size-full ${hidden ? "opacity-40" : ""}`}
          />
        ) : null}
        {hidden ? (
          <span className="absolute right-1 bottom-1 rounded bg-background/90 p-0.5">
            <EyeOff className="size-3 text-muted-foreground" aria-label={t`Hidden`} />
          </span>
        ) : null}
        <span className="absolute top-1 left-1 rounded bg-background/90 px-1 text-[10px] tabular-nums md:hidden">
          {number}
        </span>
      </button>
      {readOnly ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t`Slide ${number} options`}
            data-testid="slides-thumb-menu"
            className={`absolute top-1 right-1 grid size-6 place-items-center rounded-md bg-background/95 shadow-sm ring-1 ring-border ${
              current
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            } max-md:opacity-100`}
          >
            <MoreHorizontal className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => onOp("add", index)}>
              <Plus className="size-4" />
              <Trans>New slide after this</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onOp("duplicate", index)}>
              <Copy className="size-4" />
              <Trans>Duplicate</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === 0} onClick={() => onOp("up", index)}>
              <ArrowUp className="size-4" />
              <Trans>Move up</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === count - 1} onClick={() => onOp("down", index)}>
              <ArrowDown className="size-4" />
              <Trans>Move down</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onOp("hide", index)}>
              {hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
              {hidden ? <Trans>Show in slideshow</Trans> : <Trans>Hide in slideshow</Trans>}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={count <= 1}
              onClick={() => onOp("delete", index)}
            >
              <Trash2 className="size-4" />
              <Trans>Delete slide</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

/** Slide thumbnails: a column beside the slide, or a strip above it on phones. */
export function SlideRail({
  deck,
  slides,
  revOf,
  current,
  changed,
  readOnly,
  onPick,
  onOp,
  onMove,
}: {
  deck: Deck;
  slides: readonly SlideData[];
  revOf: (slide: SlideData) => number;
  current: number;
  changed: ReadonlySet<number>;
  readOnly: boolean;
  onPick: (index: number) => void;
  onOp: (op: SlideOp, index: number) => void;
  onMove: (from: number, to: number) => void;
}) {
  const { t } = useLingui();
  return (
    <nav
      aria-label={t`Slides`}
      className="shrink-0 border-border max-md:border-b md:w-48 md:border-r"
      data-testid="slides-rail"
    >
      <ol className="flex gap-2 overflow-auto p-2 max-md:flex-row md:h-full md:flex-col md:gap-3 md:p-3">
        {slides.map((slide, index) => (
          <Thumb
            key={index}
            deck={deck}
            slide={slide}
            rev={revOf(slide)}
            index={index}
            count={slides.length}
            current={index === current}
            changed={changed.has(index)}
            readOnly={readOnly}
            onPick={onPick}
            onOp={onOp}
            onDropAt={onMove}
          />
        ))}
      </ol>
    </nav>
  );
}
