import { motion } from "motion/react";
import type { CSSProperties, ElementType, PointerEvent, ReactNode } from "react";
import { Children } from "react";
import { cn, ease } from "./cn.js";

/**
 * Finishing touches in the OCSC palette (greens and teal, never blue or purple). Gradients are
 * inline styles, so an effect adds almost nothing to an app's CSS and only when it is used.
 */

const GLOWS = [
  { color: "var(--primary)", style: { top: "-30%", left: "-20%", width: "70%", height: "75%" } },
  {
    color: "var(--chart-6)",
    style: { bottom: "-35%", right: "-20%", width: "70%", height: "75%" },
  },
  { color: "80 65% 55%", style: { top: "20%", left: "35%", width: "45%", height: "55%" } },
];

/** Slow-drifting soft light behind a hero, a header or an empty state. */
export function Aurora({
  children,
  className,
  strength = 0.32,
}: {
  children?: ReactNode;
  className?: string;
  /** 0–1; how strong the glow is. */
  strength?: number;
}) {
  return (
    <div className={cn("relative isolate overflow-hidden", className)}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        {GLOWS.map((glow, index) => (
          <motion.div
            key={glow.color}
            className="absolute rounded-full blur-3xl"
            style={{
              ...glow.style,
              background: `radial-gradient(closest-side, hsl(${glow.color} / ${strength}), transparent)`,
            }}
            animate={{
              x: ["0%", index % 2 ? "-8%" : "8%", "0%"],
              y: ["0%", index % 2 ? "6%" : "-6%", "0%"],
              scale: [1, 1.08, 1],
            }}
            transition={{
              duration: 16 + index * 4,
              repeat: Number.POSITIVE_INFINITY,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>
      {children}
    </div>
  );
}

const followPointer = (event: PointerEvent<HTMLElement>) => {
  const box = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--spot-x", `${event.clientX - box.left}px`);
  event.currentTarget.style.setProperty("--spot-y", `${event.clientY - box.top}px`);
};

/** A card with a soft light that follows the pointer. */
export function SpotlightCard({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const Tag: ElementType = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      onPointerMove={followPointer}
      className={cn(
        "group/spot relative block w-full overflow-hidden rounded-2xl border border-border/70 bg-card text-left text-card-foreground shadow-card transition-[box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-lift",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/spot:opacity-100"
        style={{
          background:
            "radial-gradient(420px circle at var(--spot-x, 50%) var(--spot-y, 50%), hsl(var(--primary) / 0.13), transparent 60%)",
        }}
      />
      <span className="relative block">{children}</span>
    </Tag>
  );
}

/** A card whose border carries a slowly turning green light; for the one thing to notice. */
export function GlowCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-2xl p-px shadow-glow", className)}>
      <div
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 aspect-square w-[200%] -translate-x-1/2 -translate-y-1/2 animate-spin [animation-duration:6s]"
        style={{
          background:
            "conic-gradient(from 0deg, transparent 0 55%, hsl(var(--primary)) 75%, hsl(var(--chart-6)) 85%, transparent 100%)",
        }}
      />
      <div className="relative h-full rounded-[calc(var(--radius)+7px)] bg-card text-card-foreground">
        {children}
      </div>
    </div>
  );
}

/** Content that scrolls past endlessly (client logos, highlights); pauses on hover. */
export function Marquee({
  children,
  speed = 30,
  reverse,
  className,
}: {
  children: ReactNode;
  /** Seconds for one full pass. */
  speed?: number;
  reverse?: boolean;
  className?: string;
}) {
  const items = Children.toArray(children);
  return (
    <div
      className={cn("group/marquee flex overflow-hidden", className)}
      style={{ maskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)" }}
    >
      {[0, 1].map((copy) => (
        <div
          key={copy}
          aria-hidden={copy === 1 || undefined}
          className="flex shrink-0 animate-marquee items-center gap-8 pr-8 group-hover/marquee:[animation-play-state:paused]"
          style={
            {
              animationDuration: `${speed}s`,
              animationDirection: reverse ? "reverse" : undefined,
            } as CSSProperties
          }
        >
          {items}
        </div>
      ))}
    </div>
  );
}

const BENTO_SIZES = {
  "1x1": "",
  "2x1": "md:col-span-2",
  "1x2": "md:row-span-2",
  "2x2": "md:col-span-2 md:row-span-2",
  "3x1": "md:col-span-3",
} as const;

/** A magazine-style grid of tiles in different sizes; fill it with BentoCard. */
export function BentoGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grid auto-rows-[minmax(11rem,auto)] grid-cols-1 gap-4 md:grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function BentoCard({
  size = "1x1",
  title,
  description,
  icon,
  background,
  children,
  onClick,
  className,
}: {
  size?: keyof typeof BENTO_SIZES;
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** Something visual behind the text: a chart, an image, a pattern. */
  background?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, ease }}
      className={cn("min-w-0", BENTO_SIZES[size])}
    >
      <SpotlightCard onClick={onClick} className={cn("flex h-full flex-col", className)}>
        {background && (
          <span className="pointer-events-none absolute inset-0 overflow-hidden">{background}</span>
        )}
        <span className="relative flex h-full flex-col gap-2 p-5">
          {icon && (
            <span className="mb-1 flex size-10 items-center justify-center rounded-xl bg-primary/12 text-primary [&_svg]:size-5">
              {icon}
            </span>
          )}
          {title && <span className="text-base font-bold tracking-tight">{title}</span>}
          {description && <span className="text-sm text-muted-foreground">{description}</span>}
          {children && <span className="mt-auto block pt-2">{children}</span>}
        </span>
      </SpotlightCard>
    </motion.div>
  );
}

/** Fades and lifts its content into place the first time it scrolls into view. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.6, ease, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** A headline whose words arrive one after another out of a soft blur. */
export function TextReveal({
  text,
  as: Tag = "h2",
  className,
  gradient,
}: {
  text: string;
  as?: "h1" | "h2" | "h3" | "p" | "span";
  className?: string;
  /** Fade the words from the text colour into OCSC green. */
  gradient?: boolean;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <Tag className={cn("font-bold tracking-tight", className)} aria-label={text}>
      {words.map((word, index) => (
        <motion.span
          key={index}
          aria-hidden="true"
          className={cn("inline-block", gradient && "text-gradient")}
          initial={{ opacity: 0, y: "0.35em", filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.5, ease, delay: index * 0.05 }}
        >
          {word}
          {index < words.length - 1 ? "\u00a0" : ""}
        </motion.span>
      ))}
    </Tag>
  );
}

const CONFETTI = [
  "95 49% 51%",
  "110 45% 38%",
  "80 65% 55%",
  "172 60% 42%",
  "38 92% 55%",
  "0 0% 100%",
];

/** A short burst of confetti, for a finished checklist or a won tender. Skipped for reduced motion. */
export function celebrate({
  count = 140,
  origin = { x: 0.5, y: 0.35 },
}: {
  count?: number;
  origin?: { x: number; y: number };
} = {}) {
  if (typeof document === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.createElement("canvas");
  const scale = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * scale;
  canvas.height = window.innerHeight * scale;
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: "90",
  });
  document.body.append(canvas);
  const context = canvas.getContext("2d");
  if (!context) {
    canvas.remove();
    return;
  }
  context.scale(scale, scale);
  const pieces = Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 8;
    return {
      x: origin.x * window.innerWidth,
      y: origin.y * window.innerHeight,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 6,
      size: 5 + Math.random() * 6,
      spin: Math.random() * Math.PI,
      turn: (Math.random() - 0.5) * 0.3,
      color: CONFETTI[Math.floor(Math.random() * CONFETTI.length)]!,
    };
  });
  const started = performance.now();
  const frame = (now: number) => {
    const age = now - started;
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const piece of pieces) {
      piece.vy += 0.28;
      piece.vx *= 0.985;
      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.spin += piece.turn;
      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.spin);
      context.globalAlpha = Math.max(0, 1 - age / 2200);
      context.fillStyle = `hsl(${piece.color})`;
      context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
      context.restore();
    }
    if (age < 2200) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
