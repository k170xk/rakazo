import type React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  BackgroundConfig,
  InfographicPoint,
  InfographicSceneConfig,
  InfographicStat,
  InfographicStyle,
} from "../types";
import { Picture } from "./Picture";
import { SceneBackground } from "./SceneBackground";
import { useBrandedSvg } from "./useBrandedSvg";

const INK = "#0f172a";
const BODY = "#334155";
const TINT = "#f3f7f0";

interface InfographicSceneProps {
  imageUrl: string;
  brandColor: string;
  background?: BackgroundConfig;
  style?: InfographicStyle;
  heading?: string;
  subheading?: string;
  bullets?: string[];
  points?: InfographicPoint[];
  stats?: InfographicStat[];
  statement?: string;
}

/** The style a scene is drawn in: its own, or the one its content suggests, like the slides. */
export function infographicStyle(
  scene: Pick<
    InfographicSceneConfig,
    "style" | "points" | "stats" | "statement" | "bullets" | "heading"
  >,
): InfographicStyle {
  if (scene.style) return scene.style;
  if (scene.stats?.length) return "stats";
  if (scene.statement) return "statement";
  if (scene.points?.length) return scene.points.length >= 4 ? "steps" : "cards";
  if (scene.bullets?.length) return "side";
  if (scene.heading) return "side";
  return "full";
}

function useAppear(delay: number) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: Math.max(0, frame - delay), fps, config: { damping: 18 } });
  return {
    opacity: interpolate(frame - delay, [0, 10], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
    transform: `translateY(${interpolate(p, [0, 1], [28, 0])}px)`,
  };
}

const Appear: React.FC<{
  delay: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ delay, style, children }) => (
  <div style={{ ...style, ...useAppear(delay) }}>{children}</div>
);

/** The infographic, scaling up gently into its box and drifting slowly while it is on screen. */
const InfographicPicture: React.FC<{ src: string; box: React.CSSProperties; delay?: number }> = ({
  src,
  box,
  delay = 4,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const p = spring({ frame: Math.max(0, frame - delay), fps, config: { damping: 22 } });
  const drift = interpolate(frame, [0, durationInFrames], [1, 1.04], { extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        ...box,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: interpolate(frame - delay, [0, 12], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
        transform: `scale(${interpolate(p, [0, 1], [0.92, 1]) * drift})`,
      }}
    >
      <Picture
        src={src}
        alt=""
        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 16 }}
      />
    </div>
  );
};

const Header: React.FC<{
  heading?: string;
  subheading?: string;
  brandColor: string;
  box: React.CSSProperties;
  align?: "left" | "center";
}> = ({ heading, subheading, brandColor, box, align = "left" }) => {
  const frame = useCurrentFrame();
  if (!heading && !subheading) return null;
  const bar = interpolate(frame, [6, 22], [0, 120], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ position: "absolute", ...box, textAlign: align }}>
      {heading && (
        <Appear delay={0}>
          <div style={{ fontSize: 54, fontWeight: 800, color: INK, lineHeight: 1.1 }}>
            {heading}
          </div>
        </Appear>
      )}
      <div
        style={{
          width: bar,
          height: 5,
          borderRadius: 3,
          backgroundColor: brandColor,
          margin: align === "center" ? "16px auto" : "16px 0",
        }}
      />
      {subheading && (
        <Appear delay={6}>
          <div style={{ fontSize: 28, color: BODY, lineHeight: 1.3 }}>{subheading}</div>
        </Appear>
      )}
    </div>
  );
};

