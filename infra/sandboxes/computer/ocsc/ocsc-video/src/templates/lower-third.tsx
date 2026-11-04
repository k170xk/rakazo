// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  type BrandProps,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "lower-third",
  category: "intro",
  description:
    "A name and role card that slides in at the bottom left. Best as an overlay on a photo or video of the person or project; on its own it shows over a photo.",
  props: {
    name: 'string (default "Keith Knox")',
    role: 'string (default "Director, OCSC")',
    imageUrl: 'string: the photo behind it when used as a scene (default "https://images.pexels.com/photos/3862384/pexels-photo-3862384.jpeg?auto=compress&cs=tinysrgb&w=1920", engineers with drawings)',
    dark: "boolean: a dark card instead of the white one (default false: white)",
  },
  seconds: 5,
  media: "photo, or an overlay on footage of the person",
  fits: "A name and a role of up to 5 words.",
  instead: "pull_quote when the person is quoted; team_cards for several people.",
  fullBleed: true,
  overlay: true,
};

type Props = BrandProps & {
  name?: string;
  role?: string;
  imageUrl?: string;
  dark?: boolean;
  /** Set by the overlay layer, so the bar draws over the scene underneath. */
  asOverlay?: boolean;
};

export default function LowerThird(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);

  const accent = spring({ frame, fps, config: { damping: 15, mass: 0.6 } });
  const bar = spring({
    frame: frame - 5,
    fps,
    config: { damping: 14, mass: 0.7 },
  });
  const text = spring({ frame: frame - 15, fps, durationInFrames: 20 });
  // Leaves the way it came in over the last half second.
  const out = interpolate(
    frame,
    [durationInFrames - 15, durationInFrames - 1],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const dark = props.dark === true;
  const photo = props.asOverlay
    ? undefined
    : str(
        props.imageUrl,
        "https://images.pexels.com/photos/3862384/pexels-photo-3862384.jpeg?auto=compress&cs=tinysrgb&w=1920",
      );

  return (
    <Stage background={props.asOverlay ? undefined : p.paper}>
      {photo ? (
        <Img
          src={photo}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          bottom: stage.height * 0.16,
          left: 40,
          opacity: 1 - out,
          transform: `translateX(${-out * 60}px)`,
        }}
      >
        <div
          style={{
            width: 200,
            height: 3,
            background: `linear-gradient(90deg, ${p.primary}, ${p.light})`,
            transform: `translateX(${(1 - accent) * -300}px)`,
            borderRadius: 2,
            marginBottom: 4,
          }}
        />
        <div
          style={{
            display: "flex",
            transform: `translateX(${(1 - bar) * -400}px)`,
          }}
        >
          <div
            style={{
              width: 5,
              background: p.primary,
              borderRadius: "2px 0 0 2px",
            }}
          />
          <div
            style={{
              background: dark ? "rgba(16, 42, 10, 0.82)" : "rgba(255, 255, 255, 0.96)",
              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
              padding: "14px 30px",
              borderRadius: "0 4px 4px 0",
            }}
          >
            <div
              style={{
                color: dark ? p.onDark : p.text,
                fontSize: 26,
                fontWeight: 700,
                opacity: text,
                letterSpacing: "0.01em",
              }}
            >
              {str(props.name, "Keith Knox")}
            </div>
            <div
              style={{
                color: dark ? p.lighter : p.textMuted,
                fontSize: 15,
                fontWeight: 500,
                opacity: text,
                marginTop: 4,
                letterSpacing: "0.04em",
              }}
            >
              {str(props.role, "Director, OCSC")}
            </div>
          </div>
        </div>
      </div>
    </Stage>
  );
}
