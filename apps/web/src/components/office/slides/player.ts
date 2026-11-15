import type { SlideData } from "@office-kit/pptx";
import type { Deck } from "./deck";
import type { Box, Build, SlideChange, SlideMotion, Target } from "./motion";
import {
  changeKeyframes,
  composeSlideMotion,
  effectKeyframes,
  hiddenTargets,
  holdsAfterEnd,
  slideMotion,
} from "./motion";
import { slideSvg } from "./render";
import { slideCssPixels } from "./slide-scale";

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

type ForeignGap = { transform: boolean; opacity: boolean; clipPath: boolean };

/**
 * The iPhone web view paints text as HTML inside the slide SVG, and a transform or opacity on
 * the shape's group does not move or fade that HTML. Measured once, so a browser that does
 * follow the group is left alone and the text is not moved twice.
 */
let foreignGap: ForeignGap | null = null;

function foreignObjectGap(): ForeignGap {
  const none = { transform: false, opacity: false, clipPath: false };
  if (foreignGap) return foreignGap;
  if (typeof document === "undefined") return none;
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-9999px;top:0;width:20px;height:10px";
  host.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><g id="a"><foreignObject x="0" y="0" width="8" height="8"><div xmlns="http://www.w3.org/1999/xhtml" style="width:8px;height:8px"></div></foreignObject></g><g id="b" transform="translate(8,0)" opacity="0.2"><foreignObject x="0" y="0" width="8" height="8"><div xmlns="http://www.w3.org/1999/xhtml" id="d" style="width:8px;height:8px"></div></foreignObject></g></svg>';
  document.body.append(host);
  const plain = host.querySelector("#a div")?.getBoundingClientRect();
  const moved = host.querySelector("#b div")?.getBoundingClientRect();
  const opacity = Number(getComputedStyle(host.querySelector("#d") ?? host).opacity);
  host.remove();
  if (!plain || !moved || plain.width === 0) return none;
  const gap = {
    transform: Math.abs(moved.left - plain.left) < 4,
    opacity: opacity > 0.8,
    clipPath: false,
  };
  gap.clipPath = gap.transform || gap.opacity;
  foreignGap = gap;
  return gap;
}

/** The shape, plus the HTML text inside it when that text ignores the shape's own effects. */
function effectNodes(el: Element): (HTMLElement | SVGElement)[] {
  const node = styled(el);
  if (!node) return [];
  const gap = foreignObjectGap();
  if (!gap.transform && !gap.opacity && !gap.clipPath) return [node];
  const extra: HTMLElement[] = [];
  for (const foreign of el.querySelectorAll("foreignObject")) {
    for (const child of foreign.children) {
      if (child instanceof HTMLElement) extra.push(child);
    }
  }
  return extra.length > 0 ? [node, ...extra] : [node];
}

