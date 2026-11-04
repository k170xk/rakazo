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
  OCSC_SECTORS,
} from "./kit";

export const meta: TemplateMeta = {
  name: "end-card",
  category: "intro",
  description:
    "An OCSC closing card with the logo, a heading, a call to action and optional contact lines in a softly glowing panel. Use as the last scene of any OCSC video.",
  props: {
    heading: 'string (default "Thank you for watching")',
    cta: 'string: the call-to-action button (default "ocsc.ie")',
    contacts: 'string[]: optional contact lines under the button, e.g. an email or office list (default [])',
    tagline: 'string: small line at the bottom (default "Civil · Structural · Mechanical · Electrical · Environmental · Sustainability · BIM")',
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 6,
  media: "none",
  fits: "A heading, a call to action and up to 3 contact lines.",
  instead: "closing for the standard last scene.",
  ownLogo: true,
};

type Props = BrandProps & {
  heading?: string;
  cta?: string;
  contacts?: string[];
  tagline?: string;
  dark?: boolean;
};

export default function EndCard(props: Props) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;
  const logoUrl = dark ? props.logoOnDarkUrl : props.logoUrl;

  const scale = interpolate(
    spring({ frame, fps, durationInFrames: 35, config: { damping: 12, mass: 0.6 } }),
    [0, 1],
    [0.8, 1],
  );
  const contentOpacity = spring({ frame, fps, durationInFrames: 30 });
  const glowOpacity = interpolate(Math.sin(frame * 0.08), [-1, 1], [0.3, 0.7]);
  const logoOpacity = spring({ frame: frame - 10, fps, durationInFrames: 25 });
  const buttonOpacity = spring({ frame: frame - 20, fps, durationInFrames: 25 });
  const contactsOpacity = spring({ frame: frame - 30, fps, durationInFrames: 25 });

  const contacts = list<string>(props.contacts, []).filter(
    (c) => typeof c === "string" && c.trim(),
  );

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            transform: `scale(${scale})`,
            opacity: contentOpacity,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            maxWidth: stage.width - 48,
            padding: stage.vertical ? "40px 28px" : 48,
            borderRadius: 16,
            border: `2px solid ${alpha(p.primary, glowOpacity)}`,
            boxShadow: dark
              ? `0 0 40px ${alpha(p.primary, glowOpacity * 0.3)}`
              : `0 10px 30px rgba(15, 23, 42,0.08), 0 0 40px ${alpha(p.primary, glowOpacity * 0.2)}`,
            background: dark ? alpha(p.ink, 0.8) : p.paper,
          }}
        >
          {logoUrl ? (
            <Img
              src={logoUrl}
              style={{
                height: 64,
                maxWidth: 280,
                objectFit: "contain",
                marginBottom: 28,
                opacity: logoOpacity,
              }}
            />
          ) : (
            <div
              style={{
                color: p.primary,
                fontSize: 40,
                fontWeight: 800,
                letterSpacing: "0.08em",
                marginBottom: 24,
                opacity: logoOpacity,
              }}
            >
              OCSC
            </div>
          )}
          <h1
            style={{
              color: dark ? p.onDark : p.text,
              fontSize: stage.vertical ? 40 : 56,
              fontWeight: 700,
              lineHeight: 1.15,
              margin: 0,
              letterSpacing: "0.03em",
            }}
          >
            {str(props.heading, "Thank you for watching")}
          </h1>
          <div
            style={{
              opacity: buttonOpacity,
              transform: `translateY(${(1 - buttonOpacity) * 12}px)`,
              marginTop: 32,
              padding: "14px 40px",
              background: `linear-gradient(90deg, ${p.primary}, ${p.dark})`,
              borderRadius: 8,
            }}
          >
            <span
              style={{
                color: p.onDark,
                fontSize: 19,
                fontWeight: 600,
                letterSpacing: "0.05em",
              }}
            >
              {str(props.cta, "ocsc.ie")}
            </span>
          </div>
          {contacts.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                marginTop: 24,
                opacity: contactsOpacity,
              }}
            >
              {contacts.map((line, i) => (
                <span
                  key={i}
                  style={{ color: dark ? p.onDarkMuted : p.textMuted, fontSize: 16 }}
                >
                  {line}
                </span>
              ))}
            </div>
          )}
          <p
            style={{
              color: dark ? "rgba(255, 255, 255, 0.5)" : p.textMuted,
              fontSize: 14,
              marginTop: 28,
              marginBottom: 0,
              letterSpacing: "0.1em",
              fontWeight: 300,
              textTransform: "uppercase",
              opacity: contactsOpacity,
            }}
          >
            {str(props.tagline, OCSC_SECTORS)}
          </p>
        </div>
      </div>
    </Stage>
  );
}
