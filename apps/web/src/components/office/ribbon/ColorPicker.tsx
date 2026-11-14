import { Popover, PopoverContent, PopoverTrigger } from "@rakazo/ui-web";
import type { LucideIcon } from "lucide-react";
import { Ban, ChevronDown } from "lucide-react";
import { useState } from "react";
import { ColorMark, keepSelection, RibbonButton, RibbonTip, ribbonControl } from "./Ribbon";
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
  onPick: (color: string | null) => void;
}) {
  const [last, setLast] = useState<string | null>(initial);
  const [open, setOpen] = useState(false);

  function pick(color: string | null) {
    setLast(color);
    setOpen(false);
    onPick(color);
  }

  return (
    <div className="flex shrink-0 items-center">
      <RibbonButton
        icon={icon}
        label={label}
        disabled={disabled}
        onClick={() => onPick(last)}
        testId={testId}
        className="rounded-e-none pe-1"
      >
        <ColorMark color={last} />
      </RibbonButton>
      <Popover open={open} onOpenChange={setOpen}>
        <RibbonTip label={menuLabel}>
          <PopoverTrigger
            disabled={disabled}
            aria-label={menuLabel}
            data-testid={testId ? `${testId}-menu` : undefined}
            onMouseDown={keepSelection}
            className={`${ribbonControl} min-w-5 rounded-s-none px-0.5`}
          >
            <ChevronDown className="size-3 opacity-60" aria-hidden="true" />
          </PopoverTrigger>
        </RibbonTip>
        <PopoverContent align="start" className="w-auto gap-2 p-2" initialFocus={false}>
          {clearLabel ? (
            <button
              type="button"
              onMouseDown={keepSelection}
              onClick={() => pick(null)}
              className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] hover:bg-foreground/[0.06]"
            >
              <Ban className="size-4 text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
              {clearLabel}
            </button>
          ) : null}
          <div className="grid grid-cols-10 gap-1" role="listbox" aria-label={menuLabel}>
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
                className="size-5 rounded-[5px] ring-1 ring-foreground/15 outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring aria-selected:ring-2 aria-selected:ring-primary"
                style={{ background: color }}
              />
            ))}
          </div>
          <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] hover:bg-foreground/[0.06]">
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
              className="size-5 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            {customLabel}
          </label>
        </PopoverContent>
      </Popover>
    </div>
  );
}
