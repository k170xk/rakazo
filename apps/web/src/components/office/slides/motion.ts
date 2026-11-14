import type { SlideAnimationStep, SlideData, SlideTransition } from "@office-kit/pptx";
import { getSlideAnimations, getSlideTransition } from "@office-kit/pptx";

/** A slide's size or a shape's box, in the preview's SVG units. */
export type Size = { w: number; h: number };
export type Box = Size & { x: number; y: number };

/** A unit step: `x` -1 is leftwards, `y` -1 upwards. */
type Vector = { x: -1 | 0 | 1; y: -1 | 0 | 1 };

export type ChangeKind = "none" | "fade" | "push" | "wipe" | "cover" | "uncover" | "split" | "zoom";

/** How the slideshow moves onto a slide. Effects we do not draw become a fade. */
export type SlideChange = {
  kind: ChangeKind;
  durationMs: number;
  /** Which way the slides move or the wipe travels. */
  toward: Vector;
  /** Split: whether the line runs down (`vertical`) or across. */
  orientation: "horizontal" | "vertical";
  /** Split and zoom: opening out of the centre or closing in on it. */
  inward: boolean;
  thruBlack: boolean;
};

export type Phase = "entrance" | "emphasis" | "exit";
export type EffectStyle =
  | "appear"
  | "fade"
  | "fly"
  | "float"
  | "sink"
  | "wipe"
  | "split"
  | "zoom"
  | "grow-in"
  | "stretch"
  | "turn"
  | "pulse"
  | "grow"
  | "spin"
  | "teeter"
  | "transparency"
  | "blink"
  | "dip";

/** What an effect animates: a shape, or a run of its paragraphs. */
export type Target = { shapeId: number; paragraphs: [number, number] | null };

export type Effect = {
  target: Target;
  phase: Phase;
  style: EffectStyle;
  /** The edge a fly, wipe or peek comes from or leaves by. */
  side: Vector | null;
  orientation: "horizontal" | "vertical";
  inward: boolean;
  /** Grow/Shrink as a scale factor, spin in degrees, transparency 0–1. */
  amount: number | null;
  axis: "both" | "horizontal" | "vertical";
  /** From the start of the build it belongs to. */
  startMs: number;
  durationMs: number;
};

/** Effects that run together: one click's worth, or those that run as the slide appears. */
export type Build = { effects: Effect[]; durationMs: number };

export type SlideMotion = {
  change: SlideChange;
  /** Effects set to run with or after the slide's arrival, before any click. */
  onEntry: Build | null;
  clicks: Build[];
  /** Every target any effect touches, keyed by `targetKey`. */
  targets: Map<string, Target>;
};

const SPEED_MS: Record<string, number> = { fast: 500, med: 750, slow: 1000 };
const DEFAULT_EFFECT_MS = 500;

/** `<p:transition dir>`: `l`, `ru` and so on name the way the slides move. */
function vectorOf(dir: string | undefined, fallback: Vector): Vector {
  if (!dir) return fallback;
  const x = dir.includes("l") ? -1 : dir.includes("r") ? 1 : 0;
  const y = dir.includes("u") ? -1 : dir.includes("d") ? 1 : 0;
  return x === 0 && y === 0 ? fallback : { x, y };
}

const TRANSITION_KIND: Record<string, ChangeKind> = {
  none: "none",
  cut: "none",
  fade: "fade",
  push: "push",
  wipe: "wipe",
  cover: "cover",
  pull: "uncover",
  reveal: "uncover",
  split: "split",
  zoom: "zoom",
};

/** The slide's transition as the slideshow plays it. */
export function slideChange(transition: SlideTransition | null): SlideChange {
  const base: SlideChange = {
    kind: "none",
    durationMs: 0,
    toward: { x: -1, y: 0 },
    orientation: "horizontal",
    inward: false,
    thruBlack: false,
  };
  if (!transition || transition.effect === "none") return base;
  const kind = TRANSITION_KIND[transition.effect] ?? "fade";
  const durationMs =
    kind === "none"
      ? 0
      : (transition.durationMs ?? SPEED_MS[transition.speed ?? "fast"] ?? SPEED_MS.fast ?? 500);
  return {
    ...base,
    kind,
    durationMs,
    toward: vectorOf(transition.direction, base.toward),
    orientation: transition.orientation === "vert" ? "vertical" : "horizontal",
    inward: transition.direction === "in",
    thruBlack: transition.thruBlack === true,
  };
}

const SIDES: Record<string, Vector> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  topLeft: { x: -1, y: -1 },
  topRight: { x: 1, y: -1 },
  bottomLeft: { x: -1, y: 1 },
  bottomRight: { x: 1, y: 1 },
};