function textKeyframes(frames: Keyframe[], gap: ForeignGap): Keyframe[] | null {
  const keep = new Set<string>();
  if (gap.transform) keep.add("transform");
  if (gap.opacity) keep.add("opacity");
  if (gap.clipPath) keep.add("clipPath");
  const mirrored = frames.map((frame) => {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(frame)) {
      if (key === "offset" || key === "easing" || keep.has(key)) next[key] = value;
    }
    return next as Keyframe;
  });
  const visible = (frame: Keyframe) =>
    Object.keys(frame).some((key) => key !== "offset" && key !== "easing");
  return mirrored.some(visible) ? mirrored : null;
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
  private generation = 0;
  private observer: ResizeObserver | null = null;

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
    this.observer = new ResizeObserver(() => this.refit());
    this.observer.observe(this.stage);
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
    this.observer?.disconnect();
    this.observer = null;
    for (const { animation } of this.running) animation.cancel();
    this.running = [];
    this.stage.replaceChildren();
  }

  /** How the natural-size slide fits the stage. Zero until the stage has been laid out. */
  private fitScale(): number {
    const natural = slideCssPixels(this.deck);
    if (!(natural.width > 0 && natural.height > 0)) return 0;
    if (this.stage.clientWidth <= 0 || this.stage.clientHeight <= 0) return 0;
    return Math.min(
      this.stage.clientWidth / natural.width,
      this.stage.clientHeight / natural.height,
    );
  }

  /** Scales every slide picture into the stage, text included. */
  private refit(): void {
    const scale = this.fitScale();
    if (!(scale > 0)) return;
    const held = new Set(this.running.map((entry) => entry.animation));
    for (const frame of this.stage.querySelectorAll<HTMLElement>("[data-slide-frame]")) {
      const animating = frame.getAnimations().some((animation) => {
        if (!held.has(animation)) return false;
        const effect = animation.effect;
        return (
          effect instanceof KeyframeEffect &&
          effect.getKeyframes().some((keyframe) => keyframe.transform != null)
        );
      });
      if (animating) continue;
      frame.style.transform = `scale(${scale})`;
    }
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
      this.refit();
    };
    animation.addEventListener("finish", once);
    this.running.push({ animation, done: once });
  }

  private frameOf(layer: HTMLElement): HTMLElement {
    return layer.querySelector<HTMLElement>("[data-slide-frame]") ?? layer;
  }

  private enter(step: number, how: "arrive" | "end"): void {
    this.finishRunning();
    const generation = ++this.generation;
    const slide = this.slides[this.order[step] ?? 0];
    if (!slide) return;
    const old = this.layer;
    const natural = slideCssPixels(this.deck);
    const layer = document.createElement("div");
    layer.style.cssText = "position:absolute;inset:0;overflow:hidden;background:#fff";
    const frame = document.createElement("div");
    frame.dataset.slideFrame = "";
    frame.style.cssText = `position:absolute;top:0;left:0;width:${natural.width}px;height:${natural.height}px;transform-origin:0 0`;
    frame.innerHTML = slideSvg(this.deck, slide);
    const svg = frame.querySelector("svg");
    if (svg) {
      svg.style.cssText = `display:block;width:${natural.width}px;height:${natural.height}px`;
    }
    layer.append(frame);
    this.stage.append(layer);
    this.layer = layer;
    this.refit();
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
      let tries = 0;
      const play = () => {
        if (generation !== this.generation || !this.motion) return;
        if (!(this.fitScale() > 0) && tries < 2) {
          tries += 1;
          requestAnimationFrame(play);
          return;
        }
        this.refit();
        const wait = this.playChange(old, layer, this.motion.change);
        if (this.motion.onEntry) this.playBuild(this.motion.onEntry, wait);
      };
      // A stage with no size yet would bake a zero scale into the transition and the
      // slide would pop in instead of moving. The phone lays the overlay out a frame later.
      play();
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
        for (const node of effectNodes(el)) {
          for (const animation of node.getAnimations?.() ?? []) animation.cancel();
        }
        const node = styled(el);
        if (!node) continue;
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
    const scale = this.fitScale();
    const natural = slideCssPixels(this.deck);
    const incoming = composeSlideMotion(scale, frames.incoming, natural);
    const outgoing = composeSlideMotion(scale, frames.outgoing, natural);
    const timing = { duration: change.durationMs, easing: "ease-in-out" };
    if (old && frames.outgoingOnTop) old.style.zIndex = "1";
    const animations: Animation[] = [];
    if (incoming)
      animations.push(this.frameOf(layer).animate(incoming, { ...timing, fill: "backwards" }));
    if (old && outgoing)
      animations.push(this.frameOf(old).animate(outgoing, { ...timing, fill: "forwards" }));
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
        const nodes = effectNodes(el);
        const node = nodes[0];
        if (!node) continue;
        if (this.reduced || !node.animate) {
          if (effect.phase === "entrance") node.style.visibility = "";
          else if (effect.phase === "exit") node.style.visibility = "hidden";
          continue;
        }
        const exit = effect.phase === "exit";
        const entrance = effect.phase === "entrance";
        if (entrance) node.style.visibility = "";
        const frames = effectKeyframes(effect, size, boxOf(el));
        const mirrored = textKeyframes(frames, foreignObjectGap());
        const timing: KeyframeAnimationOptions = {
          duration: effect.durationMs,
          delay: offsetMs + effect.startMs,
          easing: entrance ? "ease-out" : exit ? "ease-in" : "ease-in-out",
          direction: exit ? "reverse" : "normal",
          fill: entrance ? "backwards" : exit || holdsAfterEnd(effect) ? "forwards" : "none",
        };
        for (const [index, target] of nodes.entries()) {
          const keyframes = index === 0 ? frames : mirrored;
          if (!keyframes) continue;
          if (target instanceof SVGElement) target.style.transformBox = "fill-box";
          target.style.transformOrigin = "center";
          const animation = target.animate(keyframes, timing);
          this.track(
            animation,
            index === 0 && exit
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
}