const NumberBadge: React.FC<{ n: number; brandColor: string; size?: number }> = ({
  n,
  brandColor,
  size = 52,
}) => (
  <div
    style={{
      width: size,
      height: size,
      flexShrink: 0,
      borderRadius: "50%",
      backgroundColor: brandColor,
      color: "#fff",
      fontSize: size * 0.45,
      fontWeight: 800,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    {n}
  </div>
);

const Tick: React.FC<{ brandColor: string }> = ({ brandColor }) => (
  <svg width={36} height={36} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
    <circle cx={12} cy={12} r={12} fill={brandColor} />
    <path
      d="M7 12.5l3.2 3.2L17 9"
      stroke="#fff"
      strokeWidth={2.6}
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);

/** The scene's words, in its style; `start` is the frame the first item appears on. */
const Items: React.FC<{
  style: InfographicStyle;
  bullets: string[];
  points: InfographicPoint[];
  stats: InfographicStat[];
  statement?: string;
  brandColor: string;
  row?: boolean;
  start?: number;
}> = ({ style, bullets, points, stats, statement, brandColor, row = false, start = 16 }) => {
  const step = 7;
  const lines = points.length ? points : bullets.map((text) => ({ title: "", text }));
  switch (style) {
    case "cards":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {lines.map((p, i) => (
            <Appear
              key={i}
              delay={start + i * step}
              style={{
                display: "flex",
                gap: 22,
                alignItems: "center",
                padding: "22px 26px",
                background: "#fff",
                borderRadius: 18,
                borderLeft: `8px solid ${brandColor}`,
                boxShadow: "0 10px 30px rgba(15,23,42,0.10)",
              }}
            >
              <NumberBadge n={i + 1} brandColor={brandColor} />
              <div>
                {p.title && (
                  <div style={{ fontSize: 30, fontWeight: 700, color: INK }}>{p.title}</div>
                )}
                {p.text && (
                  <div style={{ fontSize: 24, color: BODY, lineHeight: 1.3 }}>{p.text}</div>
                )}
              </div>
            </Appear>
          ))}
        </div>
      );
    case "steps":
      return (
        <div style={{ display: "flex", flexDirection: row ? "row" : "column", gap: row ? 28 : 22 }}>
          {lines.map((p, i) => (
            <Appear
              key={i}
              delay={start + i * step}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: row ? "column" : "row",
                alignItems: row ? "center" : "flex-start",
                textAlign: row ? "center" : "left",
                gap: 14,
              }}
            >
              <NumberBadge n={i + 1} brandColor={brandColor} size={row ? 60 : 52} />
              <div>
                {p.title && (
                  <div style={{ fontSize: 28, fontWeight: 700, color: INK }}>{p.title}</div>
                )}
                {p.text && (
                  <div style={{ fontSize: 22, color: BODY, lineHeight: 1.3 }}>{p.text}</div>
                )}
              </div>
            </Appear>
          ))}
        </div>
      );
    case "checklist":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {lines.map((p, i) => (
            <Appear
              key={i}
              delay={start + i * step}
              style={{
                display: "flex",
                gap: 18,
                alignItems: "center",
                padding: "18px 24px",
                background: TINT,
                borderRadius: 14,
              }}
            >
              <Tick brandColor={brandColor} />
              <div style={{ fontSize: 28, color: INK, lineHeight: 1.3 }}>
                {p.title && (
                  <b>
                    {p.title}
                    {p.text ? ": " : ""}
                  </b>
                )}
                {p.text}
              </div>
            </Appear>
          ))}
        </div>
      );
    case "stats":
      return (
        <div style={{ display: "flex", flexDirection: row ? "row" : "column", gap: 34 }}>
          {stats.map((s, i) => (
            <Appear key={i} delay={start + i * step} style={{ flex: 1 }}>
              <div style={{ fontSize: 96, fontWeight: 800, color: brandColor, lineHeight: 1 }}>
                {s.value}
              </div>
              <div style={{ fontSize: 28, color: BODY, marginTop: 8, lineHeight: 1.25 }}>
                {s.label}
              </div>
            </Appear>
          ))}
        </div>
      );
    case "statement":
      return (
        <div>
          <Appear delay={start}>
            <div style={{ fontSize: 52, fontWeight: 800, color: INK, lineHeight: 1.2 }}>
              <span
                style={{
                  backgroundImage: `linear-gradient(transparent 58%, ${brandColor}55 58%)`,
                }}
              >
                {statement}
              </span>
            </div>
          </Appear>
          {bullets.slice(0, 2).map((b, i) => (
            <Appear
              key={i}
              delay={start + (i + 1) * step}
              style={{ marginTop: 22, fontSize: 28, color: BODY }}
            >
              {b}
            </Appear>
          ))}
        </div>
      );
    default:
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {lines.map((p, i) => (
            <Appear
              key={i}
              delay={start + i * step}
              style={{ display: "flex", gap: 16, alignItems: "flex-start" }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  backgroundColor: brandColor,
                  marginTop: 14,
                  flexShrink: 0,
                }}
              />
              <div style={{ fontSize: 32, color: INK, lineHeight: 1.35 }}>
                {p.title && (
                  <b>
                    {p.title}
                    {p.text ? ": " : ""}
                  </b>
                )}
                {p.text}
              </div>
            </Appear>
          ))}
        </div>
      );
  }
};