/** The look we give each preset, by its name without the In/Out ending. */
const STYLE: Record<string, EffectStyle> = {
  appear: "appear",
  disappear: "appear",
  fade: "fade",
  dissolve: "fade",
  fly: "fly",
  float: "float",
  floating: "float",
  riseUp: "float",
  sinkDown: "sink",
  wipe: "wipe",
  peek: "wipe",
  split: "split",
  zoom: "zoom",
  basicZoom: "grow-in",
  expand: "grow-in",
  contract: "grow-in",
  stretch: "stretch",
  stretchy: "stretch",
  growTurn: "turn",
  shrinkTurn: "turn",
  pulse: "pulse",
  growShrink: "grow",
  spin: "spin",
  teeter: "teeter",
  transparency: "transparency",
  blink: "blink",
};

function phaseOf(step: SlideAnimationStep): Phase {
  if (step.presetClass === "entr") return "entrance";
  if (step.presetClass === "exit") return "exit";
  if (step.presetClass) return "emphasis";
  const name = step.effect ?? "";
  if (name === "appear" || name.endsWith("In")) return "entrance";
  if (name === "disappear" || name.endsWith("Out")) return "exit";
  return "emphasis";
}

function styleOf(step: SlideAnimationStep, phase: Phase): EffectStyle {
  const name = (step.effect ?? "").replace(/(In|Out)$/, "");
  const style = STYLE[name];
  if (!style) return phase === "emphasis" ? "dip" : "fade";
  const emphasis = ["pulse", "grow", "spin", "teeter", "transparency", "blink"].includes(style);
  if (emphasis !== (phase === "emphasis")) return phase === "emphasis" ? "dip" : "fade";
  return style;
}

function amountOf(step: SlideAnimationStep, style: EffectStyle): number | null {
  if (style === "grow") return (step.scalePercent ?? 150) / 100;
  if (style === "spin")
    return (step.spinDegrees ?? 360) * (step.spinDirection === "counterclockwise" ? -1 : 1);
  if (style === "transparency") return (step.transparencyPercent ?? 50) / 100;
  return null;
}

export function targetKey(target: Target): string {
  return target.paragraphs
    ? `${target.shapeId}:${target.paragraphs[0]}-${target.paragraphs[1]}`
    : String(target.shapeId);
}

function targetOf(step: SlideAnimationStep): Target | null {
  const t = step.target;
  if (t.kind === "paragraphs")
    return { shapeId: t.shapeId, paragraphs: [t.firstParagraph, t.lastParagraph] };
  if (t.kind === "shape") return { shapeId: t.shapeId, paragraphs: null };
  return t.shapeId === null ? null : { shapeId: t.shapeId, paragraphs: null };
}

/**
 * The slide's click order from its timing: each click starts a build, and an effect set to run
 * with the previous one starts with it, or after the build so far when set to run after it, each
 * then waiting its own delay. Effects before the first click run as the slide appears. Only the
 * main sequence plays on clicks; effects triggered by clicking a shape are left out.
 */
export function buildsOf(steps: readonly SlideAnimationStep[]): {
  onEntry: Build | null;
  clicks: Build[];
} {
  let onEntry: Build | null = null;
  const clicks: Build[] = [];
  let current: Build | null = null;
  let groupStart = 0;
  for (const step of steps) {
    if (step.sequence !== "mainSeq") continue;
    const target = targetOf(step);
    if (!target) continue;
    if (step.start === "click" || step.start === "unknown" || !current) {
      current = { effects: [], durationMs: 0 };
      if (step.start === "click" || step.start === "unknown") clicks.push(current);
      else onEntry = current;
      groupStart = 0;
    } else if (step.start === "afterPrevious") {
      groupStart = current.durationMs;
    }
    const phase = phaseOf(step);
    const style = styleOf(step, phase);
    const durationMs = style === "appear" ? 0 : (step.durationMs ?? DEFAULT_EFFECT_MS);
    const startMs = groupStart + Math.max(0, step.delayMs ?? 0);
    current.effects.push({
      target,
      phase,
      style,
      side: step.direction ? (SIDES[step.direction] ?? null) : null,
      orientation: step.orientation ?? "vertical",
      inward: step.inOut === "in",
      amount: amountOf(step, style),
      axis: step.scaleDirection ?? "both",
      startMs,
      durationMs,
    });
    current.durationMs = Math.max(current.durationMs, startMs + durationMs);
  }
  return { onEntry, clicks };
}

