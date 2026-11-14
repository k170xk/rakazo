import { Trans, useLingui } from "@lingui/react/macro";
import type { SlideData } from "@office-kit/pptx";
import { getShapeText, getSlideNotes, getSlides } from "@office-kit/pptx";
import { toast } from "@rakazo/ui-web";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { control } from "../../studio/StudioFrame";
import type { SlideView } from "./context";
import type { Deck } from "./deck";
import {
  addSlideAfter,
  deleteSlide,
  duplicateSlide,
  findShape,
  pictureFile,
  reorderSlide,
  selectionLabel,
  setNotes,
  slideView,
  toggleSlideHidden,
} from "./deck";
import { Presenter } from "./Presenter";
import { slideRevision, touchSlide } from "./render";
import type { ShapePick } from "./SlideCanvas";
import { SlideCanvas } from "./SlideCanvas";
import type { SlideOp } from "./SlideRail";
import { SlideRail, useSlideImage } from "./SlideRail";
import type { SlideEditResult } from "./SlidesRibbon";
import { SlidesRibbon } from "./SlidesRibbon";
import { createDeckUndo } from "./undo";

/** Where the person is, kept across reloads and sent with the studio note. */
export type SlidesView = {
  index: number;
  selection: string;
  /** The slide in view and the shape picked on it, read when the note is written. */
  slide?: () => SlideView | null;
  /** The picked picture as a file, or null when no picture is picked. */
  picture?: () => File | null;
};

