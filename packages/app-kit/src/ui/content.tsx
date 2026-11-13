import { ChevronDown, ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import { AnimatePresence, motion, Reorder, useDragControls, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { Children, Fragment, useEffect, useRef, useState } from "react";
import { cn, ease } from "./cn.js";

/** Questions, sections or details that open in place; `multiple` lets several stay open. */
export function Accordion({
  items,
  multiple,
  defaultOpen = [],
  className,
}: {
  items: Array<{
    id: string;
    title: ReactNode;
    content: ReactNode;
    icon?: ReactNode;
    hint?: ReactNode;
  }>;
  multiple?: boolean;
  defaultOpen?: string[];
  className?: string;
}) {
  const [open, setOpen] = useState<string[]>(defaultOpen);
  const toggle = (id: string) =>
    setOpen((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : multiple
          ? [...current, id]
          : [id],
    );
  return (
    <div
      className={cn(
        "divide-y divide-border/70 rounded-2xl border border-border/70 bg-card shadow-card",
        className,
      )}
    >
      {items.map((item) => {
        const expanded = open.includes(item.id);
        return (
          <div key={item.id}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => toggle(item.id)}
              className="flex w-full items-center gap-3 px-5 py-4 text-left [&_svg]:size-4"
            >
              {item.icon && <span className="text-primary">{item.icon}</span>}
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">{item.title}</span>
                {item.hint && (
                  <span className="block text-xs text-muted-foreground">{item.hint}</span>
                )}
              </span>
              <motion.span
                animate={{ rotate: expanded ? 180 : 0 }}
                transition={{ duration: 0.2 }}
                className="text-muted-foreground"
              >
                <ChevronDown />
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {expanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease }}
                  className="overflow-hidden"
                >
                  <div className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground">
                    {item.content}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

/** Slides that swipe and snap, with arrows and dots; `autoPlay` moves on every few seconds. */
export function Carousel({
  children,
  autoPlay,
  interval = 5000,
  className,
  slideClassName,
}: {
  children: ReactNode;
  autoPlay?: boolean;
  interval?: number;
  className?: string;
  /** Width of each slide; full width by default (e.g. "basis-full sm:basis-1/2 lg:basis-1/3"). */
  slideClassName?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const slides = Children.toArray(children);
  const go = (next: number) => {
    const element = track.current;
    if (!element) return;
    const target = (next + slides.length) % slides.length;
    const slide = element.children[target] as HTMLElement | undefined;
    element.scrollTo({ left: slide?.offsetLeft ?? 0, behavior: "smooth" });
  };
  useEffect(() => {
    if (!autoPlay || paused || slides.length < 2) return;
    const timer = setInterval(() => go(index + 1), interval);
    return () => clearInterval(timer);
  });
  return (
    <section
      aria-label="Carousel"
      className={cn("group/carousel relative", className)}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      <div
        ref={track}
        onScroll={(event) => {
          const element = event.currentTarget;
          const width =
            (element.children[0] as HTMLElement | undefined)?.offsetWidth || element.clientWidth;
          setIndex(Math.round(element.scrollLeft / Math.max(width, 1)));
        }}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide, slideIndex) => (
          <div
            key={slideIndex}
            className={cn("min-w-0 shrink-0 basis-full snap-start", slideClassName)}
          >
            {slide}
          </div>
        ))}
      </div>
      {slides.length > 1 && (
        <>
          {[
            { by: -1, label: "Previous", icon: <ChevronLeft />, side: "left-2" },
            { by: 1, label: "Next", icon: <ChevronRight />, side: "right-2" },
          ].map((arrow) => (
            <button
              key={arrow.label}
              type="button"
              aria-label={arrow.label}
              onClick={() => go(index + arrow.by)}
              className={cn(
                "glass absolute top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-border/70 shadow-card transition-opacity sm:opacity-0 sm:group-hover/carousel:opacity-100 [&_svg]:size-4",
                arrow.side,
              )}
            >
              {arrow.icon}
            </button>
          ))}
          <div className="mt-3 flex justify-center gap-1.5">
            {slides.map((_, dot) => (
              <button
                key={dot}
                type="button"
                aria-label={`Slide ${dot + 1}`}
                aria-current={dot === index || undefined}
                onClick={() => go(dot)}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  dot === index ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/30",
                )}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function SortableRow<T>({
  item,
  render,
  className,
}: {
  item: T;
  render: (item: T) => ReactNode;
  className?: string;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.02, boxShadow: "0 16px 40px -12px hsl(220 30% 10% / 0.25)", zIndex: 5 }}
      className={cn(
        "relative flex items-center gap-2 rounded-xl border border-border/70 bg-card px-2 py-2 shadow-card",
        className,
      )}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        onPointerDown={(event) => controls.start(event)}
        className="cursor-grab touch-none rounded-md p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing [&_svg]:size-4"
      >
        <GripVertical />
      </button>
      <div className="min-w-0 flex-1">{render(item)}</div>
    </Reorder.Item>
  );
}

/** A list people put in order by dragging the handle (priorities, running order, steps). */
export function SortableList<T>({
  items,
  onReorder,
  getKey,
  render,
  className,
  itemClassName,
}: {
  items: T[];
  onReorder: (items: T[]) => void;
  getKey: (item: T) => string;
  render: (item: T) => ReactNode;
  className?: string;
  itemClassName?: string;
}) {
  return (
    <Reorder.Group
      axis="y"
      values={items}
      onReorder={onReorder}
      className={cn("flex flex-col gap-2", className)}
    >
      {items.map((item) => (
        <SortableRow key={getKey(item)} item={item} render={render} className={itemClassName} />
      ))}
    </Reorder.Group>
  );
}

/* ----- Markdown ----- */

const SAFE_LINK = /^(?:https?:|mailto:)/i;

/** Bold, italics, `code` and [links](https://…) inside a line; anything else stays plain text. */
function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let count = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const token = match[0];
    const id = `${key}-${count++}`;
    if (match[1]) {
      out.push(
        <code key={id} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (match[2]) {
      out.push(<strong key={id}>{inline(token.slice(2, -2), id)}</strong>);
    } else if (match[3]) {
      out.push(<em key={id}>{inline(token.slice(1, -1), id)}</em>);
    } else {
      const [, label = "", href = ""] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token) ?? [];
      out.push(
        SAFE_LINK.test(href) ? (
          <a
            key={id}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-primary underline-offset-2 hover:underline"
          >
            {inline(label, id)}
          </a>
        ) : (
          label
        ),
      );
    }
    last = index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());

/**
 * Renders markdown (an ai.ask answer, notes, a brief) as styled text: headings, lists, tables,
 * quotes, code and links. It builds React elements, never HTML, so text can't inject markup.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  const lines = String(children ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const key = `b${i}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) body.push(lines[i++]!);
      i++;
      blocks.push(
        <pre
          key={key}
          className="overflow-x-auto rounded-xl bg-muted/70 p-3.5 font-mono text-[13px] leading-relaxed"
        >
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const size = ["text-xl", "text-lg", "text-base", "text-sm"][level - 1];
      const Tag = (["h3", "h4", "h5", "h6"] as const)[level - 1]!;
      blocks.push(
        <Tag key={key} className={cn("mt-2 font-bold tracking-tight", size)}>
          {inline(heading[2]!, key)}
        </Tag>,
      );
      i++;
      continue;
    }
    if (/^(?:-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push(<hr key={key} className="border-border" />);
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">"))
        quote.push(lines[i++]!.replace(/^>\s?/, ""));
      blocks.push(
        <blockquote
          key={key}
          className="border-l-4 border-primary/50 pl-4 text-muted-foreground italic"
        >
          {inline(quote.join(" "), key)}
        </blockquote>,
      );
      continue;
    }
    if (line.includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim())
        rows.push(cells(lines[i++]!));
      blocks.push(
        <div key={key} className="overflow-x-auto rounded-xl border border-border/70">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {head.map((cell, index) => (
                  <th key={index} className="px-3 py-2 text-left font-semibold">
                    {inline(cell, `${key}h${index}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-border/70">
                  {head.map((_, index) => (
                    <td key={index} className="px-3 py-2">
                      {inline(row[index] ?? "", `${key}r${rowIndex}c${index}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const bullet = /^\s*(?:[-*+]|\d+[.)])\s+/;
    if (bullet.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && bullet.test(lines[i]!))
        items.push(lines[i++]!.replace(bullet, ""));
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List
          key={key}
          className={cn(
            "flex flex-col gap-1 pl-5",
            ordered ? "list-decimal" : "list-disc",
            "marker:text-primary",
          )}
        >
          {items.map((item, index) => (
            <li key={index}>{inline(item, `${key}-${index}`)}</li>
          ))}
        </List>,
      );
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^(?:#{1,4}\s|```|>|\s*(?:[-*+]|\d+[.)])\s)/.test(lines[i]!)
    ) {
      paragraph.push(lines[i++]!);
    }
    if (!paragraph.length) paragraph.push(lines[i++]!);
    blocks.push(
      <p key={key}>
        {paragraph.map((text, index) => (
          <Fragment key={index}>
            {index > 0 && <br />}
            {inline(text, `${key}-${index}`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return (
    <div className={cn("flex flex-col gap-3 text-[15px] leading-relaxed", className)}>{blocks}</div>
  );
}

/** Text that types itself out (an AI answer arriving); shows at once for reduced motion. */
export function Typewriter({
  text,
  speed = 18,
  markdown,
  className,
}: {
  text: string;
  /** Characters per frame-ish tick (higher is faster). */
  speed?: number;
  markdown?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [count, setCount] = useState(reduce ? text.length : 0);
  useEffect(() => {
    if (reduce) {
      setCount(text.length);
      return;
    }
    setCount(0);
    const step = Math.max(1, Math.round(speed / 6));
    const timer = setInterval(() => {
      setCount((value) => {
        if (value >= text.length) {
          clearInterval(timer);
          return value;
        }
        return Math.min(text.length, value + step);
      });
    }, 16);
    return () => clearInterval(timer);
  }, [text, speed, reduce]);
  const visible = text.slice(0, count);
  const caret = count < text.length && (
    <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-primary" />
  );
  return markdown ? (
    <div className={className}>
      <Markdown>{visible}</Markdown>
      {caret}
    </div>
  ) : (
    <span className={className}>
      {visible}
      {caret}
    </span>
  );
}
