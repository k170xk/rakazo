import type {
  AnimationOptions,
  PresentationData,
  SlideData,
  SlideShapeData,
} from "@office-kit/pptx";
import {
  addBlankSlide,
  addSlideShape,
  createPresentation,
  emu,
  getShapeId,
  getSlides,
  loadPresentation,
  savePresentation,
  setShapeAnimation,
  setSlideTransition,
} from "@office-kit/pptx";
import { describe, expect, it } from "vitest";
import {
  changeKeyframes,
  effectKeyframes,
  hiddenTargets,
  motionSummary,
  slideChange,
  slideMotion,
} from "./motion";

const owners = new WeakMap<SlideData, PresentationData>();

/** The slide written to a file and read back, so the timing is parsed from real XML. */
async function reread(slide: SlideData): Promise<SlideData> {
  const pres = owners.get(slide);
  if (!pres) throw new Error("unknown slide");
  const reloaded = getSlides(await loadPresentation(await savePresentation(pres)))[0];
  if (!reloaded) throw new Error("no slide");
  return reloaded;
}

function deck(count: number) {
  const pres = createPresentation();
  const slide = addBlankSlide(pres);
  owners.set(slide, pres);
  const shapes = Array.from({ length: count }, (_, i) =>
    addSlideShape(slide, {
      preset: "rect",
      x: emu(914400 * (i + 1)),
      y: emu(914400),
      w: emu(914400),
      h: emu(914400),
      text: `Shape ${i + 1}`,
    }),
  );
  return { pres, slide, shapes };
}

function animate(shape: SlideShapeData, opts: AnimationOptions) {
  setShapeAnimation(shape, opts);
}

describe("slideChange", () => {
  it("reads the effect, its direction and its length", () => {
    expect(slideChange({ effect: "push", direction: "u", speed: "slow" })).toMatchObject({
      kind: "push",
      toward: { x: 0, y: -1 },
      durationMs: 1000,
    });
    expect(slideChange({ effect: "fade", durationMs: 1200 })).toMatchObject({
      kind: "fade",
      durationMs: 1200,
    });
    expect(slideChange({ effect: "split", orientation: "vert", direction: "in" })).toMatchObject({
      kind: "split",
      orientation: "vertical",
      inward: true,
    });
  });

  it("plays effects it does not draw as a fade, and none or cut as a straight change", () => {
    expect(slideChange({ effect: "morph" }).kind).toBe("fade");
    expect(slideChange({ effect: "vortex", direction: "l" }).kind).toBe("fade");
    expect(slideChange({ effect: "cut" })).toMatchObject({ kind: "none", durationMs: 0 });
    expect(slideChange(null).kind).toBe("none");
  });

  it("brings a pushed slide in from the side opposite the way it moves", () => {
    const frames = changeKeyframes(slideChange({ effect: "push", direction: "l" }));
    expect(frames.incoming?.[0]).toEqual({ transform: "translate(100%, 0%)" });
    expect(frames.outgoing?.at(-1)).toEqual({ transform: "translate(-100%, 0%)" });
  });

  it("reads the transition back from a saved file", async () => {
    const { slide } = deck(1);
    setSlideTransition(slide, { effect: "wipe", direction: "r", durationMs: 800 });
    const motion = slideMotion(await reread(slide));
    expect(motion.change).toMatchObject({ kind: "wipe", toward: { x: 1, y: 0 }, durationMs: 800 });
    expect(changeKeyframes(motion.change).incoming?.[0]).toEqual({
      clipPath: "inset(0% 100% 0% 0%)",
    });
  });
});

