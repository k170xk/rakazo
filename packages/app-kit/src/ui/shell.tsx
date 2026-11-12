import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useId, useState } from "react";
import { cn, ease, stagger } from "./cn.js";

export type AppPage = {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Shown as a count beside the label. */
  count?: number;
  render: () => ReactNode;
};

type ShellProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  /** An icon for the app mark; a sparkle-style glyph by default. */
  icon?: ReactNode;
  actions?: ReactNode;
  /** Pages switch with animated tabs; the shell remembers the open one. */
  pages?: AppPage[];
  /** Or drive the navigation yourself. */
  nav?: Array<{ id: string; label: string; icon?: ReactNode; count?: number }>;
  active?: string;
  onNavigate?: (id: string) => void;
  /** Full-width content instead of the centred column. */
  wide?: boolean;
  children?: ReactNode;
};

function Mark({ icon }: { icon?: ReactNode }) {
  return (
    <div className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(110_45%_38%))] text-white shadow-glow [&_svg]:size-[18px]">
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,hsl(0_0%_100%/0.35),transparent_60%)]" />
      <span className="relative">
        {icon ?? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
          >
            <path d="M4 18V8l8-4 8 4v10" />
            <path d="M9 21v-6h6v6" />
          </svg>
        )}
      </span>
    </div>
  );
}

/**
 * The frame every app sits in: a frosted top bar with the app's name, tabs that slide, and the
 * page area, which fades between pages.
 */
export function AppShell({
  title,
  subtitle,
  icon,
  actions,
  pages,
  nav,
  active,
  onNavigate,
  wide,
  children,
}: ShellProps) {
  const [own, setOwn] = useState(pages?.[0]?.id ?? "");
  const items = pages ?? nav ?? [];
  const current = active ?? own;
  const navigate = (id: string) => {
    setOwn(id);
    onNavigate?.(id);
  };
  const id = useId();
  const page = pages?.find((item) => item.id === current) ?? pages?.[0];
  return (
    <div className="min-h-screen bg-surface">
      <header className="glass sticky top-0 z-30 border-b border-border/70">
        <div
          className={cn(
            "mx-auto flex h-16 items-center gap-4 px-5 sm:px-8",
            !wide && "max-w-[1320px]",
          )}
        >
          <Mark icon={icon} />
          <div className="min-w-0">
            <h1 className="truncate text-[15px] leading-tight font-bold tracking-tight">{title}</h1>
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {items.length > 1 && (
            <nav className="ml-4 hidden h-16 items-stretch gap-1 md:flex">
              {items.map((item) => {
                const selected = item.id === (page?.id ?? current);
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-app-page={item.id}
                    data-app-label={typeof item.label === "string" ? item.label : undefined}
                    onClick={() => navigate(item.id)}
                    className={cn(
                      "relative inline-flex items-center gap-2 px-3 text-[13px] font-semibold transition-colors [&_svg]:size-4",
                      selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {item.icon}
                    {item.label}
                    {item.count !== undefined && (
                      <span className="rounded-full bg-muted px-1.5 text-[11px] tabular text-muted-foreground">
                        {item.count}
                      </span>
                    )}
                    {selected && (
                      <motion.span
                        layoutId={`nav-${id}`}
                        className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-primary"
                        transition={{ type: "spring", stiffness: 500, damping: 40 }}
                      />
                    )}
                  </button>
                );
              })}
            </nav>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2 [&_a]:whitespace-nowrap [&_button]:whitespace-nowrap">
            {actions}
          </div>
        </div>
        {items.length > 1 && (
          <div className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                data-app-page={item.id}
                data-app-label={typeof item.label === "string" ? item.label : undefined}
                onClick={() => navigate(item.id)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold",
                  item.id === (page?.id ?? current)
                    ? "bg-foreground text-background"
                    : "text-muted-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </header>
      <main className={cn("mx-auto px-5 py-7 sm:px-8", !wide && "max-w-[1320px]")}>
        <AnimatePresence mode="wait">
          <motion.div
            key={page?.id ?? current ?? "page"}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.28, ease }}
          >
            {page ? page.render() : children}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1.5 text-xs font-bold tracking-[0.14em] text-primary uppercase">
            {eyebrow}
          </p>
        )}
        <h2 className="text-2xl font-bold tracking-tight sm:text-[28px]">{title}</h2>
        {description && (
          <p className="mt-1.5 max-w-2xl text-[15px] text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-8 first:mt-0", className)}>
      {(title || actions) && (
        <div className="mb-3.5 flex items-end justify-between gap-3">
          <div>
            {title && <h3 className="text-base font-bold tracking-tight">{title}</h3>}
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 md:grid-cols-3 lg:grid-cols-5",
  6: "grid-cols-2 md:grid-cols-3 lg:grid-cols-6",
};

/** A responsive grid whose children enter one after another. */
export function Grid({
  cols = 3,
  children,
  className,
}: {
  cols?: 1 | 2 | 3 | 4 | 5 | 6;
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div {...stagger.container} className={cn("grid gap-4", COLS[cols], className)}>
      {Array.isArray(children)
        ? children.flat().map((child, index) =>
            child === null || child === false || child === undefined ? null : (
              <motion.div
                key={index}
                variants={stagger.item.variants}
                className="min-w-0 [&>*]:h-full"
              >
                {child}
              </motion.div>
            ),
          )
        : children}
    </motion.div>
  );
}

/** Children enter one after another; wrap any list. */
export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div {...stagger.container} className={className}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={stagger.item.variants} className={className}>
      {children}
    </motion.div>
  );
}

/** Two areas side by side on wide screens: a main column and a narrower aside. */
export function Split({
  main,
  aside,
  className,
}: {
  main: ReactNode;
  aside: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]", className)}>
      <div className="min-w-0">{main}</div>
      <div className="min-w-0">{aside}</div>
    </div>
  );
}