/** Everything the slideshow needs to play a slide's transition and builds. */
export function slideMotion(slide: SlideData): SlideMotion {
  const { onEntry, clicks } = buildsOf(getSlideAnimations(slide));
  const targets = new Map<string, Target>();
  for (const build of onEntry ? [onEntry, ...clicks] : clicks) {
    for (const effect of build.effects) targets.set(targetKey(effect.target), effect.target);
  }
  return { change: slideChange(getSlideTransition(slide)), onEntry, clicks, targets };
}

/** Whether the rail should mark the slide as having builds or a transition. */
export function motionSummary(slide: SlideData): "animations" | "transition" | null {
  if (getSlideAnimations(slide).some((step) => step.sequence === "mainSeq")) return "animations";
  const transition = getSlideTransition(slide);
  return transition && transition.effect !== "none" ? "transition" : null;
}

/**
 * Targets hidden once `clicks` builds have run (and the arrival build, when `entered`): a target
 * whose first effect brings it on starts hidden, and each entrance or exit after that decides.
 */
export function hiddenTargets(motion: SlideMotion, clicks: number, entered: boolean): Set<string> {
  const hidden = new Set<string>();
  const seen = new Set<string>();
  const all = motion.onEntry ? [motion.onEntry, ...motion.clicks] : motion.clicks;
  for (const build of all) {
    for (const effect of build.effects) {
      const key = targetKey(effect.target);
      if (seen.has(key) || effect.phase === "emphasis") continue;
      seen.add(key);
      if (effect.phase === "entrance") hidden.add(key);
    }
  }
  const done = [
    ...(entered && motion.onEntry ? [motion.onEntry] : []),
    ...motion.clicks.slice(0, clicks),
  ];
  for (const build of done) {
    for (const effect of [...build.effects].sort(
      (a, b) => a.startMs + a.durationMs - (b.startMs + b.durationMs),
    )) {
      const key = targetKey(effect.target);
      if (effect.phase === "entrance") hidden.delete(key);
      else if (effect.phase === "exit") hidden.add(key);
    }
  }
  return hidden;
}

const px = (value: number) => `${Math.round(value * 100) / 100}px`;

/** How far a shape travels to sit just off the slide on `side`. */
function offSlide(side: Vector, slide: Size, box: Box | null): { dx: number; dy: number } {
  const b = box ?? { x: 0, y: 0, w: slide.w, h: slide.h };
  const dx = side.x < 0 ? -(b.x + b.w) : side.x > 0 ? slide.w - b.x : 0;
  const dy = side.y < 0 ? -(b.y + b.h) : side.y > 0 ? slide.h - b.y : 0;
  return { dx, dy };
}

/** `inset()` that hides everything but the edge on `side`. */
function insetFrom(side: Vector): string {
  const top = side.y > 0 ? 100 : 0;
  const bottom = side.y < 0 ? 100 : 0;
  const left = side.x > 0 ? 100 : 0;
  const right = side.x < 0 ? 100 : 0;
  return `inset(${top}% ${right}% ${bottom}% ${left}%)`;
}

function scaleOf(axis: Effect["axis"], value: number): string {
  if (axis === "horizontal") return `scale(${value}, 1)`;
  if (axis === "vertical") return `scale(1, ${value})`;
  return `scale(${value})`;
}

/**
 * The effect's keyframes, written as an entrance (hidden → shown) for entrances and exits alike;
 * the player runs an exit's backwards. `box` is the shape's place on the slide, when known.
 */
