import type { DocumentStudioFocus, DocumentStudioSelected } from "@rakazo/contracts";
import { clip } from "../context";

const EMU_PER_CM = 360000;

/** One shape as the note describes it. */
export type SlideShapeSummary = {
  kind: "text" | "picture" | "shape" | "other";
  name: string;
  text: string;
  alt: string | null;
  /** The placeholder it fills, such as "title" or "body". */
  placeholder: string | null;
  box: { x: number; y: number; w: number; h: number } | null;
};

/** The slide in view and what is picked on it. */
export type SlideView = {
  index: number;
  count: number;
  title: string | null;
  texts: string[];
  notes: string;
  picked: SlideShapeSummary | null;
};

export type SlideChipWords = {
  slide: (n: number) => string;
  title: string;
  textBox: (excerpt: string) => string;
  textBoxEmpty: string;
  picture: (name: string) => string;
  pictureUnnamed: string;
  shape: (name: string) => string;
};

const TEXT_MAX = 900;
const NOTES_MAX = 500;

function cm(emu: number): string {
  return (emu / EMU_PER_CM).toFixed(1);
}

/** "2.0 cm from the left, 3.5 cm from the top, 10.0 × 4.5 cm". */
export function boxText(box: SlideShapeSummary["box"]): string {
  if (!box) return "";
  return `${cm(box.x)} cm from the left, ${cm(box.y)} cm from the top, ${cm(box.w)} × ${cm(box.h)} cm`;
}

function isTitle(shape: SlideShapeSummary): boolean {
  return shape.placeholder === "title" || shape.placeholder === "ctrTitle";
}

/** The studio note's focus and selection for a presentation. */
export function slidesContext(
  view: SlideView,
  words: SlideChipWords,
): { focus: DocumentStudioFocus; selected: DocumentStudioSelected | null } {
  const number = view.index + 1;
  const detail = [
    view.title ? `Title: ${clip(view.title, 200)}` : "",
    view.texts.length ? `Text: ${clip(view.texts.join(" / "), TEXT_MAX)}` : "",
    view.notes.trim() ? `Speaker notes: ${clip(view.notes, NOTES_MAX)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const focus: DocumentStudioFocus = {
    where: view.count > 0 ? `slide ${number} of ${view.count}` : `slide ${number}`,
    short: words.slide(number),
    detail: detail || undefined,
  };
  const shape = view.picked;
  if (!shape) return { focus, selected: null };
  const position = [`slide ${number}`, boxText(shape.box)].filter(Boolean).join(", ");
  if (shape.kind === "picture") {
    const name = clip(shape.alt || shape.name, 60);
    return {
      focus,
      selected: {
        what: "picture",
        label: name ? words.picture(name) : words.pictureUnnamed,
        content: shape.alt ? `Alt text: ${clip(shape.alt, 300)}` : undefined,
        position,
        imageAttached: true,
      },
    };
  }
  if (shape.kind === "text") {
    const text = shape.text.trim();
    return {
      focus,
      selected: {
        what: isTitle(shape) ? "slide title" : "text box",
        label: isTitle(shape)
          ? words.title
          : text
            ? words.textBox(clip(text, 40))
            : words.textBoxEmpty,
        content: text ? clip(shape.text, 2000) : "(empty)",
        position,
      },
    };
  }
  return {
    focus,
    selected: {
      what: "shape",
      label: words.shape(clip(shape.name, 40)),
      content: shape.text.trim() ? clip(shape.text, 2000) : undefined,
      position,
    },
  };
}
