// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
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
  name: "credits-roll",
  category: "intro",
  description:
    "A titled list of roles and names that scrolls up across the whole scene. Use at the end of a project film to credit the project team, client and partners.",
  props: {
    title: 'string: heading at the top of the roll (default "Project Team")',
    credits:
      '{role: string, name: string}[] or string[] (default [{role: "Civil & Structural Engineering", name: "O\'Connor Sutton Cronin"}, {role: "MEP Engineering", name: "OCSC Building Services"}, {role: "Transport Planning", name: "OCSC Transport"}, {role: "Water & Drainage", name: "OCSC Water"}, {role: "Project Management", name: "OCSC Project Management"}])',
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 10,
  media: "none",
  fits: "A heading and 4-12 roles with names.",
  instead: "team_cards to introduce people with photos.",
};

type Credit = { role?: string; name?: string };

type Props = BrandProps & {
  title?: string;
  credits?: (Credit | string)[];
  dark?: boolean;
};

const DEFAULT_CREDITS: Credit[] = [
  { role: "Civil & Structural Engineering", name: "O'Connor Sutton Cronin" },
  { role: "MEP Engineering", name: "OCSC Building Services" },
  { role: "Transport Planning", name: "OCSC Transport" },
  { role: "Water & Drainage", name: "OCSC Water" },
  { role: "Project Management", name: "OCSC Project Management" },
];

const ROW_HEIGHT = 100;
const TITLE_HEIGHT = 120;

export default function CreditsRoll(props: Props) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;
  const fg = dark ? p.onDark : p.text;

  const credits = list<Credit | string>(props.credits, DEFAULT_CREDITS).map((c) =>
    typeof c === "string" ? { role: "", name: c } : c,
  );
  // The roll enters from the bottom on the first frame and leaves the top on the last.
  const contentHeight = TITLE_HEIGHT + credits.length * ROW_HEIGHT;
  const translateY = interpolate(
    frame,
    [0, durationInFrames - 1],
    [stage.height, -contentHeight],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <Stage background={dark ? p.darkGradient : p.lightGradient}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          transform: `translateY(${translateY}px)`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "0 32px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            height: TITLE_HEIGHT,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-start",
          }}
        >
          <h2
            style={{
              color: fg,
              fontSize: 32,
              fontWeight: 700,
              margin: 0,
              letterSpacing: "0.04em",
            }}
          >
            {str(props.title, "Project Team")}
          </h2>
          <div
            style={{
              width: 80,
              height: 3,
              background: p.primary,
              borderRadius: 2,
              marginTop: 14,
            }}
          />
        </div>
        {credits.map((credit, i) => (
          <div
            key={i}
            style={{
              height: ROW_HEIGHT,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-start",
            }}
          >
            {credit.role ? (
              <p
                style={{
                  color: dark ? p.primary : p.dark,
                  fontSize: 14,
                  fontWeight: 500,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  margin: 0,
                  marginBottom: 6,
                }}
              >
                {credit.role}
              </p>
            ) : null}
            <p
              style={{
                color: fg,
                fontSize: 24,
                fontWeight: 600,
                margin: 0,
              }}
            >
              {str(credit.name, "")}
            </p>
          </div>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 80,
          ...(dark
            ? { background: `linear-gradient(to bottom, ${p.ink}, transparent)` }
            : {
                background: p.lightGradient,
                backgroundSize: `${stage.width}px ${stage.height}px`,
                backgroundPosition: "top left",
                WebkitMaskImage: "linear-gradient(to bottom, black, transparent)",
              }),
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 80,
          ...(dark
            ? { background: `linear-gradient(to top, ${p.inkSoft}, transparent)` }
            : {
                background: p.lightGradient,
                backgroundSize: `${stage.width}px ${stage.height}px`,
                backgroundPosition: "bottom left",
                WebkitMaskImage: "linear-gradient(to top, black, transparent)",
              }),
        }}
      />
    </Stage>
  );
}
