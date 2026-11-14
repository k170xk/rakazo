import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Kbd,
  KbdGroup,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@rakazo/ui-web";
import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";
import type { KeyboardEvent, MouseEvent, ReactElement, ReactNode, RefObject } from "react";
import { useEffect, useId, useRef } from "react";
import type { Shortcut } from "./shortcuts";
import { isTypingTarget, matchesShortcut, shortcutKeys } from "./shortcuts";

/** Shared look of every ribbon control: the studio header's round controls, a size smaller. */
export const ribbonControl =
  "flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-full px-1.5 text-[13px] leading-5 text-foreground outline-none transition-colors hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-primary/15 aria-pressed:text-primary data-popup-open:bg-foreground/[0.06]";

const ICON = "size-[17px] shrink-0";
const STROKE = 1.8;

export type RibbonTabSpec = {
  id: string;
  label: string;
  content: ReactNode;
};

/**
 * Tabs of tools above a document: a row of tab names, then the open tab's tools in one row that
 * scrolls sideways on narrow screens.
 */
export function Ribbon({
  label,
  tabs,
  value,
  onValueChange,
  end,
  testId,
}: {
  label: string;
  tabs: readonly RibbonTabSpec[];
  value: string;
  onValueChange: (id: string) => void;
  /** Shown at the end of the tab row, such as the save status. */
  end?: ReactNode;
  testId?: string;
}) {
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
      <div className="flex h-8 items-center gap-1 px-2 pt-1 max-sm:px-1.5">
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
                className={`h-7 shrink-0 rounded-full px-3 text-[13px] leading-5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
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
        className="flex h-11 items-center overflow-x-auto overscroll-x-contain px-2 [scrollbar-width:none] max-sm:px-1.5"
      >
        {open?.content}
      </div>
    </div>
  );
}

/** A labelled set of tools, set apart from the next by a thin rule. */
export function RibbonGroup({ label, children }: { label: string; children: ReactNode }) {
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

/** Names a control on hover and focus, with its shortcut when it has one. */
export function RibbonTip({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: Shortcut;
  children: ReactElement;
}) {
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
}: RibbonButtonProps) {
  return (
    <RibbonTip label={label} shortcut={shortcut}>
      <button
        type="button"
        aria-label={showLabel ? undefined : label}
        aria-pressed={pressed}
        disabled={disabled}
        data-testid={testId}
        onMouseDown={keepSelection}
        onClick={onClick}
        className={`${ribbonControl} ${showLabel ? "px-2.5" : ""} ${className ?? ""}`}
      >
        {Icon ? (
          <span className="relative grid place-items-center">
            <Icon className={ICON} strokeWidth={STROKE} aria-hidden="true" />
            {children}
          </span>
        ) : (
          children
        )}
        {showLabel ? <span className="whitespace-nowrap">{label}</span> : null}
      </button>
    </RibbonTip>
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
  children: ReactNode;
}) {
  const shown = text ?? (showLabel ? label : undefined);
  return (
    <DropdownMenu>
      <RibbonTip label={label}>
        <DropdownMenuTrigger
          disabled={disabled}
          aria-label={label}
          data-testid={testId}
          onMouseDown={keepSelection}
          className={`${ribbonControl} ${shown ? "px-2.5" : ""} ${triggerClassName ?? ""}`}
        >
          {Icon ? <Icon className={ICON} strokeWidth={STROKE} aria-hidden="true" /> : null}
          {shown ? <span className="min-w-0 truncate whitespace-nowrap">{shown}</span> : null}
          <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden="true" />
        </DropdownMenuTrigger>
      </RibbonTip>
      <DropdownMenuContent align={align} className={`${width} max-w-[calc(100vw-1rem)]`}>
        {children}
      </DropdownMenuContent>
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
  children: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center rounded-full">
      <RibbonButton
        icon={icon}
        label={label}
        shortcut={shortcut}
        disabled={disabled}
        onClick={onClick}
        testId={testId}
        className="rounded-e-none pe-1"
      >
        {marker}
      </RibbonButton>
      <DropdownMenu>
        <RibbonTip label={menuLabel}>
          <DropdownMenuTrigger
            disabled={disabled}
            aria-label={menuLabel}
            data-testid={testId ? `${testId}-menu` : undefined}
            onMouseDown={keepSelection}
            className={`${ribbonControl} min-w-5 rounded-s-none px-0.5`}
          >
            <ChevronDown className="size-3 opacity-60" aria-hidden="true" />
          </DropdownMenuTrigger>
        </RibbonTip>
        <DropdownMenuContent align="start" className={`${width} max-w-[calc(100vw-1rem)]`}>
          {children}
        </DropdownMenuContent>
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