export function SlidesWorkbench({
  deck,
  readOnly,
  initialIndex,
  changed,
  onEdit,
  onView,
}: {
  deck: Deck;
  readOnly: boolean;
  initialIndex: number;
  /** Slides that changed in the version just loaded. */
  changed: ReadonlySet<number>;
  onEdit: () => void;
  onView: (view: SlidesView) => void;
}) {
  const { t } = useLingui();
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const slides = getSlides(deck.pres);
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(initialIndex, 0), Math.max(slides.length - 1, 0)),
  );
  const [pick, setPick] = useState<ShapePick | null>(null);
  const slide = slides[index] ?? slides[0];
  const [notes, setNotesText] = useState(() => (slide ? (getSlideNotes(slide) ?? "") : ""));

  useEffect(() => {
    setNotesText(slide ? (getSlideNotes(slide) ?? "") : "");
    setPick(null);
  }, [slide]);

  const pickedText = slide && pick ? findShape(slide, pick.id) : null;
  const selected = pickedText ? getShapeText(pickedText) : null;
  useEffect(() => {
    onView({
      index,
      selection: selectionLabel(index, selected),
      slide: () => {
        const slides = getSlides(deck.pres);
        const current = slides[index];
        return current ? slideView(deck, current, index, slides.length, pickedText) : null;
      },
      picture: () => (pickedText ? pictureFile(pickedText) : null),
    });
  }, [deck, index, selected, pickedText, onView]);

  const scope = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [presenting, setPresenting] = useState<number | null>(null);
  const undo = useMemo(() => createDeckUndo(deck), [deck]);
  useEffect(() => {
    const stop = undo.history.subscribe(redraw);
    return () => {
      stop();
      undo.dispose();
    };
  }, [undo]);

  function edited() {
    undo.committed();
    redraw();
    onEdit();
  }

  function step(back: boolean) {
    if (readOnly) return;
    (back ? undo.undo() : undo.redo())
      .then((moved) => {
        if (!moved) return;
        setPick(null);
        goTo(index);
        redraw();
        onEdit();
      })
      .catch(() => toast.error(t`Couldn't undo that change.`));
  }

  function change(run: () => SlideEditResult) {
    if (readOnly || !slide) return;
    const result = run();
    touchSlide(slide);
    if (result?.index !== undefined) goTo(result.index);
    if (result?.pick !== undefined) setPick(result.pick);
    edited();
  }

  function goTo(next: number) {
    setIndex(Math.min(Math.max(next, 0), getSlides(deck.pres).length - 1));
  }

  function runOp(op: SlideOp, at: number) {
    if (readOnly) return;
    const target = getSlides(deck.pres)[at];
    if (op === "add") goTo(addSlideAfter(deck, at));
    else if (op === "duplicate") goTo(duplicateSlide(deck, at));
    else if (op === "up") goTo(reorderSlide(deck, at, at - 1));
    else if (op === "down") goTo(reorderSlide(deck, at, at + 1));
    else if (op === "hide" && target) {
      toggleSlideHidden(deck, at);
      touchSlide(target);
    } else if (op === "delete") goTo(deleteSlide(deck, at));
    edited();
  }

  if (!slide) {
    return (
      <div className="grid size-full place-items-center p-6">
        <div className="flex flex-col items-center gap-3 text-center text-[14px] text-muted-foreground">
          <Trans>This presentation has no slides.</Trans>
        </div>
      </div>
    );
  }

  return (
    <div ref={scope} tabIndex={-1} className="flex size-full min-h-0 flex-col outline-none">
      <SlidesRibbon
        scope={scope}
        deck={deck}
        slide={slide}
        index={index}
        shape={pickedText}
        pick={pick}
        readOnly={readOnly}
        canUndo={undo.history.canUndo()}
        canRedo={undo.history.canRedo()}
        onUndo={() => step(true)}
        onRedo={() => step(false)}
        onChange={change}
        onSlideOp={(op) => runOp(op, index)}
        zoom={zoom}
        onZoom={setZoom}
        onPresent={setPresenting}
      />
      {presenting !== null ? (
        <Presenter deck={deck} start={presenting} onClose={() => setPresenting(null)} />
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row" data-testid="slides-workbench">
        <SlideRail
          deck={deck}
          slides={slides}
          revOf={slideRevision}
          current={index}
          changed={changed}
          readOnly={readOnly}
          onPick={goTo}
          onOp={runOp}
          onMove={(from, to) => {
            if (readOnly) return;
            goTo(reorderSlide(deck, from, to));
            edited();
          }}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 p-3 md:p-6">
            <SlideCanvas
              deck={deck}
              slide={slide}
              rev={slideRevision(slide)}
              readOnly={readOnly}
              pick={pick}
              zoom={zoom}
              onPick={setPick}
              onChanged={() => {
                touchSlide(slide);
                edited();
              }}
            />
            {readOnly ? null : (
              <button
                type="button"
                onClick={() => runOp("add", index)}
                aria-label={t`New slide`}
                title={t`New slide`}
                data-testid="slides-add"
                className={`${control} absolute right-3 bottom-3 size-[35px] bg-background shadow-sm`}
              >
                <Plus className="size-[18px]" strokeWidth={1.7} />
              </button>
            )}
          </div>
          <label className="flex shrink-0 flex-col gap-1 border-t border-border px-3 pt-2 pb-3 md:px-6">
            <span className="text-[12px] font-medium text-muted-foreground">
              <Trans>Speaker notes</Trans>
            </span>
            <textarea
              value={notes}
              readOnly={readOnly}
              placeholder={readOnly ? "" : t`Add notes for this slide`}
              data-testid="slides-notes"
              onChange={(event) => {
                if (readOnly) return;
                setNotesText(event.target.value);
                setNotes(slide, event.target.value);
                undo.typed();
                onEdit();
              }}
              rows={3}
              className="max-h-40 min-h-16 w-full resize-y rounded-md bg-muted/40 px-2.5 py-2 text-[14px] leading-snug outline-none ring-1 ring-border focus:ring-2 focus:ring-primary"
            />
          </label>
        </div>
      </div>
    </div>
  );
}

function PreviewSlide({ deck, slide, index }: { deck: Deck; slide: SlideData; index: number }) {
  const { t } = useLingui();
  const url = useSlideImage(deck, slide, 0);
  const number = index + 1;
  return (
    <li
      className="w-full overflow-hidden rounded-md bg-white ring-1 ring-border"
      style={{ aspectRatio: `${deck.width} / ${deck.height}` }}
    >
      {url ? <img src={url} alt={t`Slide ${number}`} className="block size-full" /> : null}
    </li>
  );
}

/** Every slide as a picture, for when editing could not start. */
export function SlidesPreview({ deck }: { deck: Deck }) {
  const slides = getSlides(deck.pres);
  return (
    <div className="size-full overflow-auto" data-testid="slides-preview">
      <p className="mx-auto max-w-3xl px-4 pt-4 text-[13px] text-muted-foreground">
        <Trans>
          Editing couldn't start for this presentation, so it is shown read-only. Download it to
          edit it in a presentation app, or ask the assistant for changes.
        </Trans>
      </p>
      <ol className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        {slides.map((slide, index) => (
          <PreviewSlide key={index} deck={deck} slide={slide} index={index} />
        ))}
      </ol>
    </div>
  );
}
