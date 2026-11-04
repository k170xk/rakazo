// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  type BrandProps,
  list,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "animated-list",
  category: "content",
  description:
    "A short list whose items spring in one after another beside numbered brand-colour discs. Use it for services, key points or project scope.",
  props: {
    items:
      'string[] (default ["Civil & Structural", "Building Services", "Transport & Water"])',
    dark: "boolean: dark OCSC background, false for a light one (default false: white)",
  },
  seconds: 4,
  media: "none",
  fits: "3-5 items of up to 4 words.",
  instead: "content or icon_list when each point needs a description.",
};

type Props = BrandProps & {
  items?: string[];
  dark?: boolean;
};

export default function AnimatedList(props: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const items = list<unknown>(props.items, [
    "Civil & Structural",
    "Building Services",
    "Transport & Water",
  ])
    .slice(0, 6)
    .map((item, i) => str(item, `Item ${i + 1}`));
  const colors = [p.primary, p.light, p.lighter];

  // Three items were designed at 80px; more items shrink so the list still fits the frame.
  const dot = Math.min(80, (stage.height * 0.75) / items.length - 16);
  const fontSize = Math.min(stage.vertical ? 34 : 48, dot * 0.62);

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: stage.vertical ? "0 32px" : "0 0 0 180px",
        }}
      >
        {items.map((item, i) => {
          const delay = i * 5;
          const config = { damping: 12, mass: 0.5 };
          const slideX = spring({ frame: frame - delay, fps, from: -100, to: 0, config });
          const opacity = spring({ frame: frame - delay, fps, from: 0, to: 1, config });
          const scale = spring({ frame: frame - delay, fps, from: 0.3, to: 1, config });

          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                marginBottom: 16,
                transform: `translateX(${slideX}px) scale(${scale})`,
                transformOrigin: "left center",
                opacity,
              }}
            >
              <div
                style={{
                  width: dot,
                  height: dot,
                  flexShrink: 0,
                  borderRadius: "50%",
                  backgroundColor: colors[i % colors.length],
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                  color: p.ink,
                  fontSize: dot * 0.4,
                  fontWeight: 700,
                }}
              >
                {i + 1}
              </div>
              <span
                style={{
                  color: dark ? p.onDark : p.text,
                  fontSize,
                  fontWeight: 500,
                  lineHeight: 1.1,
                }}
              >
                {item}
              </span>
            </div>
          );
        })}
      </div>
    </Stage>
  );
}
