import { ChevronDown, ChevronRight, ChevronsLeftRight, ImageIcon } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import { imageIds } from "../schema.js";
import { useAsset } from "../sdk/index.js";
import { Avatar, Badge } from "./basic.js";
import { cn, toneFor } from "./cn.js";
import { AssetImage } from "./media.js";

type AnyRow = Record<string, unknown> & { _id?: string };

/**
 * Records as picture cards in a grid (projects, sites, products, people): the first picture of
 * imageKey on top, then the title, a line under it and a badge. Rows without a picture get a
 * plain cover so the grid stays even.
 */
export function GalleryView<T extends AnyRow>({
  rows,
  imageKey,
  titleKey,
  subtitleKey,
  badgeKey,
  footer,
  columns = 3,
  aspect = "landscape",
  onOpen,
  empty = "Nothing to show yet",
}: {
  rows: T[];
  imageKey: string;
  titleKey: string;
  subtitleKey?: string;
  /** A field shown as a coloured badge (a status). */
  badgeKey?: string;
  /** Anything extra under the title (figures, dates, avatars). */
  footer?: (row: T) => ReactNode;
  columns?: 2 | 3 | 4 | 5;
  aspect?: "square" | "landscape" | "portrait";
  onOpen?: (row: T) => void;
  empty?: ReactNode;
}) {
  const cols = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-3 lg:grid-cols-4",
    5: "sm:grid-cols-3 lg:grid-cols-5",
  }[columns];
  const ratio = { square: "aspect-square", landscape: "aspect-[4/3]", portrait: "aspect-[3/4]" }[
    aspect
  ];
  if (!rows.length)
    return <p className="py-10 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className={cn("grid grid-cols-1 gap-4", cols)}>
      {rows.map((row, index) => {
        const cover = imageIds(row[imageKey])[0];
        const badge = badgeKey ? String(row[badgeKey] ?? "") : "";
        const body = (
          <>
            <div className={cn("relative w-full overflow-hidden bg-muted", ratio)}>
              {cover ? (
                <AssetImage
                  asset={cover}
                  className="h-full w-full transition-transform duration-500 group-hover:scale-[1.04]"
                />
              ) : (
                <div className="grid h-full w-full place-items-center bg-gradient-to-br from-primary/15 to-muted text-primary/60">
                  <ImageIcon className="size-8" />
                </div>
              )}
              {badge && (
                <span className="absolute top-2.5 left-2.5">
                  <Badge tone={toneFor(badge)} dot>
                    {badge}
                  </Badge>
                </span>
              )}
            </div>
            <div className="space-y-1 p-3.5 text-left">
              <p className="truncate font-semibold">{String(row[titleKey] ?? "Untitled")}</p>
              {subtitleKey && row[subtitleKey] ? (
                <p className="truncate text-[13px] text-muted-foreground">
                  {String(row[subtitleKey])}
                </p>
              ) : null}
              {footer && <div className="pt-1.5">{footer(row)}</div>}
            </div>
          </>
        );
        const shell =
          "group block overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card transition-shadow hover:shadow-lift";
        return (
          <motion.div
            key={row._id ?? index}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(index, 12) * 0.03 }}
          >
            {onOpen ? (
              <button type="button" onClick={() => onOpen(row)} className={cn(shell, "w-full")}>
                {body}
              </button>
            ) : (
              <div className={shell}>{body}</div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

/** Two photos of the same view with a handle to slide between them (before and after works, defects fixed). */
export function CompareImages({
  before,
  after,
  beforeLabel = "Before",
  afterLabel = "After",
  height = 360,
  className,
}: {
  before: string | null | undefined;
  after: string | null | undefined;
  beforeLabel?: string;
  afterLabel?: string;
  height?: number;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(50);
  const first = useAsset(before);
  const second = useAsset(after);
  const move = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (rect) setSplit(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  };
  return (
    <div
      ref={box}
      role="slider"
      tabIndex={0}
      aria-label={`${beforeLabel} and ${afterLabel}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(split)}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event.clientX);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event.clientX);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") setSplit((n) => Math.max(0, n - 5));
        if (event.key === "ArrowRight") setSplit((n) => Math.min(100, n + 5));
      }}
      className={cn(
        "relative cursor-ew-resize touch-none overflow-hidden rounded-2xl bg-muted outline-none select-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      style={{ height }}
    >
      {second && (
        <img
          src={second}
          alt={afterLabel}
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {first && (
        <img
          src={first}
          alt={beforeLabel}
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
        />
      )}
      <span className="absolute top-3 left-3 rounded-md bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">
        {beforeLabel}
      </span>
      <span className="absolute top-3 right-3 rounded-md bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">
        {afterLabel}
      </span>
      <span
        className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow"
        style={{ left: `${split}%` }}
      />
      <span
        className="pointer-events-none absolute top-1/2 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-neutral-800 shadow-lg"
        style={{ left: `${split}%` }}
      >
        <ChevronsLeftRight className="size-5" />
      </span>
    </div>
  );
}

type Node<T> = { row: T; id: string; children: Node<T>[] };

/** Rows joined into a tree by a parent field; rows whose parent is missing become roots. */
export function buildTree<T extends AnyRow>(
  rows: T[],
  parentKey: string,
  idKey = "_id",
): Node<T>[] {
  const nodes = new Map<string, Node<T>>();
  rows.forEach((row, index) => {
    const id = String(row[idKey] ?? index);
    nodes.set(id, { row, id, children: [] });
  });
  const roots: Node<T>[] = [];
  for (const node of nodes.values()) {
    const parent = String(node.row[parentKey] ?? "");
    const holder = parent && parent !== node.id ? nodes.get(parent) : undefined;
    // A loop (a manager of their own manager) would never end, so its member becomes a root.
    let loop = false;
    const seen = new Set<string>();
    for (
      let step = holder;
      step && !seen.has(step.id);
      step = nodes.get(String(step.row[parentKey] ?? ""))
    ) {
      if (step.id === node.id) {
        loop = true;
        break;
      }
      seen.add(step.id);
    }
    if (holder && !loop) holder.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/**
 * An organisation chart from rows that name their manager (or any parent: teams, a work
 * breakdown): cards top-down with connecting lines; groups fold and unfold.
 */
export function OrgChart<T extends AnyRow>({
  rows,
  parentKey,
  titleKey,
  subtitleKey,
  photoKey,
  idKey = "_id",
  onOpen,
  className,
}: {
  rows: T[];
  /** The field holding the parent's id (the manager's _id). */
  parentKey: string;
  titleKey: string;
  subtitleKey?: string;
  /** A picture column; without it the card shows initials. */
  photoKey?: string;
  idKey?: string;
  onOpen?: (row: T) => void;
  className?: string;
}) {
  const roots = useMemo(() => buildTree(rows, parentKey, idKey), [rows, parentKey, idKey]);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setFolded((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const card = (node: Node<T>) => {
    const title = String(node.row[titleKey] ?? "");
    const photo = photoKey ? imageIds(node.row[photoKey])[0] : undefined;
    return (
      <div className="relative inline-flex flex-col items-center">
        <button
          type="button"
          onClick={() => onOpen?.(node.row)}
          className={cn(
            "flex w-48 items-center gap-2.5 rounded-xl border border-border/80 bg-card p-2.5 text-left shadow-card transition-shadow",
            onOpen && "hover:shadow-lift",
          )}
        >
          {photo ? (
            <AssetImage asset={photo} className="size-9 shrink-0 rounded-full" />
          ) : (
            <Avatar name={title} />
          )}
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold">{title}</span>
            {subtitleKey && (
              <span className="block truncate text-xs text-muted-foreground">
                {String(node.row[subtitleKey] ?? "")}
              </span>
            )}
          </span>
        </button>
        {node.children.length > 0 && (
          <button
            type="button"
            aria-label={folded.has(node.id) ? "Show team" : "Hide team"}
            onClick={() => toggle(node.id)}
            className="relative z-10 -mt-2 rounded-full border border-border bg-card px-1.5 text-[10.5px] font-bold text-muted-foreground shadow-sm hover:text-foreground"
          >
            {folded.has(node.id) ? `+${node.children.length}` : "−"}
          </button>
        )}
      </div>
    );
  };
  const branch = (node: Node<T>): ReactNode => (
    <li key={node.id} className="org-node relative flex flex-col items-center px-2 pt-5">
      {card(node)}
      {node.children.length > 0 && !folded.has(node.id) && (
        <ul className="org-level relative flex justify-center pt-5">{node.children.map(branch)}</ul>
      )}
    </li>
  );
  return (
    <div className={cn("overflow-x-auto pb-4", className)}>
      <style>{`
        .org-level::before{content:"";position:absolute;top:0;left:50%;height:1.25rem;border-left:2px solid hsl(var(--border))}
        .org-node::before,.org-node::after{content:"";position:absolute;top:0;height:1.25rem;width:50%;border-top:2px solid hsl(var(--border))}
        .org-node::before{right:50%}
        .org-node::after{left:50%;border-left:2px solid hsl(var(--border))}
        .org-node:only-child::before,.org-node:only-child::after{display:none}
        .org-node:only-child{padding-top:0}
        .org-node:first-child::before,.org-node:last-child::after{border-top:0}
        .org-node:last-child::before{border-right:2px solid hsl(var(--border));border-top-right-radius:8px}
        .org-node:first-child::after{border-top-left-radius:8px}
        .org-root>.org-node::before,.org-root>.org-node::after{display:none}
      `}</style>
      <ul className="org-root mx-auto flex w-max justify-center">{roots.map(branch)}</ul>
    </div>
  );
}

/**
 * Rows as an indented tree that folds (folders, a work breakdown, cost codes, locations within a
 * site). renderRow draws the line; it defaults to the title.
 */
export function TreeView<T extends AnyRow>({
  rows,
  parentKey,
  titleKey,
  idKey = "_id",
  renderRow,
  onOpen,
  defaultOpen = true,
}: {
  rows: T[];
  parentKey: string;
  titleKey: string;
  idKey?: string;
  renderRow?: (row: T, depth: number) => ReactNode;
  onOpen?: (row: T) => void;
  defaultOpen?: boolean;
}) {
  const roots = useMemo(() => buildTree(rows, parentKey, idKey), [rows, parentKey, idKey]);
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const isOpen = (id: string) => (toggled.has(id) ? !defaultOpen : defaultOpen);
  const flip = (id: string) =>
    setToggled((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const line = (node: Node<T>, depth: number): ReactNode => (
    <li key={node.id}>
      <div
        className="flex items-center gap-1 rounded-lg py-1 pr-2 hover:bg-muted/60"
        style={{ paddingLeft: depth * 18 + 4 }}
      >
        {node.children.length ? (
          <button
            type="button"
            aria-label={isOpen(node.id) ? "Fold" : "Unfold"}
            aria-expanded={isOpen(node.id)}
            onClick={() => flip(node.id)}
            className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted"
          >
            {isOpen(node.id) ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </button>
        ) : (
          <span className="size-6" />
        )}
        <button
          type="button"
          onClick={() => onOpen?.(node.row)}
          className={cn("min-w-0 flex-1 text-left text-sm", !onOpen && "cursor-default")}
        >
          {renderRow ? renderRow(node.row, depth) : String(node.row[titleKey] ?? "")}
        </button>
      </div>
      {node.children.length > 0 && isOpen(node.id) && (
        <ul>{node.children.map((child) => line(child, depth + 1))}</ul>
      )}
    </li>
  );
  return <ul>{roots.map((node) => line(node, 0))}</ul>;
}
