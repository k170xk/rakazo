import {
  BarChart3,
  BookOpen,
  Box,
  Building2,
  Calculator,
  Calendar,
  ChevronDown,
  ClipboardCheck,
  FileText,
  Folder,
  Home,
  Image,
  Layers,
  LayoutDashboard,
  List,
  Map as MapIcon,
  MoreHorizontal,
  Pencil,
  Search,
  Settings,
  Table2,
  Users,
  Wrench,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ErrorInfo, ReactNode, RefObject } from "react";
import { Component, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { describeCrash, reportCrash, useApp, useAsset } from "../sdk/index.js";
import { cn, ease, stagger } from "./cn.js";
import type { Command } from "./command.js";
import { CommandPalette } from "./command.js";
import type { NavEntry, NavMode } from "./nav-fit.js";
import { fitNav, navEntries, navModeFor } from "./nav-fit.js";

const NAMED_ICONS: Record<string, typeof Home> = {
  home: Home,
  overview: LayoutDashboard,
  dashboard: LayoutDashboard,
  layers: Layers,
  list: List,
  register: List,
  edit: Pencil,
  pencil: Pencil,
  settings: Settings,
  chart: BarChart3,
  charts: BarChart3,
  analytics: BarChart3,
  calendar: Calendar,
  file: FileText,
  files: FileText,
  document: FileText,
  users: Users,
  people: Users,
  team: Users,
  map: MapIcon,
  book: BookOpen,
  table: Table2,
  box: Box,
  model: Box,
  cube: Box,
  folder: Folder,
  checklist: ClipboardCheck,
  check: ClipboardCheck,
  calculator: Calculator,
  calc: Calculator,
  image: Image,
  photos: Image,
  tools: Wrench,
  building: Building2,
  search: Search,
};

/** An icon given by name ("home", "book-open") draws the matching glyph, never the word itself. */
function navIcon(icon: ReactNode): ReactNode {
  if (typeof icon !== "string") return icon;
  const name = icon.toLowerCase().split(/[-_\s]/)[0] ?? "";
  const Glyph = NAMED_ICONS[name];
  return Glyph ? <Glyph aria-hidden /> : null;
}

export type AppPage = {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Shown as a count beside the label. */
  count?: number;
  /** Pages with the same group open from one dropdown in the bar, labelled with the group. */
  group?: string;
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
  nav?: Array<{ id: string; label: string; icon?: ReactNode; count?: number; group?: string }>;
  active?: string;
  onNavigate?: (id: string) => void;
  /** Full-width content instead of the centred column. */
  wide?: boolean;
  /**
   * Adds ⌘K search: true lists the pages; pass commands to add records and actions too. A search
   * button appears in the bar.
   */
  commands?: boolean | Command[];
  children?: ReactNode;
};

type NavItem = { id: string; label: string; icon?: ReactNode; count?: number; group?: string };

function SearchButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Search (⌘K)"
      className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/80 bg-card/70 px-2.5 text-[13px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground [&_svg]:size-4"
    >
      <Search />
      <span className="hidden lg:inline">Search</span>
      <kbd className="hidden rounded border border-border px-1 text-[10px] font-semibold lg:inline">
        ⌘K
      </kbd>
    </button>
  );
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** The element's width, kept current as it resizes; `fallback` until it is measured. */
function useWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [width, setWidth] = useState(fallback);
  useIsomorphicLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(element.getBoundingClientRect().width);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** Space between tabs in the bar, matching gap-1. */
const NAV_GAP = 4;

type TabLook = {
  mode: NavMode;
  selected: boolean;
  icon?: ReactNode;
  label: string;
  count?: number;
  /** A dropdown: the group's pages or the More list. */
  menu?: boolean;
  /** The sliding underline; left out of the hidden copy used for measuring. */
  underline?: string;
  /** Stays an icon on phones even when selected (More). */
  compact?: boolean;
};

function TabFace({ mode, selected, icon, label, count, menu, underline, compact }: TabLook) {
  // On phones a tab is its icon alone, except the open one, which also shows its name.
  const iconOnly = isIconOnly({ mode, icon, selected, compact });
  return (
    <>
      {icon}
      {iconOnly ? <span className="sr-only">{label}</span> : label}
      {count !== undefined && !iconOnly && (
        <span
          className={cn(
            "rounded-full px-1.5 text-[11px] tabular",
            selected && mode !== "desktop"
              ? "bg-primary/20 text-current"
              : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
      {menu && !iconOnly && <ChevronDown className="!size-3.5 opacity-70" aria-hidden />}
      {underline && selected && mode === "desktop" && (
        <motion.span
          layoutId={underline}
          className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-primary"
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
        />
      )}
    </>
  );
}

function tabClass(mode: NavMode, selected: boolean, iconOnly: boolean) {
  if (mode === "desktop") {
    return cn(
      "relative inline-flex h-16 shrink-0 items-center gap-2 whitespace-nowrap px-3 text-[13px] font-semibold transition-colors [&_svg]:size-4",
      selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
    );
  }
  return cn(
    "inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full text-[13px] font-semibold transition-colors [&_svg]:size-4",
    iconOnly ? "w-10 justify-center" : "px-3.5",
    selected
      ? "bg-primary/14 text-[hsl(95_55%_28%)] ring-1 ring-inset ring-primary/30 dark:bg-primary/20 dark:text-primary"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );
}

function isIconOnly(look: Pick<TabLook, "mode" | "icon" | "selected" | "compact">) {
  return look.mode === "phone" && Boolean(look.icon) && (!look.selected || Boolean(look.compact));
}

function entryHas(entry: NavEntry<NavItem>, id: string | undefined) {
  return entry.kind === "page" ? entry.item.id === id : entry.items.some((item) => item.id === id);
}

function entryLook(entry: NavEntry<NavItem>, mode: NavMode, current: string | undefined): TabLook {
  const selected = entryHas(entry, current);
  if (entry.kind === "page") {
    const { icon, label, count } = entry.item;
    return { mode, selected, icon, label, count };
  }
  const open = entry.items.find((item) => item.id === current);
  // A group shows the open page's icon, or its first page's.
  return {
    mode,
    selected,
    icon: (open ?? entry.items[0])?.icon,
    label: entry.label,
    menu: true,
  };
}

type MenuSection = { label?: string; items: NavItem[] };

/** A dropdown under a tab in the bar: a group's pages, or the pages that did not fit. */
function NavMenu({
  look,
  sections,
  current,
  onNavigate,
  ariaLabel,
}: {
  look: TabLook;
  sections: MenuSection[];
  current?: string;
  onNavigate: (id: string) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [alignEnd, setAlignEnd] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);
  const iconOnly = isIconOnly(look);
  return (
    <div ref={ref} className="relative flex shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        onClick={() => {
          const box = ref.current?.getBoundingClientRect();
          setAlignEnd(Boolean(box && box.left + 256 > window.innerWidth));
          setOpen((value) => !value);
        }}
        className={tabClass(look.mode, look.selected, iconOnly)}
      >
        <TabFace {...look} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={menuId}
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.14 }}
            className={cn(
              "absolute top-full z-50 mt-1.5 max-h-[min(70vh,28rem)] w-max min-w-48 max-w-[min(18rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lift",
              alignEnd ? "right-0 origin-top-right" : "left-0 origin-top-left",
            )}
          >
            {sections.map((section, index) => (
              <div key={section.label ?? `section-${index}`}>
                {index > 0 && <div className="my-1 h-px bg-border" />}
                {section.label && (
                  <p className="px-2.5 pt-1.5 pb-1 text-xs font-bold tracking-wide text-muted-foreground uppercase">
                    {section.label}
                  </p>
                )}
                {section.items.map((item) => {
                  const selected = item.id === current;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      aria-current={selected ? "page" : undefined}
                      onClick={() => {
                        setOpen(false);
                        onNavigate(item.id);
                      }}
                      className={cn(
                        "flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-medium transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
                        selected
                          ? "bg-primary/12 text-foreground"
                          : "text-foreground hover:bg-muted",
                      )}
                    >
                      {item.icon}
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.count !== undefined && (
                        <span className="rounded-full bg-muted px-1.5 text-[11px] tabular text-muted-foreground">
                          {item.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PageTab({
  item,
  look,
  onNavigate,
}: {
  item: NavItem;
  look: TabLook;
  onNavigate: (id: string) => void;
}) {
  return (
    <button
      type="button"
      data-app-page={item.id}
      data-app-label={typeof item.label === "string" ? item.label : undefined}
      aria-current={look.selected ? "page" : undefined}
      title={isIconOnly(look) ? item.label : undefined}
      onClick={() => onNavigate(item.id)}
      className={tabClass(look.mode, look.selected, isIconOnly(look))}
    >
      <TabFace {...look} />
    </button>
  );
}

const MORE_LABEL = "More";

/**
 * The tabs along the top. Every tab is measured in a hidden copy; those that do not fit move under a
 * More dropdown, and the open page always stays in view. Pages sharing a group open from one dropdown.
 */
function TopNav({
  items,
  mode,
  current,
  onNavigate,
  className,
}: {
  items: NavItem[];
  mode: NavMode;
  current?: string;
  onNavigate: (id: string) => void;
  className?: string;
}) {
  const entries = navEntries(items);
  const underline = `nav-${useId()}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ shown: number[]; more: number[] } | null>(null);
  const selected = entries.findIndex((entry) => entryHas(entry, current));
  const signature = entries
    .map((entry) =>
      entry.kind === "page"
        ? `${entry.item.id}:${entry.item.label}:${entry.item.count ?? ""}`
        : `${entry.label}[${entry.items.map((item) => item.id).join(",")}]`,
    )
    .join("|");
  useIsomorphicLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;
    const compute = () => {
      const nodes = Array.from(measure.children) as HTMLElement[];
      const widths = nodes.slice(0, -1).map((node) => node.getBoundingClientRect().width);
      const moreWidth = nodes.at(-1)?.getBoundingClientRect().width ?? 44;
      const available = container.getBoundingClientRect().width;
      if (!available) return;
      const next = fitNav({ widths, moreWidth, available, gap: NAV_GAP, selected });
      setFit((previous) =>
        previous &&
        previous.shown.join() === next.shown.join() &&
        previous.more.join() === next.more.join()
          ? previous
          : next,
      );
    };
    compute();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(compute);
    observer.observe(container);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [signature, mode, selected, current]);

  const shown =
    fit && fit.shown.length + fit.more.length === entries.length
      ? fit.shown
      : entries.map((_, index) => index);
  const more = fit && fit.shown.length + fit.more.length === entries.length ? fit.more : [];
  const moreSections: MenuSection[] = more.map((index) => {
    const entry = entries[index]!;
    return entry.kind === "page"
      ? { items: [entry.item] }
      : { label: entry.label, items: entry.items };
  });
  // Loose pages run together in one section; each group keeps its own heading.
  const mergedSections = moreSections.reduce<MenuSection[]>((sections, section) => {
    const last = sections.at(-1);
    if (!section.label && last && !last.label) last.items.push(...section.items);
    else sections.push({ ...section, items: [...section.items] });
    return sections;
  }, []);
  const moreSelected = more.some((index) => entryHas(entries[index]!, current));

  const renderEntry = (entry: NavEntry<NavItem>, measuring: boolean) => {
    const look = entryLook(entry, mode, current);
    if (measuring) {
      return (
        <span className={tabClass(mode, look.selected, isIconOnly(look))}>
          <TabFace {...look} />
        </span>
      );
    }
    if (entry.kind === "page") {
      return <PageTab item={entry.item} look={{ ...look, underline }} onNavigate={onNavigate} />;
    }
    return (
      <NavMenu
        look={{ ...look, underline }}
        sections={[{ items: entry.items }]}
        current={current}
        onNavigate={onNavigate}
      />
    );
  };
  const moreLook: TabLook = {
    mode,
    selected: moreSelected,
    icon: <MoreHorizontal aria-hidden />,
    label: MORE_LABEL,
    menu: true,
    compact: true,
  };

  return (
    <nav
      ref={containerRef}
      aria-label="Pages"
      className={cn(
        "relative flex min-w-0 gap-1",
        mode === "desktop" ? "h-16 items-stretch" : "items-center",
        className,
      )}
    >
      {shown.map((index) => (
        <div key={index} className="flex shrink-0">
          {renderEntry(entries[index]!, false)}
        </div>
      ))}
      {more.length > 0 && (
        <NavMenu
          look={moreLook}
          sections={mergedSections}
          current={current}
          onNavigate={onNavigate}
          ariaLabel="More pages"
        />
      )}
      {/* Clipped to the bar so the hidden copy never widens the page. */}
      <div aria-hidden className="pointer-events-none invisible absolute inset-0 overflow-hidden">
        <div ref={measureRef} className="flex w-max gap-1">
          {entries.map((entry, index) => (
            <div key={index} className="flex shrink-0">
              {renderEntry(entry, true)}
            </div>
          ))}
          <div className="flex shrink-0">
            <span className={tabClass(mode, moreSelected, isIconOnly(moreLook))}>
              <TabFace {...moreLook} />
            </span>
          </div>
        </div>
      </div>
    </nav>
  );
}

/**
 * For the app check, which opens each page by clicking its [data-app-page] button: every page gets
 * a tiny, transparent one, so pages under a dropdown are still checked. Only under automation.
 */
function PageLinksForChecks({
  items,
  onNavigate,
}: {
  items: NavItem[];
  onNavigate: (id: string) => void;
}) {
  const [automated, setAutomated] = useState(false);
  useEffect(() => {
    setAutomated(typeof navigator !== "undefined" && navigator.webdriver === true);
  }, []);
  if (!automated || items.length < 2) return null;
  return (
    <div aria-hidden className="fixed top-0 left-0 z-[60] flex">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          tabIndex={-1}
          data-app-page={item.id}
          data-app-label={typeof item.label === "string" ? item.label : undefined}
          onClick={() => onNavigate(item.id)}
          className="size-0.5 opacity-0"
        />
      ))}
    </div>
  );
}

function Mark({ icon }: { icon?: ReactNode }) {
  const drawn = useAsset(useApp().app.icon);
  if (drawn) {
    return (
      <img
        src={drawn}
        alt=""
        aria-hidden="true"
        className="size-10 shrink-0 object-contain drop-shadow-sm"
      />
    );
  }
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

/** Apps often write commands as { label, action } or { label, onSelect }; the palette runs those too. */
function commandOf(given: Command, index: number): Command {
  const loose = given as Command & { action?: unknown; onSelect?: unknown; onClick?: unknown };
  const run = [loose.run, loose.action, loose.onSelect, loose.onClick].find(
    (item): item is () => void => typeof item === "function",
  );
  return {
    ...given,
    id: given.id ?? `command:${index}:${String(given.label ?? "")}`,
    label: String(given.label ?? ""),
    run: run ?? (() => undefined),
  };
}

function PageBody({ render }: { render: () => ReactNode }) {
  return <>{render()}</>;
}

/**
 * Keeps a crash inside the page it happened on, so the bar and the other pages still work, and
 * reports it the way the app check reads crashes.
 */
class PageBoundary extends Component<
  { label?: ReactNode; children: ReactNode },
  { error: Error | null; where: string }
> {
  override state = { error: null as Error | null, where: "" };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    const label = typeof this.props.label === "string" ? this.props.label : "this";
    const where = describeCrash(error, info.componentStack);
    this.setState({ where });
    reportCrash(`The ${label} page crashed: ${where}`);
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6" role="alert">
        <p className="text-base font-semibold">This page hit a problem</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {this.state.where || this.state.error.message}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">The other pages still work.</p>
      </div>
    );
  }
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
  pages: givenPages,
  nav: givenNav,
  active,
  onNavigate,
  wide,
  commands,
  children,
}: ShellProps) {
  const pages = Array.isArray(givenPages) ? givenPages.filter(Boolean) : undefined;
  const nav = Array.isArray(givenNav) ? givenNav : undefined;
  const [own, setOwn] = useState(pages?.[0]?.id ?? "");
  const [searching, setSearching] = useState(false);
  const items: NavItem[] = (pages ?? nav ?? []).map((item) => ({
    ...item,
    icon: navIcon(item.icon),
  }));
  const current = active ?? own;
  const navigate = (id: string) => {
    setOwn(id);
    onNavigate?.(id);
  };
  const headerRef = useRef<HTMLElement>(null);
  const mode = navModeFor(
    useWidth(headerRef, typeof window === "undefined" ? 1440 : window.innerWidth),
  );
  const page = pages?.find((item) => item.id === current) ?? pages?.[0];
  const selectedId = page?.id ?? current;
  const palette: Command[] | null = commands
    ? [
        ...items.map((item) => ({
          id: `page:${item.id}`,
          label: item.label,
          group: "Pages",
          icon: item.icon,
          run: () => navigate(item.id),
        })),
        ...(Array.isArray(commands) ? commands.filter(Boolean).map(commandOf) : []),
      ]
    : null;
  const content = (
    <main className={cn("mx-auto px-5 py-7 sm:px-8", !wide && "max-w-[1320px]")}>
      <AnimatePresence mode="wait">
        <motion.div
          key={page?.id ?? current ?? "page"}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.28, ease }}
        >
          <PageBoundary key={page?.id ?? "main"} label={page?.label}>
            {typeof page?.render === "function" ? <PageBody render={page.render} /> : children}
          </PageBoundary>
        </motion.div>
      </AnimatePresence>
    </main>
  );
  const paletteElement = palette && (
    <CommandPalette commands={palette} open={searching} onOpenChange={setSearching} />
  );

  const showNav = items.length > 1;
  const desktop = mode === "desktop";
  const tabs = showNav && (
    <TopNav
      items={items}
      mode={mode}
      current={selectedId}
      onNavigate={navigate}
      className={desktop ? "ml-2 flex-1" : "w-full"}
    />
  );

  return (
    <div className="min-h-screen bg-surface">
      {showNav && <PageLinksForChecks items={items} onNavigate={navigate} />}
      <header ref={headerRef} className="glass sticky top-0 z-30 border-b border-border/70">
        <div
          className={cn(
            "mx-auto flex items-center gap-3 px-4 sm:px-6 lg:gap-4 lg:px-8",
            desktop ? "h-16" : "h-14",
            !wide && "max-w-[1320px]",
          )}
        >
          <Mark icon={navIcon(icon) ?? undefined} />
          <div className={cn("min-w-0", desktop ? "max-w-[18rem] shrink" : "flex-1")}>
            <h1 className="truncate text-[15px] leading-tight font-bold tracking-tight">{title}</h1>
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {desktop && tabs}
          {/* On phones, kit buttons with an icon show just the icon here so the title keeps its room. */}
          <div className="ml-auto flex shrink-0 items-center gap-2 max-sm:gap-1.5 max-sm:[&_.kit-button-label]:sr-only [&_a]:whitespace-nowrap [&_button]:whitespace-nowrap">
            {palette && <SearchButton onOpen={() => setSearching(true)} />}
            {actions}
          </div>
        </div>
        {!desktop && tabs && (
          <div className={cn("mx-auto px-3 pb-2 sm:px-5", !wide && "max-w-[1320px]")}>{tabs}</div>
        )}
      </header>
      {content}
      {paletteElement}
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
