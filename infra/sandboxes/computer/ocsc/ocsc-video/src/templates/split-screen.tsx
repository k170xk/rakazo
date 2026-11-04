// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  list,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

const IMAGES = [
  "https://images.pexels.com/photos/3862384/pexels-photo-3862384.jpeg?auto=compress&cs=tinysrgb&w=1920",
  "https://images.pexels.com/photos/5504388/pexels-photo-5504388.jpeg?auto=compress&cs=tinysrgb&w=1920",
];

export const meta: TemplateMeta = {
  name: "split-screen",
  category: "media",
  description:
    "Two photo panels slide in from opposite sides to meet at a glowing divider, each with a title and line of text (stacked top and bottom in vertical videos). Use to compare two stages, services or options.",
  props: {
    imageUrls: "string[]: the two panel photos (default engineers with drawings, tower cranes)",
    leftTitle: 'string (default "Design")',
    leftText: 'string (default "Engineers develop the scheme in detail")',
    rightTitle: 'string (default "Delivery")',
    rightText: 'string (default "On site from groundworks to handover")',
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 5,
  media: "two photos",
  fits: "A title of up to 3 words and one line of text a side.",
  instead: "comparison for points in words; image-comparison-slider for the same view before and after.",
  fullBleed: true,
};

type Props = BrandProps & {
  imageUrls?: string[];
  leftTitle?: string;
  leftText?: string;
  rightTitle?: string;
  rightText?: string;
  dark?: boolean;
};

export default function SplitScreen(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const vertical = stage.vertical;
  const dark = props.dark === true;

  const images = list<string>(props.imageUrls, IMAGES);
  const firstSlide = spring({ frame, fps, config: { damping: 15, stiffness: 80 } });
  const secondSlide = spring({ frame: frame - 5, fps, config: { damping: 15, stiffness: 80 } });
  const firstShift = interpolate(firstSlide, [0, 1], [-100, 0]);
  const secondShift = interpolate(secondSlide, [0, 1], [100, 0]);
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const dividerOpacity = interpolate(frame, [fps * 0.6, fps * 0.9], [0, 1], clamp);
  const textIn = interpolate(frame, [fps * 0.4, fps * 0.9], [0, 1], clamp);
  const drift = interpolate(frame, [0, durationInFrames], [1, 1.08], clamp);

  const panels = [
    {
      src: images[0],
      title: str(props.leftTitle, "Design"),
      text: str(props.leftText, "Engineers develop the scheme in detail"),
      shift: firstShift,
      tint: dark ? alpha(p.ink, 0.62) : alpha(p.paper, 0.18),
    },
    {
      src: images[1] ?? images[0],
      title: str(props.rightTitle, "Delivery"),
      text: str(props.rightText, "On site from groundworks to handover"),
      shift: secondShift,
      tint: dark ? alpha(p.dark, 0.55) : alpha(p.paper, 0.18),
    },
  ];

  return (
    <Stage background={dark ? p.darkGradient : p.paper}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: vertical ? "column" : "row",
        }}
      >
        {panels.map((panel, i) => (
          <div
            key={i}
            style={{
              position: "relative",
              flex: 1,
              overflow: "hidden",
              transform: vertical
                ? `translateY(${panel.shift}%)`
                : `translateX(${panel.shift}%)`,
            }}
          >
            <Img
              src={panel.src}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: `scale(${drift})`,
              }}
            />
            <div style={{ position: "absolute", inset: 0, background: panel.tint }} />
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                padding: 32,
                textAlign: "center",
                opacity: textIn,
                transform: `translateY(${(1 - textIn) * 12}px)`,
              }}
            >
              <div
                style={
                  dark
                    ? { display: "contents" }
                    : {
                        background: p.paper,
                        border: `1px solid ${alpha(p.primary, 0.18)}`,
                        borderRadius: 14,
                        boxShadow: "0 10px 30px rgba(15, 23, 42, 0.18)",
                        padding: "24px 30px",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                      }
                }
              >
                <h2
                  style={{
                    color: dark ? p.onDark : p.text,
                    fontSize: 40,
                    fontWeight: 700,
                    margin: 0,
                  }}
                >
                  {panel.title}
                </h2>
                <div
                  style={{ width: 48, height: 3, background: p.primary, borderRadius: 2, marginTop: 12 }}
                />
                <p
                  style={{
                    color: dark ? p.lighter : p.textMuted,
                    fontSize: 16,
                    marginTop: 12,
                    marginBottom: 0,
                    maxWidth: 360,
                  }}
                >
                  {panel.text}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div
        style={
          vertical
            ? {
                position: "absolute",
                left: "10%",
                right: "10%",
                top: "50%",
                height: 2,
                marginTop: -1,
                background: `linear-gradient(90deg, transparent, ${dark ? "rgba(255, 255, 255, 0.8)" : p.primary}, transparent)`,
                opacity: dividerOpacity,
              }
            : {
                position: "absolute",
                top: "10%",
                bottom: "10%",
                left: "50%",
                width: 2,
                marginLeft: -1,
                background: `linear-gradient(180deg, transparent, ${dark ? "rgba(255, 255, 255, 0.8)" : p.primary}, transparent)`,
                opacity: dividerOpacity,
              }
        }
      />
    </Stage>
  );
}