export function effectKeyframes(effect: Effect, slide: Size, box: Box | null): Keyframe[] {
  const reverse = effect.phase === "exit";
  const comeFrom = (fallback: Vector) => effect.side ?? fallback;
  switch (effect.style) {
    case "appear":
      return [{ opacity: 0 }, { opacity: 1 }];
    case "fly": {
      const { dx, dy } = offSlide(comeFrom({ x: 0, y: 1 }), slide, box);
      return [
        { transform: `translate(${px(dx)}, ${px(dy)})` },
        { transform: "translate(0px, 0px)" },
      ];
    }
    case "float":
    case "sink": {
      const rises = (effect.style === "float") !== reverse;
      const dy = (rises ? 1 : -1) * slide.h * 0.1;
      return [
        { opacity: 0, transform: `translate(0px, ${px(dy)})` },
        { opacity: 1, transform: "translate(0px, 0px)" },
      ];
    }
    case "wipe": {
      const side = comeFrom({ x: 0, y: 1 });
      // An exit wipe takes away the edge it names first, so it runs backwards from the far edge.
      const from = reverse ? ({ x: -side.x, y: -side.y } as Vector) : side;
      return [{ clipPath: insetFrom(from) }, { clipPath: "inset(0% 0% 0% 0%)" }];
    }
    case "split": {
      const closed =
        effect.orientation === "vertical" ? "inset(0% 50% 0% 50%)" : "inset(50% 0% 50% 0%)";
      return [{ clipPath: closed }, { clipPath: "inset(0% 0% 0% 0%)" }];
    }
    case "zoom":
      return [
        { opacity: 0, transform: "scale(0.3)" },
        { opacity: 1, transform: "scale(1)" },
      ];
    case "grow-in":
      return [{ transform: "scale(0)" }, { transform: "scale(1)" }];
    case "stretch":
      return [{ transform: "scale(0, 1)" }, { transform: "scale(1, 1)" }];
    case "turn":
      return [
        { opacity: 0, transform: "scale(0) rotate(-90deg)" },
        { opacity: 1, transform: "scale(1) rotate(0deg)" },
      ];
    case "pulse":
      return [{ transform: "scale(1)" }, { transform: "scale(1.06)" }, { transform: "scale(1)" }];
    case "grow":
      return [
        { transform: scaleOf(effect.axis, 1) },
        { transform: scaleOf(effect.axis, effect.amount ?? 1.5) },
      ];
    case "spin":
      return [{ transform: "rotate(0deg)" }, { transform: `rotate(${effect.amount ?? 360}deg)` }];
    case "teeter":
      return [0, 4, -4, 4, -4, 0].map((deg) => ({ transform: `rotate(${deg}deg)` }));
    case "transparency":
      return [{ opacity: 1 }, { opacity: 1 - (effect.amount ?? 0.5) }];
    case "blink":
      return [{ opacity: 1 }, { opacity: 0 }, { opacity: 1 }];
    case "dip":
      return [{ opacity: 1 }, { opacity: 0.5 }, { opacity: 1 }];
    default:
      return [{ opacity: 0 }, { opacity: 1 }];
  }
}

/** Whether an emphasis keeps its end state until the slide changes. */
export function holdsAfterEnd(effect: Effect): boolean {
  return effect.style === "grow" || effect.style === "spin" || effect.style === "transparency";
}

/** Keyframes for the slide arriving (`incoming`) and the one leaving, or null for no movement. */
export function changeKeyframes(change: SlideChange): {
  incoming: Keyframe[] | null;
  outgoing: Keyframe[] | null;
  /** Whether the leaving slide is drawn over the arriving one. */
  outgoingOnTop: boolean;
} {
  const { x, y } = change.toward;
  const shift = (fx: number, fy: number) => `translate(${fx * 100}%, ${fy * 100}%)`;
  switch (change.kind) {
    case "none":
      return { incoming: null, outgoing: null, outgoingOnTop: false };
    case "push":
      return {
        incoming: [{ transform: shift(-x, -y) }, { transform: shift(0, 0) }],
        outgoing: [{ transform: shift(0, 0) }, { transform: shift(x, y) }],
        outgoingOnTop: false,
      };
    case "cover":
      return {
        incoming: [{ transform: shift(-x, -y) }, { transform: shift(0, 0) }],
        outgoing: null,
        outgoingOnTop: false,
      };
    case "uncover":
      return {
        incoming: null,
        outgoing: [{ transform: shift(0, 0) }, { transform: shift(x, y) }],
        outgoingOnTop: true,
      };
    case "wipe":
      // The wipe travels `toward`, so the new slide shows first at the opposite edge.
      return {
        incoming: [
          { clipPath: insetFrom({ x: -x, y: -y } as Vector) },
          { clipPath: "inset(0% 0% 0% 0%)" },
        ],
        outgoing: null,
        outgoingOnTop: false,
      };
    case "split": {
      const centre =
        change.orientation === "vertical" ? "inset(0% 50% 0% 50%)" : "inset(50% 0% 50% 0%)";
      return change.inward
        ? {
            incoming: null,
            outgoing: [{ clipPath: "inset(0% 0% 0% 0%)" }, { clipPath: centre }],
            outgoingOnTop: true,
          }
        : {
            incoming: [{ clipPath: centre }, { clipPath: "inset(0% 0% 0% 0%)" }],
            outgoing: null,
            outgoingOnTop: false,
          };
    }
    case "zoom":
      return {
        incoming: [
          { opacity: 0, transform: `scale(${change.inward ? 1.6 : 0.4})` },
          { opacity: 1, transform: "scale(1)" },
        ],
        outgoing: null,
        outgoingOnTop: false,
      };
    default:
      return change.thruBlack
        ? {
            incoming: [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }],
            outgoing: [{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }],
            outgoingOnTop: true,
          }
        : { incoming: [{ opacity: 0 }, { opacity: 1 }], outgoing: null, outgoingOnTop: false };
  }
}