describe("slideMotion", () => {
  it("groups effects into clicks, timing 'with' and 'after previous' within each", async () => {
    const { slide, shapes } = deck(4);
    const [a, b, c, d] = shapes as [SlideShapeData, SlideShapeData, SlideShapeData, SlideShapeData];
    animate(a, { effect: "fadeIn", durationMs: 500 });
    animate(b, { effect: "flyIn", direction: "left", start: "withPrevious", delayMs: 200 });
    animate(c, { effect: "zoomIn", start: "afterPrevious", durationMs: 400, delayMs: 100 });
    animate(d, { effect: "fadeOut", durationMs: 300 });

    const motion = slideMotion(await reread(slide));
    expect(motion.onEntry).toBeNull();
    expect(motion.clicks).toHaveLength(2);
    const [first, second] = motion.clicks;
    const flyMs = first?.effects[1]?.durationMs ?? 0;
    expect(first?.effects.map((e) => [e.target.shapeId, e.style, e.startMs])).toEqual([
      [getShapeId(a), "fade", 0],
      [getShapeId(b), "fly", 200],
      [getShapeId(c), "zoom", Math.max(500, 200 + flyMs) + 100],
    ]);
    expect(first?.effects[1]?.side).toEqual({ x: -1, y: 0 });
    expect(first?.durationMs).toBe(Math.max(500, 200 + flyMs) + 100 + 400);
    expect(second?.effects.map((e) => [e.phase, e.style])).toEqual([["exit", "fade"]]);
  });

  it("runs effects before the first click as the slide appears", async () => {
    const { slide, shapes } = deck(3);
    const [a, b, c] = shapes as [SlideShapeData, SlideShapeData, SlideShapeData];
    animate(a, { effect: "wipeIn", direction: "left", start: "afterPrevious" });
    animate(b, { effect: "floatIn", start: "withPrevious", delayMs: 145 });
    animate(c, { effect: "pulse" });

    const motion = slideMotion(await reread(slide));
    expect(motion.onEntry?.effects.map((e) => [e.style, e.startMs])).toEqual([
      ["wipe", 0],
      ["float", 145],
    ]);
    expect(motion.clicks.map((build) => build.effects.map((e) => e.phase))).toEqual([["emphasis"]]);
    expect(motionSummary(slide)).toBe("animations");
  });

  it("falls back to a fade for effects it does not draw", async () => {
    const { slide, shapes } = deck(2);
    const [a, b] = shapes as [SlideShapeData, SlideShapeData];
    animate(a, { effect: "bounceIn" });
    animate(b, { effect: "fontColor", color: "#FF0000" });
    const [enter, emphasis] = slideMotion(await reread(slide)).clicks;
    expect(enter?.effects[0]).toMatchObject({ phase: "entrance", style: "fade" });
    expect(emphasis?.effects[0]).toMatchObject({ phase: "emphasis", style: "dip" });
  });
});

describe("hiddenTargets", () => {
  it("hides shapes until their entrance and after their exit, step by step", async () => {
    const { slide, shapes } = deck(3);
    const [a, b, c] = shapes as [SlideShapeData, SlideShapeData, SlideShapeData];
    animate(a, { effect: "appear", start: "withPrevious" });
    animate(b, { effect: "flyIn" });
    animate(c, { effect: "fadeOut" });
    animate(b, { effect: "fadeOut", start: "withPrevious" });
    const motion = slideMotion(await reread(slide));
    const [ia, ib, ic] = shapes.map((shape) => String(getShapeId(shape)));

    expect(hiddenTargets(motion, 0, false)).toEqual(new Set([ia, ib]));
    expect(hiddenTargets(motion, 0, true)).toEqual(new Set([ib]));
    expect(hiddenTargets(motion, 1, true)).toEqual(new Set());
    expect(hiddenTargets(motion, 2, true)).toEqual(new Set([ib, ic]));
  });

  it("leaves a slide without builds as it is", () => {
    const { slide } = deck(2);
    expect(hiddenTargets(slideMotion(slide), 0, false).size).toBe(0);
    expect(motionSummary(slide)).toBeNull();
    setSlideTransition(slide, { effect: "fade" });
    expect(motionSummary(slide)).toBe("transition");
  });
});

describe("effectKeyframes", () => {
  const slide = { w: 1280, h: 720 };
  const box = { x: 100, y: 200, w: 300, h: 100 };
  const base = {
    target: { shapeId: 2, paragraphs: null },
    orientation: "vertical" as const,
    inward: false,
    amount: null,
    axis: "both" as const,
    startMs: 0,
    durationMs: 500,
  };

  it("flies a shape in from just off the named edge", () => {
    const fromLeft = effectKeyframes(
      { ...base, phase: "entrance", style: "fly", side: { x: -1, y: 0 } },
      slide,
      box,
    );
    expect(fromLeft[0]).toEqual({ transform: "translate(-400px, 0px)" });
    const fromBottom = effectKeyframes(
      { ...base, phase: "entrance", style: "fly", side: null },
      slide,
      box,
    );
    expect(fromBottom[0]).toEqual({ transform: "translate(0px, 520px)" });
  });

  it("wipes in from the named edge and out towards it", () => {
    const wipe = { ...base, style: "wipe" as const, side: { x: -1 as const, y: 0 as const } };
    expect(effectKeyframes({ ...wipe, phase: "entrance" }, slide, box)[0]).toEqual({
      clipPath: "inset(0% 100% 0% 0%)",
    });
    // Played backwards, an exit wipe from the left ends showing only the right edge.
    expect(effectKeyframes({ ...wipe, phase: "exit" }, slide, box)[0]).toEqual({
      clipPath: "inset(0% 0% 0% 100%)",
    });
  });
});
