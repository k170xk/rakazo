import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  random,
  useCurrentFrame,
} from "remotion";
import { mix, OCSC_INK } from "../templates/kit";
import type { TransitionType } from "../types";

const ease = Easing.bezier(0.65, 0, 0.35, 1);
const progress = (frame: number, start: number, frames: number) =>
  interpolate(frame, [start, start + frames], [0, 1], {
    easing: ease,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

/** A clip-path wedge from 12 o'clock, clockwise through `turn` of a full circle. */
function clockWedge(turn: number): string {
  const points = ["50% 50%", "50% -100%"];
  const steps = Math.ceil(turn * 72);
  for (let i = 1; i <= steps; i += 1) {
    const a = Math.min(turn, i / 72) * Math.PI * 2;
    points.push(`${50 + Math.sin(a) * 150}% ${50 - Math.cos(a) * 150}%`);
  }
  return `polygon(${points.join(", ")})`;
}

const PIXEL_COLS = 16;
const PIXEL_ROWS = 9;

/**
 * A scene's entrance over the end of the one before it. The scene below is still on screen, so a
 * fade is a true cross-dissolve and a wipe or iris reveals the new scene over the old.
 * Iris, clock wipe, blinds, pixel, brand wipe, dip, zoom, whip and morph follow the transitions in
 * Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
 */
export const TransitionIn: React.FC<{
  type: TransitionType;
  frames: number;
  brandColor?: string;
  children: ReactNode;
}> = ({ type, frames, brandColor = "#76bf43", children }) => {
  const frame = useCurrentFrame();
  // Opaque, so the scene underneath never shows through a scene with no background of its own.
  const base: CSSProperties = { backgroundColor: "#ffffff" };
  if (type === "none" || frames <= 0 || frame >= frames)
    return <AbsoluteFill style={base}>{children}</AbsoluteFill>;
  const p = progress(frame, 0, frames);
  const layer = (style: CSSProperties, over?: ReactNode) => (
    <>
      <AbsoluteFill style={{ ...base, ...style }}>{children}</AbsoluteFill>
      {over}
    </>
  );

  switch (type) {
    case "slide":
      return layer({ transform: `translateX(${(1 - p) * 100}%)` });
    case "wipe":
      return layer({ clipPath: `inset(0 ${(1 - p) * 100}% 0 0)` });
    case "flip":
      return layer({
        transform: `perspective(2000px) rotateY(${(1 - p) * -90}deg)`,
        transformOrigin: "left center",
        opacity: Math.min(1, p * 2),
      });
    case "iris":
      return layer({ clipPath: `circle(${p * 75}% at 50% 50%)` });
    case "clock-wipe":
      return layer({ clipPath: clockWedge(p) });
    case "blinds": {
      const slat = 100 / 8;
      const open = p * slat;
      const mask = `repeating-linear-gradient(to bottom, #000 0%, #000 ${open}%, transparent ${open}%, transparent ${slat}%)`;
      return layer({ WebkitMaskImage: mask, maskImage: mask });
    }
    case "zoom":
      return layer({ transform: `scale(${0.82 + 0.18 * p})`, opacity: p });
    case "morph":
      return layer({
        transform: `scale(${1.12 - 0.12 * p})`,
        opacity: p,
        filter: `blur(${(1 - p) * 14}px)`,
      });
    case "whip": {
      const q = progress(frame, 0, frames);
      return layer({
        transform: `translateX(${(1 - q) * 100}%)`,
        filter: `blur(${Math.sin(q * Math.PI) * 18}px)`,
      });
    }
    case "dip": {
      // Down to OCSC dark over the old scene, then up from it into the new one.
      if (p < 0.5)
        return (
          <AbsoluteFill style={{ backgroundColor: OCSC_INK, opacity: p * 2 }} />
        );
      return layer(
        {},
        <AbsoluteFill
          style={{ backgroundColor: OCSC_INK, opacity: (1 - p) * 2 }}
        />,
      );
    }
    case "brand-wipe": {
      // Two brand panels sweep across; the new scene is revealed behind them.
      const lead = p * 2.2;
      const panel = (offset: number, color: string) => {
        const right = lead - offset;
        return (
          <AbsoluteFill
            style={{
              backgroundColor: color,
              clipPath: `inset(0 ${Math.max(0, (1 - right) * 100)}% 0 ${Math.max(0, (right - 1) * 100)}%)`,
            }}
          />
        );
      };
      const revealed = Math.max(0, Math.min(1, lead - 1.2));
      return layer(
        { clipPath: `inset(0 ${(1 - revealed) * 100}% 0 0)` },
        <>
          {panel(0.2, mix(brandColor, OCSC_INK, 0.55))}
          {panel(0, brandColor)}
        </>,
      );
    }
    case "pixel": {
      // Brand-green squares fill the frame over the old scene, then clear over the new one.
      const cells = [];
      for (let r = 0; r < PIXEL_ROWS; r += 1)
        for (let c = 0; c < PIXEL_COLS; c += 1) {
          const t = random(`px-${r}-${c}`) * 0.45;
          const on = p >= t && p < t + 0.55;
          if (!on) continue;
          cells.push(
            <div
              key={`${r}-${c}`}
              style={{
                position: "absolute",
                left: `${(c * 100) / PIXEL_COLS}%`,
                top: `${(r * 100) / PIXEL_ROWS}%`,
                width: `${100 / PIXEL_COLS + 0.1}%`,
                height: `${100 / PIXEL_ROWS + 0.1}%`,
                backgroundColor:
                  (r + c) % 3 === 0 ? mix(brandColor, OCSC_INK, 0.4) : brandColor,
              }}
            />,
          );
        }
      return (
        <>
          {p >= 0.5 && <AbsoluteFill style={base}>{children}</AbsoluteFill>}
          <AbsoluteFill>{cells}</AbsoluteFill>
        </>
      );
    }
    default:
      return layer({ opacity: p });
  }
};

/** A scene's exit under the next scene's entrance, for the transitions that move the old scene too. */
export const TransitionOut: React.FC<{
  type: TransitionType;
  start: number;
  frames: number;
  children: ReactNode;
}> = ({ type, start, frames, children }) => {
  const frame = useCurrentFrame();
  if (frames <= 0 || frame < start) return <AbsoluteFill>{children}</AbsoluteFill>;
  const p = progress(frame, start, frames);
  let style: CSSProperties | null = null;
  if (type === "slide") style = { transform: `translateX(${-p * 100}%)` };
  else if (type === "whip")
    style = {
      transform: `translateX(${-p * 100}%)`,
      filter: `blur(${Math.sin(p * Math.PI) * 18}px)`,
    };
  else if (type === "zoom")
    style = { transform: `scale(${1 + 0.35 * p})`, opacity: 1 - p };
  else if (type === "morph")
    style = { transform: `scale(${1 - 0.06 * p})`, filter: `blur(${p * 10}px)` };
  if (!style) return <AbsoluteFill>{children}</AbsoluteFill>;
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};

export const TRANSITIONS: TransitionType[] = [
  "none",
  "fade",
  "slide",
  "wipe",
  "flip",
  "iris",
  "clock-wipe",
  "blinds",
  "pixel",
  "brand-wipe",
  "dip",
  "zoom",
  "whip",
  "morph",
];
