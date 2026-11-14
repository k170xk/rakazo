import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Kbd,
  KbdGroup,
  PopoverContent,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@rakazo/ui-web";
import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";
import type {
  ComponentProps,
  KeyboardEvent,
  MouseEvent,
  ReactElement,
  ReactNode,
  RefObject,
} from "react";
import { useEffect, useId, useRef, useState } from "react";
import { CompactRibbon } from "./CompactRibbon";
import type { Quick, RibbonLayout } from "./layout";
import {
  quickControl,
  SheetGrip,
  sheetPopup,
  sheetPositioner,
  sheetTile,
  showsIn,
  useCompactRibbon,
  useRibbonLayout,
} from "./layout";
import type { Shortcut } from "./shortcuts";
import { isTypingTarget, matchesShortcut, shortcutKeys } from "./shortcuts";

/** Shared look of every ribbon control: the studio header's round controls, a size smaller. */
export const ribbonControl =
  "flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-full px-1.5 text-[13px] leading-5 text-foreground outline-none transition-colors hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-primary/15 aria-pressed:text-primary data-popup-open:bg-foreground/[0.06] pointer-coarse:h-10 pointer-coarse:min-w-10";

/** The control look for where a tool is drawn. */
export function controlClass(layout: RibbonLayout): string {
  return layout === "sheet" ? sheetTile : layout === "quick" ? quickControl : ribbonControl;
}

const ICON = "size-[17px] shrink-0";
const STROKE = 1.8;

function iconClass(layout: RibbonLayout) {
  return layout === "bar" ? ICON : "size-5 shrink-0";
}

export type RibbonTabSpec = {
  id: string;
  label: string;
  content: ReactNode;
  /**
   * The tab answers the current selection, such as shape tools while a shape is selected. On
   * phones its toolbar tools come first whichever tab is open.
   */
  contextual?: boolean;
};

export type RibbonProps = {
  label: string;
  tabs: readonly RibbonTabSpec[];
  value: string;
  onValueChange: (id: string) => void;
  /** Shown at the end of the tab row, such as the save status. */
  end?: ReactNode;
  testId?: string;
  /** Drawn once whatever the layout, such as a hidden file input the tools open. */
  children?: ReactNode;
};

/**
 * Tabs of tools above a document: a row of tab names, then the open tab's tools in one row that
 * scrolls sideways. Phones get one row of the most used tools and a sheet with the rest.
 */
export function Ribbon(props: RibbonProps) {
  const compact = useCompactRibbon();
  return compact ? <CompactRibbon {...props} /> : <FullRibbon {...props} />;
}

