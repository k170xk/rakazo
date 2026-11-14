import { loadPresentation, savePresentation } from "@office-kit/pptx";
import type { History } from "../ribbon/history";
import { createHistory } from "../ribbon/history";
import type { Deck } from "./deck";

/** Typing pauses this long before the notes count as one finished step. */
const TYPING_PAUSE_MS = 600;

export type DeckUndo = {
  history: History<Promise<Uint8Array>>;
  /** Call after every change to the deck; the change becomes one step to undo. */
  committed: () => void;
  /** Call on every keystroke in a text field; a burst of typing becomes one step. */
  typed: () => void;
  /** Puts the deck back one step by replacing `deck.pres`; false when there is nothing to undo. */
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  dispose: () => void;
};

/**
 * Undo over saved copies of the whole deck. `savePresentation` reads the deck before it first
 * waits, so a copy started straight after a change holds exactly that state.
 */
export function createDeckUndo(deck: Deck): DeckUndo {
  const history = createHistory<Promise<Uint8Array>>();
  let now = savePresentation(deck.pres);
  let typing: ReturnType<typeof setTimeout> | null = null;
  let busy = false;

  const settleTyping = () => {
    if (typing === null) return false;
    clearTimeout(typing);
    typing = null;
    now = savePresentation(deck.pres);
    return true;
  };

  async function move(step: (current: Promise<Uint8Array>) => Promise<Uint8Array> | null) {
    if (busy) return false;
    settleTyping();
    const target = step(now);
    if (!target) return false;
    busy = true;
    try {
      const bytes = await target;
      deck.pres = await loadPresentation(bytes);
      now = Promise.resolve(bytes);
      return true;
    } finally {
      busy = false;
    }
  }

  return {
    history,
    committed() {
      if (!settleTyping()) history.record(now);
      now = savePresentation(deck.pres);
    },
    typed() {
      if (typing === null) history.record(now);
      else clearTimeout(typing);
      typing = setTimeout(() => {
        typing = null;
        now = savePresentation(deck.pres);
      }, TYPING_PAUSE_MS);
    },
    undo: () => move(history.undo),
    redo: () => move(history.redo),
    dispose() {
      if (typing !== null) clearTimeout(typing);
      history.clear();
    },
  };
}
