import type { SlideData } from "@office-kit/pptx";
import type { Deck } from "./deck";
import type { Box, Build, SlideChange, SlideMotion, Target } from "./motion";
import {
  changeKeyframes,
  effectKeyframes,
  hiddenTargets,
  holdsAfterEnd,
  slideMotion,
} from "./motion";
import { slideSvg } from "./render";

export type ShowState = { step: number; ended: boolean };

/** The drawn shape (or its paragraphs) an effect animates; pptx-preview tags each slide shape. */
function targetElements(layer: Element, target: Target): Element[] {
  const shape = layer.querySelector(`[data-pptx-shape-id="${target.shapeId}"]`);
  if (!shape) return [];
  if (!target.paragraphs) return [shape];
  const [first, last] = target.paragraphs;
  const paragraphs = [...shape.querySelectorAll("[data-pptx-paragraph]")].filter((node) => {
    const index = Number(node.getAttribute("data-pptx-paragraph"));
    return index >= first && index <= last;
  });
  return paragraphs.length > 0 ? paragraphs : [shape];
}

function boxOf(el: Element): Box | null {
  if (!(el instanceof SVGGraphicsElement)) return null;
  try {
    const box = el.getBBox();
    return { x: box.x, y: box.y, w: box.width, h: box.height };
  } catch {
    return null;
  }
}

function styled(el: Element): HTMLElement | SVGElement | null {
  return el instanceof HTMLElement || el instanceof SVGElement ? el : null;
}

/**
 * Plays a deck as a slideshow inside `stage`: each slide is drawn into its own layer so the one
 * leaving and the one arriving can both move during a transition, and each click runs the slide's
 * next build with the Web Animations API. Any key or click while effects run finishes them first.
 */
export class SlideShow {
  private layer: HTMLDivElement | null = null;
  private motion: SlideMotion | null = null;
  private running: { animation: Animation; done: () => void }[] = [];
  private step: number;
  private clicks = 0;
  private ended = false;

  constructor(
    private readonly stage: HTMLElement,
    private readonly deck: Deck,
    private readonly slides: readonly SlideData[],
    private readonly order: readonly number[],
    start: number,
    private readonly reduced: boolean,
    private readonly onChange: (state: ShowState) => void,
  ) {
    this.step = start;
  }

  begin(): void {
    this.enter(this.step, "arrive");
  }

  /** The next build or slide; false once the show has ended, so the caller can close it. */
  next(): boolean {
    if (this.ended) return false;
    this.finishRunning();
    const build = this.motion?.clicks[this.clicks];
    if (build) {
      this.clicks += 1;
      this.playBuild(build, 0);
      this.notify();
    } else if (this.step + 1 < this.order.length) {
      this.enter(this.step + 1, "arrive");
    } else {
      this.ended = true;
      this.layer?.remove();
      this.layer = null;
      this.notify();
    }
    return true;
  }

  /** Back one build, shown as it stands once that build is done, or to the end of the slide before. */
  previous(): void {
    this.finishRunning();
    if (this.ended) this.enter(this.step, "end");
    else if (this.clicks > 0) {
      this.clicks -= 1;
      this.applyState(true);
      this.notify();
    } else if (this.step > 0) this.enter(this.step - 1, "end");
  }

  first(): void {
    this.enter(0, "arrive");
  }

  last(): void {
    this.enter(this.order.length - 1, "end");
  }

  destroy(): void {
    for (const { animation } of this.running) animation.cancel();
    this.running = [];
    this.stage.replaceChildren();
  }

  private notify(): void {
    this.onChange({ step: this.step, ended: this.ended });
  }

  private finishRunning(): void {
    const running = this.running;
    this.running = [];
    for (const { animation, done } of running) {
      try {
        animation.finish();
      } catch {
        animation.cancel();
      }
      done();
    }
  }

  private track(animation: Animation, done: () => void = () => {}): void {
    let finished = false;
    const once = () => {
      if (finished) return;
      finished = true;
      this.running = this.running.filter((entry) => entry.animation !== animation);
      done();
    };
    animation.addEventListener("finish", once);
    this.running.push({ animation, done: once });
  }