function FullRibbon({ label, tabs, value, onValueChange, end, testId, children }: RibbonProps) {
  const base = useId();
  const open = tabs.find((tab) => tab.id === value) ?? tabs[0];

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const next = tabs[(index + (rtl ? -step : step) + tabs.length) % tabs.length];
    if (!next) return;
    onValueChange(next.id);
    document.getElementById(`${base}-tab-${next.id}`)?.focus();
  }

  return (
    <div
      className="shrink-0 border-b border-border bg-muted print:hidden"
      data-testid={testId}
      data-ribbon=""
    >
      <div className="flex h-8 items-center gap-1 px-2 pt-1 max-sm:px-1.5 pointer-coarse:h-10">
        <div
          role="tablist"
          aria-label={label}
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]"
        >
          {tabs.map((tab, index) => {
            const selected = tab.id === open?.id;
            return (
              <button
                key={tab.id}
                id={`${base}-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${base}-panel`}
                tabIndex={selected ? 0 : -1}
                data-testid={testId ? `${testId}-tab-${tab.id}` : undefined}
                onClick={() => onValueChange(tab.id)}
                onKeyDown={(event) => onTabKey(event, index)}
                className={`h-7 shrink-0 rounded-full px-3 text-[13px] leading-5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-9 ${
                  selected
                    ? "bg-background font-medium text-foreground shadow-xs ring-1 ring-foreground/[0.06]"
                    : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        {end ? <div className="flex shrink-0 items-center gap-1.5">{end}</div> : null}
      </div>
      <div
        id={`${base}-panel`}
        role="tabpanel"
        aria-labelledby={open ? `${base}-tab-${open.id}` : undefined}
        className="flex h-11 items-center overflow-x-auto overscroll-x-contain px-2 [scrollbar-width:none] max-sm:px-1.5 pointer-coarse:h-12"
      >
        {open?.content}
      </div>
      {children}
    </div>
  );
}

/** A labelled set of tools, set apart from the next by a thin rule. */
export function RibbonGroup({ label, children }: { label: string; children: ReactNode }) {
  const { layout } = useRibbonLayout();
  const id = useId();
  if (layout === "sheet") {
    return (
      <section aria-labelledby={id} className="flex flex-col gap-2 [&:not(:has(>[role=group]>*))]:hidden">
        <h3 id={id} className="px-1 text-[12px] font-medium text-muted-foreground">
          {label}
        </h3>
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would add a border and legend layout. */}
        <div
          role="group"
          aria-labelledby={id}
          className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2"
        >
          {children}
        </div>
      </section>
    );
  }
  if (layout === "quick") {
    return (
      // biome-ignore lint/a11y/useSemanticElements: a fieldset would add a border and legend layout.
      <div
        role="group"
        aria-label={label}
        className="flex shrink-0 items-center gap-0.5 empty:hidden"
      >
        {children}
      </div>
    );
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would add a border and legend layout.
    <div
      role="group"
      aria-label={label}
      className="flex shrink-0 items-center gap-0.5 border-e border-foreground/[0.08] pe-1.5 me-1.5 last:me-0 last:border-e-0 last:pe-0"
    >
      {children}
    </div>
  );
}

function ShortcutKeys({ shortcut }: { shortcut: Shortcut }) {
  return (
    <KbdGroup>
      {shortcutKeys(shortcut).map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}

/** Names a control on hover and focus, with its shortcut when it has one. Not drawn on phones. */
export function RibbonTip({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: Shortcut;
  children: ReactElement;
}) {
  const { layout } = useRibbonLayout();
  if (layout !== "bar") return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="bottom">
        {label}
        {shortcut ? <ShortcutKeys shortcut={shortcut} /> : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** Keeps the document's selection when a tool is pressed with the mouse. */
export const keepSelection = (event: MouseEvent) => event.preventDefault();

/**
 * The trigger class and label handling for a tool drawn by its own component, and whether the
 * current phone toolbar pass draws it at all.
 */
export function useRibbonControl(quick?: Quick) {
  const value = useRibbonLayout();
  return {
    layout: value.layout,
    visible: showsIn(value, quick),
    className: controlClass(value.layout),
    icon: iconClass(value.layout),
    /** Text beside an icon: hidden in the phone toolbar, where the icon carries the name. */
    labelClass: value.layout === "quick" ? "sr-only" : "whitespace-nowrap",
    close: value.close,
  };
}

export type RibbonButtonProps = {
  icon?: LucideIcon;
  label: string;
  shortcut?: Shortcut;
  /** Shows the label beside the icon, or alone when there is no icon. */
  showLabel?: boolean;
  /** A toggle's state; leave undefined for a plain button. */
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  testId?: string;
  /** Drawn under the icon, such as the current colour. */
  children?: ReactNode;
  className?: string;
  quick?: Quick;
};

export function RibbonButton({
  icon: Icon,
  label,
  shortcut,
  showLabel = false,
  pressed,
  disabled,
  onClick,
  testId,
  children,
  className,
  quick,
}: RibbonButtonProps) {
  const control = useRibbonControl(quick);
  if (!control.visible) return null;
  const { layout } = control;
  const labelled = layout === "bar" ? showLabel : layout === "sheet" || !Icon;
  return (
    <RibbonTip label={label} shortcut={shortcut}>
      <button
        type="button"
        aria-label={labelled ? undefined : label}
        aria-pressed={pressed}
        disabled={disabled}
        data-testid={testId}
        onMouseDown={keepSelection}
        onClick={() => {
          onClick();
          // A toggle stays in the open sheet so its state can be seen; an action closes it.
          if (layout === "sheet" && pressed === undefined) control.close();
        }}
        className={`${control.className} ${layout === "bar" && showLabel ? "px-2.5" : ""} ${
          layout === "sheet" ? "" : (className ?? "")
        }`}
      >
        {Icon ? (
          <span className="relative grid place-items-center">
            <Icon className={control.icon} strokeWidth={STROKE} aria-hidden="true" />
            {children}
          </span>
        ) : (
          children
        )}
        {labelled ? (
          <span className={layout === "sheet" ? "line-clamp-2" : "whitespace-nowrap"}>
            {label}
          </span>
        ) : null}
      </button>
    </RibbonTip>
  );
}

/**
 * The open part of a tool's menu: below the tool on desktop, a sheet along the bottom of the
 * screen on phones. `onClose` lets the sheet's grip close it.
 */
export function RibbonMenuContent({
  width = "w-56",
  align = "start",
  className,
  onClose,
  children,
}: {
  width?: string;
  align?: "start" | "center" | "end";
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { layout } = useRibbonLayout();
  const sheet = useRef<HTMLDivElement>(null);
  if (layout === "bar") {
    return (
      <DropdownMenuContent
        align={align}
        className={`${width} max-w-[calc(100vw-1rem)] ${className ?? ""}`}
      >
        {children}
      </DropdownMenuContent>
    );
  }
  return (
    <DropdownMenuContent
      ref={sheet}
      positionerClassName={sheetPositioner}
      className={`${sheetPopup} ${className ?? ""} !max-h-[min(70dvh,34rem)]`}
      data-ribbon-sheet=""
    >
      <SheetGrip sheet={sheet} onClose={onClose} />
      {children}
    </DropdownMenuContent>
  );
}

/** A popover's open part for a ribbon tool, as a bottom sheet on phones. */
export function RibbonPopoverContent({
  className,
  onClose,
  children,
  ...props
}: ComponentProps<typeof PopoverContent> & { onClose: () => void }) {
  const { layout } = useRibbonLayout();
  const sheet = useRef<HTMLDivElement>(null);
  if (layout === "bar") {
    return (
      <PopoverContent className={className} {...props}>
        {children}
      </PopoverContent>
    );
  }
  return (
    <PopoverContent
      {...props}
      ref={sheet}
      positionerClassName={sheetPositioner}
      className={`${className ?? ""} ${sheetPopup} gap-3 overflow-y-auto`}
      data-ribbon-sheet=""
    >
      <SheetGrip sheet={sheet} onClose={onClose} />
      {children}
    </PopoverContent>
  );
}

/** A tool that opens a menu; `children` are the menu's items. */
export function RibbonMenu({
  icon: Icon,
  label,
  text,
  showLabel = false,
  disabled,
  testId,
  width = "w-56",
  align = "start",
  triggerClassName,
  quick,
  children,
}: {
  icon?: LucideIcon;
  label: string;
  /** What the trigger shows instead of the label, such as the current font. */
  text?: string;
  showLabel?: boolean;
  disabled?: boolean;
  testId?: string;
  width?: string;
  align?: "start" | "center" | "end";
  triggerClassName?: string;
  quick?: Quick;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const control = useRibbonControl(quick);
  if (!control.visible) return null;
  const { layout } = control;
  const named = layout === "bar" ? showLabel : !Icon;
  const shown = text ?? (named ? label : undefined);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <RibbonTip label={label}>
        <DropdownMenuTrigger
          disabled={disabled}
          aria-label={label}
          data-testid={testId}
          onMouseDown={keepSelection}
          className={
            layout === "sheet"
              ? `${sheetTile} ${text ? "col-span-2 !items-stretch px-3 text-start" : ""}`
              : `${control.className} ${shown ? "px-2.5" : ""} ${
                  layout === "quick" && text ? "max-w-36" : (triggerClassName ?? "")
                }`
          }
        >
          {layout === "sheet" && text ? (
            <>
              <span className="text-[11px] text-muted-foreground">{label}</span>
              <span className="flex min-w-0 items-center gap-1.5 text-[14px]">
                {Icon ? <Icon className="size-4 shrink-0" strokeWidth={STROKE} aria-hidden="true" /> : null}
                <span className="min-w-0 flex-1 truncate">{text}</span>
                <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
              </span>
            </>
          ) : layout === "sheet" ? (
            <>
              {Icon ? <Icon className={control.icon} strokeWidth={STROKE} aria-hidden="true" /> : null}
              <span className="line-clamp-2">{label}</span>
            </>
          ) : (
            <>
              {Icon ? <Icon className={control.icon} strokeWidth={STROKE} aria-hidden="true" /> : null}
              {shown ? <span className="min-w-0 truncate whitespace-nowrap">{shown}</span> : null}
              <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden="true" />
            </>
          )}
        </DropdownMenuTrigger>
      </RibbonTip>
      <RibbonMenuContent width={width} align={align} onClose={() => setOpen(false)}>
        {children}
      </RibbonMenuContent>
    </DropdownMenu>
  );
}

/** A button that repeats its last choice, beside a chevron that opens the choices. */
export function RibbonSplit({
  icon,
  label,
  menuLabel,
  shortcut,
  disabled,
  onClick,
  testId,
  marker,
  width = "w-56",
  quick,
  children,
}: {
  icon: LucideIcon;
  label: string;
  /** Accessible name of the chevron, such as "More borders". */
  menuLabel: string;
  shortcut?: Shortcut;
  disabled?: boolean;
  onClick: () => void;
  testId?: string;
  marker?: ReactNode;
  width?: string;
  quick?: Quick;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const control = useRibbonControl(quick);
  if (!control.visible) return null;
  const { layout } = control;
  return (
    <div className={layout === "sheet" ? "contents" : "flex shrink-0 items-center rounded-full"}>
      <RibbonButton
        icon={icon}
        label={label}
        shortcut={shortcut}
        disabled={disabled}
        onClick={onClick}
        testId={testId}
        className="rounded-e-none pe-1"
        quick={quick}
      >
        {marker}
      </RibbonButton>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <RibbonTip label={menuLabel}>
          <DropdownMenuTrigger
            disabled={disabled}
            aria-label={layout === "sheet" ? undefined : menuLabel}
            data-testid={testId ? `${testId}-menu` : undefined}
            onMouseDown={keepSelection}
            className={
              layout === "sheet"
                ? sheetTile
                : layout === "quick"
                  ? `${quickControl} -ms-1 min-w-7 rounded-s-none px-0.5`
                  : `${ribbonControl} min-w-5 rounded-s-none px-0.5`
            }
          >
            {layout === "sheet" ? (
              <>
                <ChevronDown className={control.icon} strokeWidth={STROKE} aria-hidden="true" />
                <span className="line-clamp-2">{menuLabel}</span>
              </>
            ) : (
              <ChevronDown className="size-3 opacity-60" aria-hidden="true" />
            )}
          </DropdownMenuTrigger>
        </RibbonTip>
        <RibbonMenuContent width={width} onClose={() => setOpen(false)}>
          {children}
        </RibbonMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** A colour bar under a tool's icon. `null` draws an outlined empty bar. */
export function ColorMark({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden="true"
      className="absolute -bottom-[5px] left-1/2 h-[3px] w-[17px] -translate-x-1/2 rounded-full ring-1 ring-foreground/15"
      style={{ background: color ?? "transparent" }}
    />
  );
}

export type ShortcutBinding = {
  shortcut: Shortcut;
  run: () => void;
  /** Also answers inside text fields; off by default so typing keeps its own keys. */
  inFields?: boolean;
  disabled?: boolean;
};

/**
 * Binds shortcuts to presses inside `scope`. Presses in text fields are left alone unless a
 * binding asks for them, so a text box's own undo keeps working.
 */
export function useRibbonShortcuts(
  scope: RefObject<HTMLElement | null>,
  bindings: readonly ShortcutBinding[],
) {
  const latest = useRef(bindings);
  latest.current = bindings;
  useEffect(() => {
    const node = scope.current;
    if (!node) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const typing = isTypingTarget(event.target);
      for (const binding of latest.current) {
        if (binding.disabled || (typing && !binding.inFields)) continue;
        if (!matchesShortcut(event, binding.shortcut)) continue;
        event.preventDefault();
        event.stopPropagation();
        binding.run();
        return;
      }
    };
    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  }, [scope]);
}
