import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trans, useLingui } from "@lingui/react/macro";
import type { EvolvePersonOption } from "@rakazo/contracts";
import { Check, UserMinus, UserPlus } from "lucide-react";
import { PersonAvatar } from "../../GroupPeople";
import { ASSIGN_ATTR } from "./assignee-slots";
import { assigneeOptions, findEvolvePerson, type AssigneeOption } from "./evolve-people";

const WIDTH_PX = 300;
const GAP_PX = 6;
const EDGE_PX = 8;

type Props = {
  anchor: DOMRect;
  taskLabel: string;
  current: string;
  people: readonly EvolvePersonOption[];
  /** Owners already used on this programme, offered first. */
  planAssignees: readonly string[];
  /** The owner's name, or null to clear it. */
  onPick: (name: string | null) => void;
  onClose: () => void;
};

const optionName = (option: AssigneeOption) => (option.kind === "evolve" ? option.person.name : option.name);

/** A small owner picker opened from a task row's avatar or plus button, without the task drawer. */
export function QuickAssignPopover({ anchor, taskLabel, current, people, planAssignees, onPick, onClose }: Props) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [height, setHeight] = useState(0);
  const options = useMemo(
    () => assigneeOptions(people, planAssignees, query),
    [people, planAssignees, query],
  );
  const choices = current ? options.length + 1 : options.length;
  const active = Math.min(highlight, Math.max(choices - 1, 0));
  const currentKey = current.trim().toLowerCase();

  const choose = (index: number) => {
    if (index < options.length) onPick(optionName(options[index]!));
    else if (current) onPick(null);
  };

  useLayoutEffect(() => {
    input.current?.focus();
  }, []);
  useLayoutEffect(() => {
    setHeight(panel.current?.offsetHeight ?? 0);
  }, [options.length]);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element;
      // Another avatar or plus button switches tasks through its own click instead.
      if (panel.current?.contains(target) || target.closest?.(`[${ASSIGN_ATTR}]`)) return;
      closeRef.current();
    };
    const onScroll = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) closeRef.current();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", closeRef.current);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", closeRef.current);
    };
  }, []);

  const below = window.innerHeight - anchor.bottom;
  const flip = height > 0 && below < height + GAP_PX + EDGE_PX && anchor.top > below;
  const left = Math.min(
    Math.max(EDGE_PX, anchor.left + anchor.width / 2 - WIDTH_PX / 2),
    window.innerWidth - WIDTH_PX - EDGE_PX,
  );

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={t`Task owner`}
      className="fixed overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
      style={{
        zIndex: 1001,
        width: WIDTH_PX,
        left,
        ...(flip ? { bottom: window.innerHeight - anchor.top + GAP_PX } : { top: anchor.bottom + GAP_PX }),
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") setHighlight(Math.min(active + 1, choices - 1));
        else if (event.key === "ArrowUp") setHighlight(Math.max(active - 1, 0));
        else if (event.key === "Enter") choose(active);
        else if (event.key === "Escape") onClose();
        else return;
        event.preventDefault();
        // Escape would otherwise close the task drawer and Enter would reach the chart.
        event.stopPropagation();
        event.nativeEvent.stopImmediatePropagation();
      }}
    >
      <div className="border-b border-border px-3 pb-2 pt-2.5">
        <p className="truncate text-[11px] font-medium text-muted-foreground" title={taskLabel}>
          <Trans>Owner of {taskLabel}</Trans>
        </p>
        <input
          ref={input}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
          }}
          placeholder={people.length ? t`Search Evolve people or type a name` : t`Type a name`}
          aria-label={t`Owner name`}
          role="combobox"
          aria-expanded="true"
          autoComplete="off"
          className="mt-1.5 h-8 w-full rounded-md border border-input bg-background px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </div>
      <div role="listbox" aria-label={t`People`} className="max-h-72 overflow-y-auto p-1">
        {options.map((option, index) => {
          const name = optionName(option);
          const selected = name.trim().toLowerCase() === currentKey;
          const profile = option.kind === "evolve" ? option.person : findEvolvePerson(people, name);
          return (
            <div
              key={`${option.kind}:${name}`}
              role="option"
              aria-selected={index === active}
              className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 ${
                index === active ? "bg-accent" : ""
              }`}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => choose(index)}
            >
              {option.kind === "new" ? (
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
                  <UserPlus size={14} aria-hidden="true" />
                </span>
              ) : profile ? (
                <PersonAvatar name={profile.name} image={profile.photo} size={28} />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
                >
                  {initialsOf(name)}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-foreground" dir="auto">
                  {option.kind === "new" ? <Trans>Use “{name}”</Trans> : name}
                </span>
                <span className="block truncate text-[11.5px] text-muted-foreground">
                  {option.kind === "new" ? (
                    <Trans>Not in Evolve, e.g. a contractor or client</Trans>
                  ) : profile ? (
                    profile.jobTitle || <Trans>Evolve profile</Trans>
                  ) : (
                    <Trans>Not in Evolve</Trans>
                  )}
                </span>
              </span>
              {selected ? <Check size={15} className="shrink-0 text-success" aria-hidden="true" /> : null}
            </div>
          );
        })}
        {options.length === 0 ? (
          <p className="px-2.5 py-2 text-[12.5px] text-muted-foreground">
            <Trans>Type a name to add someone.</Trans>
          </p>
        ) : null}
        {current ? (
          <>
            <div className="my-1 border-t border-border" />
            <div
              role="option"
              aria-selected={active === options.length}
              className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-muted-foreground ${
                active === options.length ? "bg-accent text-foreground" : ""
              }`}
              onMouseEnter={() => setHighlight(options.length)}
              onClick={() => onPick(null)}
            >
              <span className="flex size-7 shrink-0 items-center justify-center">
                <UserMinus size={15} aria-hidden="true" />
              </span>
              <Trans>Remove owner</Trans>
            </div>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function initialsOf(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}