/**
 * An OCSC Vision Intelligence infographic with the scene's words laid out around it in one of
 * the slide styles, so a video's infographics match its PowerPoint's. "full" shows the
 * picture alone, edge to edge.
 */
export const InfographicScene: React.FC<InfographicSceneProps> = (props) => {
  const { imageUrl, brandColor, background, heading, subheading, statement } = props;
  const bullets = props.bullets ?? [];
  const points = props.points ?? [];
  const stats = props.stats ?? [];
  const { width, height } = useVideoConfig();
  const brandedImageUrl = useBrandedSvg(imageUrl, brandColor) ?? imageUrl;
  const style = infographicStyle(props);
  const vertical = height > width;

  if (style === "full") {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
        <SceneBackground config={background} brandColor={brandColor} />
        <Picture
          src={brandedImageUrl}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            zIndex: 1,
          }}
        />
      </div>
    );
  }

  const items = (row?: boolean, start?: number) => (
    <Items
      style={style}
      bullets={bullets}
      points={points}
      stats={stats}
      statement={statement}
      brandColor={brandColor}
      row={row}
      start={start}
    />
  );
  const hasHeader = Boolean(heading || subheading);

  let layout: React.ReactNode;
  if (vertical) {
    // Portrait: heading, the picture, then the words underneath, clear of the footer.
    layout = (
      <>
        <Header
          heading={heading}
          subheading={subheading}
          brandColor={brandColor}
          box={{ left: 80, right: 80, top: 110 }}
        />
        <InfographicPicture
          src={brandedImageUrl}
          box={{ left: 60, right: 60, top: hasHeader ? 380 : 140, height: 620 }}
        />
        <div style={{ position: "absolute", left: 80, right: 80, top: hasHeader ? 1050 : 820 }}>
          {items(false)}
        </div>
      </>
    );
  } else if (style === "steps" || (style === "stats" && stats.length >= 4)) {
    // A wide picture with the sequence or figures in a row beneath it.
    layout = (
      <>
        <Header
          heading={heading}
          subheading={subheading}
          brandColor={brandColor}
          box={{ left: 100, right: 100, top: 56 }}
          align="center"
        />
        <InfographicPicture
          src={brandedImageUrl}
          box={{ left: 160, right: 160, top: hasHeader ? 230 : 80, height: hasHeader ? 420 : 560 }}
        />
        <div style={{ position: "absolute", left: 120, right: 120, top: hasHeader ? 680 : 680 }}>
          {items(true, 20)}
        </div>
      </>
    );
  } else {
    // Words on one side, the picture on the other; checklists and figures put the picture first.
    const pictureLeft = style === "checklist" || style === "stats";
    const textBox = pictureLeft ? { left: 1000, right: 100 } : { left: 100, right: 1000 };
    const pictureBox = pictureLeft ? { left: 60, width: 900 } : { right: 60, width: 900 };
    layout = (
      <>
        <InfographicPicture src={brandedImageUrl} box={{ ...pictureBox, top: 90, bottom: 180 }} />
        <div
          style={{
            position: "absolute",
            ...textBox,
            top: 70,
            bottom: 180,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div style={{ position: "relative", marginBottom: hasHeader ? 34 : 0 }}>
            <Header
              heading={heading}
              subheading={subheading}
              brandColor={brandColor}
              box={{ position: "relative" }}
            />
          </div>
          {items()}
        </div>
      </>
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <SceneBackground config={background} brandColor={brandColor} />
      <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>{layout}</div>
    </div>
  );
};