  private enter(step: number, how: "arrive" | "end"): void {
    this.finishRunning();
    const slide = this.slides[this.order[step] ?? 0];
    if (!slide) return;
    const old = this.layer;
    const layer = document.createElement("div");
    layer.style.cssText = "position:absolute;inset:0;overflow:hidden;background:#fff";
    layer.innerHTML = slideSvg(this.deck, slide);
    const svg = layer.querySelector("svg");
    if (svg) svg.style.cssText = "display:block;width:100%;height:100%";
    this.stage.append(layer);
    this.layer = layer;
    this.motion = slideMotion(slide);
    this.step = step;
    this.ended = false;
    if (how === "end") {
      this.clicks = this.motion.clicks.length;
      this.applyState(true);
      old?.remove();
    } else {
      this.clicks = 0;
      this.applyState(false);
      const wait = this.playChange(old, layer, this.motion.change);
      if (this.motion.onEntry) this.playBuild(this.motion.onEntry, wait);
    }
    this.notify();
  }

  /** Shows and hides each animated target as it stands after the builds run so far. */
  private applyState(entered: boolean): void {
    const { layer, motion } = this;
    if (!layer || !motion) return;
    const hidden = hiddenTargets(motion, this.clicks, entered);
    for (const [key, target] of motion.targets) {
      for (const el of targetElements(layer, target)) {
        const node = styled(el);
        if (!node) continue;
        for (const animation of node.getAnimations?.() ?? []) animation.cancel();
        node.style.visibility = hidden.has(key) ? "hidden" : "";
      }
    }
  }

  /** Runs the transition onto `layer`; returns how long it takes. */
  private playChange(
    old: HTMLDivElement | null,
    layer: HTMLDivElement,
    change: SlideChange,
  ): number {
    if (this.reduced || change.kind === "none" || change.durationMs <= 0 || !layer.animate) {
      old?.remove();
      return 0;
    }
    const frames = changeKeyframes(change);
    const timing = { duration: change.durationMs, easing: "ease-in-out" };
    if (old && frames.outgoingOnTop) old.style.zIndex = "1";
    const animations: Animation[] = [];
    if (frames.incoming)
      animations.push(layer.animate(frames.incoming, { ...timing, fill: "backwards" }));
    if (old && frames.outgoing)
      animations.push(old.animate(frames.outgoing, { ...timing, fill: "forwards" }));
    if (animations.length === 0) {
      old?.remove();
      return 0;
    }
    for (const animation of animations) this.track(animation, () => old?.remove());
    return change.durationMs;
  }

  /** Starts a build `offsetMs` from now. */
  private playBuild(build: Build, offsetMs: number): void {
    const layer = this.layer;
    if (!layer) return;
    const view = layer.querySelector("svg")?.viewBox.baseVal;
    const size = { w: view?.width || 1280, h: view?.height || 720 };
    for (const effect of build.effects) {
      for (const el of targetElements(layer, effect.target)) {
        const node = styled(el);
        if (!node) continue;
        if (this.reduced || !node.animate) {
          if (effect.phase === "entrance") node.style.visibility = "";
          else if (effect.phase === "exit") node.style.visibility = "hidden";
          continue;
        }
        if (node instanceof SVGElement) node.style.transformBox = "fill-box";
        node.style.transformOrigin = "center";
        const exit = effect.phase === "exit";
        const entrance = effect.phase === "entrance";
        if (entrance) node.style.visibility = "";
        const animation = node.animate(effectKeyframes(effect, size, boxOf(el)), {
          duration: effect.durationMs,
          delay: offsetMs + effect.startMs,
          easing: entrance ? "ease-out" : exit ? "ease-in" : "ease-in-out",
          direction: exit ? "reverse" : "normal",
          fill: entrance ? "backwards" : exit || holdsAfterEnd(effect) ? "forwards" : "none",
        });
        this.track(
          animation,
          exit
            ? () => {
                node.style.visibility = "hidden";
                animation.cancel();
              }
            : undefined,
        );
      }
    }
  }
}
