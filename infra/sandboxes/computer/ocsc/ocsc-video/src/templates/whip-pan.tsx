// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  list,
  palette,
  Stage,
  type TemplateMeta,
  useStage,
} from "./kit";

const DEFAULT_IMAGES = [
  "https://images.pexels.com/photos/5504388/pexels-photo-5504388.jpeg?auto=compress&cs=tinysrgb&w=1920",
  "https://images.pexels.com/photos/3862384/pexels-photo-3862384.jpeg?auto=compress&cs=tinysrgb&w=1920",
];
const DEFAULT_HEADINGS = ["On site", "In the studio"];
const DEFAULT_SUBHEADINGS = [
  "Civil and structural engineering",
  "Design from brief to handover",
];

export const meta: TemplateMeta = {
  name: "whip-pan",
  category: "cinematic",
  description:
    "A fast, motion-blurred camera whip from one photo and title to a second. Use it to cut energetically between two related ideas, such as before and after or site and studio.",
  props: {
    imageUrls: `string[]: the two photos (default ["${DEFAULT_IMAGES[0]}", "${DEFAULT_IMAGES[1]}"], tower cranes then engineers with drawings)`,
    headings: `string[]: a heading for each photo (default ${JSON.stringify(DEFAULT_HEADINGS)})`,
    subheadings: `string[]: a line under each heading (default ${JSON.stringify(DEFAULT_SUBHEADINGS)})`,
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 4,
  media: "two photos",
  fits: "Two titles of up to 3 words each.",
  instead: "split-screen to show both at once.",
  fullBleed: true,
};

type Props = BrandProps & {
  imageUrls?: string[];
  headings?: string[];
  subheadings?: string[];
  dark?: boolean;
};

const pick = (items: string[], fallback: string[], i: number): string => {
  const v = items[i];
  return typeof v === "string" && v.trim() ? v : fallback[i];
};

export default function WhipPan(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const images = list<string>(props.imageUrls, DEFAULT_IMAGES);
  const headings = list<string>(props.headings, DEFAULT_HEADINGS);
  const subheadings = list<string>(props.subheadings, DEFAULT_SUBHEADINGS);

  const panStart = Math.round(durationInFrames * 0.45);
  const panEnd = panStart + Math.max(8, Math.round(fps * 0.4));
  const panMid = (panStart + panEnd) / 2;
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

  const translateA = interpolate(frame, [panStart, panEnd], [0, -100], clamp);
  const translateB = interpolate(frame, [panStart, panEnd], [100, 0], clamp);
  // Stretch and blur during the whip stand in for motion blur.
  const stretchX = interpolate(frame, [panStart, panMid, panEnd], [1, 1.6, 1], clamp);
  const blur = interpolate(frame, [panStart, panMid, panEnd], [0, 14, 0], clamp);

  const scenes = [
    {
      translate: translateA,
      textIn: spring({ frame: frame - 5, fps, config: { damping: 15, mass: 0.7 } }),
      drift: interpolate(frame, [0, panEnd], [1.08, 1.02], clamp),
    },
    {
      translate: translateB,
      textIn: spring({ frame: frame - panEnd, fps, config: { damping: 15, mass: 0.7 } }),
      drift: interpolate(frame, [panStart, durationInFrames], [1.02, 1.08], clamp),
    },
  ];

  return (
    <Stage background={dark ? p.ink : p.paper}>
      {scenes.map((scene, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            inset: 0,
            overflow: "hidden",
            transform: `translateX(${scene.translate}%) scaleX(${stretchX})`,
            filter: blur > 0.1 ? `blur(${blur}px)` : undefined,
          }}
        >
          <Img
            src={pick(images, DEFAULT_IMAGES, i)}
            style={{
              position: "absolute",
              inset: 0,
              width: stage.width,
              height: stage.height,
              objectFit: "cover",
              transform: `scale(${scene.drift})`,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: dark
                ? `linear-gradient(135deg, ${alpha(p.ink, 0.35)}, ${alpha(p.ink, 0.75)})`
                : `linear-gradient(135deg, ${alpha(p.ink, 0.05)}, ${alpha(p.ink, 0.25)})`,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              padding: "0 40px",
              textAlign: "center",
              opacity: scene.textIn,
              transform: `translateY(${(1 - scene.textIn) * 24}px)`,
            }}
          >
            <div
              style={
                dark
                  ? { display: "contents" }
                  : {
                      maxWidth: stage.width - 80,
                      background: p.paper,
                      border: `1px solid ${alpha(p.primary, 0.18)}`,
                      borderRadius: 16,
                      boxShadow: "0 10px 30px rgba(15, 23, 42, 0.18)",
                      padding: stage.vertical ? "28px 28px" : "30px 44px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                    }
              }
            >
              <div
                style={{
                  width: 60,
                  height: 4,
                  borderRadius: 2,
                  background: `linear-gradient(90deg, ${i === 0 ? p.primary : p.light}, ${i === 0 ? p.light : p.primary})`,
                  marginBottom: 18,
                }}
              />
              <div
                style={{
                  color: dark ? p.onDark : p.text,
                  fontSize: stage.vertical ? 34 : 40,
                  fontWeight: 700,
                  lineHeight: 1.15,
                }}
              >
                {pick(headings, DEFAULT_HEADINGS, i)}
              </div>
              <div
                style={{
                  color: dark ? p.lighter : p.textMuted,
                  fontSize: 18,
                  marginTop: 8,
                  lineHeight: 1.4,
                }}
              >
                {pick(subheadings, DEFAULT_SUBHEADINGS, i)}
              </div>
            </div>
          </div>
        </div>
      ))}
    </Stage>
  );
}
