// Adapted from Remotion Templates by RVE (https://www.reactvideoeditor.com/remotion-templates, MIT).
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  alpha,
  type BrandProps,
  list,
  num,
  palette,
  Stage,
  str,
  type TemplateMeta,
  useStage,
} from "./kit";

export const meta: TemplateMeta = {
  name: "notification-pop",
  category: "content",
  description:
    "Notification toasts slide in one after another at the right of the frame. Use it over a project scene for milestones, approvals or site updates.",
  props: {
    notifications:
      '{title: string, body: string}[] (default [{title: "Planning granted", body: "The scheme has received full planning permission."}, {title: "Design milestone", body: "Stage 3 structural drawings issued for review."}, {title: "Site update", body: "Foundations complete, ahead of programme."}])',
    title:
      'string: heading at the top left, only drawn when used as a scene (default "Project updates")',
    badge: "number: count on the first toast's badge, 0 hides it (default the number of toasts)",
    dark: "boolean: the dark OCSC version (default false: white)",
  },
  seconds: 5,
  media: "an overlay on a photo or scene",
  fits: "2-4 notifications with a title of up to 4 words and a one-line body.",
  instead: "timeline for a list of milestones on its own.",
  overlay: true,
};

type Notification = { title?: string; body?: string };

type Props = BrandProps & {
  notifications?: Notification[];
  title?: string;
  badge?: number;
  dark?: boolean;
  /** Set by the overlay layer, so the toasts draw over the scene underneath. */
  asOverlay?: boolean;
};

const DEFAULT_NOTIFICATIONS: Notification[] = [
  { title: "Planning granted", body: "The scheme has received full planning permission." },
  { title: "Design milestone", body: "Stage 3 structural drawings issued for review." },
  { title: "Site update", body: "Foundations complete, ahead of programme." },
];

export default function NotificationPop(props: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const stage = useStage();
  const p = palette(props.brandColor);
  const dark = props.dark === true;

  const notifications = list<Notification>(props.notifications, DEFAULT_NOTIFICATIONS)
    .slice(0, 5)
    .map((n) => ({
      title: str(n?.title, "Update"),
      body: str(n?.body, ""),
    }));
  const colors = [p.primary, p.light, p.dark];
  const badge = Math.round(num(props.badge, notifications.length));
  // 20 frames apart like the original, closer together when there are many toasts or little time.
  const gap = Math.min(20, Math.floor((durationInFrames * 0.5) / notifications.length));
  const out = interpolate(
    frame,
    [durationInFrames - 15, durationInFrames - 1],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <Stage
      background={
        props.asOverlay ? undefined : dark ? p.darkGradient : p.lightGradient
      }
    >
      {props.asOverlay ? null : (
        <h2
          style={{
            position: "absolute",
            top: 40,
            left: 40,
            color: dark ? p.onDark : p.text,
            fontSize: 29,
            fontWeight: 700,
            margin: 0,
          }}
        >
          {str(props.title, "Project updates")}
        </h2>
      )}

      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: 40,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-end",
          gap: 12,
          opacity: 1 - out,
          transform: `translateX(${out * 60}px)`,
        }}
      >
        {notifications.map((notif, i) => {
          const slideIn = spring({
            frame: Math.max(0, frame - i * gap),
            fps,
            config: { damping: 14, stiffness: 180, mass: 0.6 },
          });
          const translateX = interpolate(slideIn, [0, 1], [300, 0]);

          return (
            <div
              key={i}
              style={{
                transform: `translateX(${translateX}px)`,
                opacity: slideIn,
                width: Math.min(320, stage.width - 80),
                padding: 16,
                borderRadius: 12,
                background: dark ? alpha(p.ink, 0.9) : p.paper,
                border: dark
                  ? "1px solid rgba(255, 255, 255, 0.1)"
                  : `1px solid ${alpha(p.primary, 0.18)}`,
                boxShadow: dark
                  ? "0 10px 30px rgba(0, 0, 0, 0.3)"
                  : "0 10px 30px rgba(15, 23, 42,0.08)",
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                position: "relative",
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: colors[i % colors.length],
                  flexShrink: 0,
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  color: p.ink,
                  fontSize: 17,
                  fontWeight: 700,
                }}
              >
                {notif.title.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    color: dark ? p.onDark : p.text,
                    fontSize: 15,
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  {notif.title}
                </div>
                {notif.body ? (
                  <div
                    style={{
                      color: dark ? p.onDarkMuted : p.textMuted,
                      fontSize: 13,
                      lineHeight: 1.35,
                    }}
                  >
                    {notif.body}
                  </div>
                ) : null}
              </div>
              {i === 0 && badge > 0 ? (
                <div
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -6,
                    minWidth: 22,
                    height: 22,
                    padding: "0 6px",
                    boxSizing: "border-box",
                    borderRadius: 11,
                    background: dark ? p.onDark : p.dark,
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    color: dark ? p.ink : p.onDark,
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {badge}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Stage>
  );
}
