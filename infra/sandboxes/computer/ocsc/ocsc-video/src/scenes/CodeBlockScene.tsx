import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  AnimationConfig,
  BackgroundConfig,
  TextStyleConfig,
} from "../types";
import { SceneBackground } from "./SceneBackground";
import { useSceneAnimation } from "./useSceneAnimation";

interface Props {
  heading?: string;
  code: string;
  language?: string;
  caption?: string;
  brandColor: string;
  background?: BackgroundConfig;
  headingStyle?: TextStyleConfig;
  animation?: AnimationConfig;
}

// Naive token highlighter — keywords, strings, comments, numbers
const KEYWORDS =
  /\b(const|let|var|function|return|if|else|for|while|class|new|import|export|from|async|await|true|false|null|undefined|interface|type|extends|implements|public|private|protected|static)\b/g;

function highlight(line: string, brandColor: string) {
  // Comment first
  const commentMatch = line.match(/^(\s*)(\/\/.*)$/);
  if (commentMatch) {
    return (
      <>
        <span>{commentMatch[1]}</span>
        <span style={{ color: "#64748b", fontStyle: "italic" }}>
          {commentMatch[2]}
        </span>
      </>
    );
  }
  // Strings → split, then keywords/numbers
  const parts: React.ReactNode[] = [];
  const rest = line;
  let key = 0;
  const stringRe = /(["'`])((?:\\.|(?!\1).)*)\1/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = stringRe.exec(rest)) !== null) {
    if (m.index > lastIdx) {
      parts.push(
        <span key={key++}>
          {processNonString(rest.slice(lastIdx, m.index), brandColor, key)}
        </span>,
      );
    }
    parts.push(
      <span key={key++} style={{ color: "#fbbf24" }}>
        {m[0]}
      </span>,
    );
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < rest.length) {
    parts.push(
      <span key={key++}>
        {processNonString(rest.slice(lastIdx), brandColor, key)}
      </span>,
    );
  }
  return <>{parts}</>;
}

function processNonString(
  text: string,
  brandColor: string,
  baseKey: number,
): React.ReactNode {
  const tokens = text.split(/(\s+|[(){}[\];,.])/);
  return tokens.map((tok, i) => {
    if (KEYWORDS.test(tok)) {
      KEYWORDS.lastIndex = 0;
      return (
        <span
          key={`${baseKey}-${i}`}
          style={{ color: brandColor, fontWeight: 600 }}
        >
          {tok}
        </span>
      );
    }
    KEYWORDS.lastIndex = 0;
    if (/^-?\d+(\.\d+)?$/.test(tok))
      return (
        <span key={`${baseKey}-${i}`} style={{ color: "#a78bfa" }}>
          {tok}
        </span>
      );
    return <span key={`${baseKey}-${i}`}>{tok}</span>;
  });
}

export const CodeBlockScene: React.FC<Props> = ({
  heading,
  code,
  language,
  caption,
  brandColor,
  background,
  headingStyle,
  animation,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const headAnim = useSceneAnimation(animation, 0);
  const hs = headingStyle || {};

  const lines = code.split("\n");
  const lineDelayPerChar = 1.5;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "80px 120px",
      }}
    >
      <SceneBackground config={background} brandColor={brandColor} />
      <div style={{ position: "relative", zIndex: 1 }}>
        {heading && (
          <h2
            style={{
              fontSize: hs.fontSize || 36,
              fontWeight: hs.fontWeight || 700,
              color: hs.color || "#0f172a",
              marginBottom: 24,
              opacity: headAnim.opacity,
              transform: headAnim.transform,
            }}
          >
            {heading}
          </h2>
        )}
        <div
          style={{
            borderRadius: 16,
            overflow: "hidden",
            border: `1px solid ${brandColor}40`,
            boxShadow: `0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px ${brandColor}20`,
          }}
        >
          {/* Window chrome */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "14px 20px",
              backgroundColor: "#0f172a",
              borderBottom: `1px solid ${brandColor}30`,
            }}
          >
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: "#ef4444",
              }}
            />
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: "#fbbf24",
              }}
            />
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: brandColor,
              }}
            />
            {language && (
              <div
                style={{
                  marginLeft: 16,
                  fontSize: 14,
                  color: "#64748b",
                  fontFamily: "'JetBrains Mono', monospace",
                  textTransform: "lowercase",
                }}
              >
                {language}
              </div>
            )}
          </div>
          <div
            style={{
              padding: "28px 32px",
              backgroundColor: "#020617",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 22,
              lineHeight: 1.55,
              color: "#334155",
            }}
          >
            {lines.map((ln, i) => {
              const startDelay = 8 + i * 6;
              const charsToShow = Math.max(
                0,
                Math.floor((frame - startDelay) / lineDelayPerChar),
              );
              const visible = ln.slice(0, Math.min(charsToShow, ln.length));
              const lineDone = charsToShow >= ln.length;
              const showCursor = !lineDone && charsToShow > 0;
              const op = interpolate(frame - startDelay, [0, 6], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              return (
                <div
                  key={i}
                  style={{ display: "flex", opacity: op, minHeight: "1.55em" }}
                >
                  <span
                    style={{
                      color: "#475569",
                      minWidth: 36,
                      userSelect: "none",
                    }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ flex: 1, whiteSpace: "pre" }}>
                    {highlight(visible, brandColor)}
                    {showCursor && (
                      <span
                        style={{
                          display: "inline-block",
                          width: 10,
                          height: "1em",
                          backgroundColor: brandColor,
                          marginLeft: 2,
                          opacity: Math.floor(frame / 12) % 2 === 0 ? 1 : 0,
                          verticalAlign: "text-bottom",
                        }}
                      />
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        {caption && (
          <div
            style={{
              marginTop: 20,
              textAlign: "center",
              fontSize: 18,
              color: "#64748b",
              fontStyle: "italic",
            }}
          >
            {caption}
          </div>
        )}
      </div>
    </div>
  );
};

// Avoid unused import warning when spring not used
void spring;
