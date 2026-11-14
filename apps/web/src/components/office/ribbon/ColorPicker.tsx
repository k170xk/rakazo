import { Popover, PopoverTrigger } from "@rakazo/ui-web";
import type { LucideIcon } from "lucide-react";
import { Ban, ChevronDown } from "lucide-react";
import { useState } from "react";
import type { Quick } from "./layout";
import { quickControl } from "./layout";
import {
  ColorMark,
  keepSelection,
  RibbonButton,
  RibbonPopoverContent,
  RibbonTip,
  ribbonControl,
  useRibbonControl,
} from "./Ribbon";
import { normalizeHex, SWATCHES } from "./swatches";

/**
 * A colour tool: the button applies the last colour chosen, the chevron opens swatches, a custom
 * colour and, when `clearLabel` is given, a choice that removes the colour.
 */
export function ColorPicker({
  icon,
  label,
  menuLabel,
  initial,
  clearLabel,
  customLabel,
  disabled,
  testId,
  quick,
  onPick,
}: {
  icon: LucideIcon;
  label: string;
  menuLabel: string;
  /** The colour the button applies before anything is picked. */
  initial: string;
  /** Such as "Automatic" or "No fill"; picking it calls `onPick(null)`. */
  clearLabel?: string;
  customLabel: string;
  disabled?: boolean;
  testId?: string;
  quick?: Quick;
  onPick: (color: string | null) => void;
}) {
  const [last, setLast] = useState<string | null>(initial);
  const [open, setOpen] = useState(false);
  const control = useRibbonControl(quick);
  if (!control.visible) return null;
  const { layout } = control;
  const roomy = layout !== "bar";

  function pick(color: string | null) {
    setLast(color);
    setOpen(false);
    onPick(color);
  }

  return (
    <div className={layout === "sheet" ? "contents" : "flex shrink-0 items-center"}>
      <RibbonButton
        icon={icon}
        label={label}
        disabled={disabled}
        onClick={() => onPick(last)}
        testId={testId}
        className="rounded-e-none pe-1"
        quick={quick}
      >
        <ColorMark color={last} />
      </RibbonButton>
      <Popover open={open} onOpenChange={setOpen}>
        <RibbonTip label={menuLabel}>
          <PopoverTrigger
            disabled={disabled}
            aria-label={layout === "sheet" ? undefined : menuLabel}
            data-testid={testId ? `${testId}-menu` : undefined}
            onMouseDown={keepSelection}
            className={
              layout === "sheet"
                ? control.className
                : layout === "quick"
                  ? `${quickControl} -ms-1 min-w-7 rounded-s-none px-0.5`
                  : `${ribbonControl} min-w-5 rounded-s-none px-0.5`
            }
          >
            {layout === "sheet" ? (
              <>
                <ChevronDown className={control.icon} strokeWidth={1.8} aria-hidden="true" />
                <span className="line-clamp-2">{menuLabel}</span>
              </>
            ) : (
              <ChevronDown className="size-3 opacity-60" aria-hidden="true" />
            )}
          </PopoverTrigger>
        </RibbonTip>
        <RibbonPopoverContent
          align="start"
          className="w-auto gap-2 p-2"
          initialFocus={false}
          onClose={() => setOpen(false)}
        >
          {clearLabel ? (
            <button
              type="button"
              onMouseDown={keepSelection}
              onClick={() => pick(null)}
              className={`flex items-center gap-2 rounded-md px-2 hover:bg-foreground/[0.06] ${
                roomy ? "h-11 text-[15px]" : "h-8 text-[13px]"
              }`}
            >
              <Ban className="size-4 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
              {clearLabel}
            </button>
          ) : null}
          <div
            className={`grid grid-cols-10 ${roomy ? "gap-1.5 self-center" : "gap-1"}`}
            role="listbox"
            aria-label={menuLabel}
          >
            {SWATCHES.map((color) => (
              <button
                key={color}
                type="button"
                role="option"
                aria-selected={last === color}
                aria-label={color}
                title={color}
                onMouseDown={keepSelection}
                onClick={() => pick(color)}
                className={`rounded-[5px] ring-1 ring-foreground/15 outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring aria-selected:ring-2 aria-selected:ring-primary ${
                  roomy ? "size-7" : "size-5"
                }`}
                style={{ background: color }}
              />
            ))}
          </div>
          <label
            className={`flex cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-foreground/[0.06] ${
              roomy ? "h-11 text-[15px]" : "h-8 text-[13px]"
            }`}
          >
            <input
              type="color"
              value={(last ?? initial).toLowerCase()}
              onChange={(event) => {
                const color = normalizeHex(event.target.value);
                if (color) setLast(color);
              }}
              onBlur={(event) => {
                const color = normalizeHex(event.target.value);
                if (color) pick(color);
              }}
              className={`cursor-pointer rounded border-0 bg-transparent p-0 ${roomy ? "size-7" : "size-5"}`}
            />
            {customLabel}
          </label>
        </RibbonPopoverContent>
      </Popover>
    </div>
  );
}
