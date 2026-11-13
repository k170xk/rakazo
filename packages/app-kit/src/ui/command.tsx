import { CornerDownLeft, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn.js";
import { matchesWords } from "./pickers.js";

export type Command = {
  id: string;
  label: string;
  /** Groups commands under a heading ("Pages", "Projects", "Actions"). */
  group?: string;
  hint?: string;
  icon?: ReactNode;
  /** Extra words people might type to find it. */
  keywords?: string;
  /** Shown on the right, e.g. "N" or "⌘S". */
  shortcut?: string;
  run: () => void;
};

/** Calls `handler` on ⌘/Ctrl + key anywhere in the app (key is a letter like "k"). */
export function useHotkey(key: string, handler: () => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === key.toLowerCase()) {
        event.preventDefault();
        latest.current();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [key]);
}

/**
 * The ⌘K launcher: type to jump to a page, a record or an action. Opens with ⌘K / Ctrl+K unless
 * `hotkey` is false; arrow keys move, Enter runs.
 */
export function CommandPalette({
  commands,
  open: controlled,
  onOpenChange,
  placeholder = "Search or jump to…",
  hotkey = true,
  empty = "Nothing matches",
}: {
  commands: Command[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  placeholder?: string;
  hotkey?: boolean;
  empty?: ReactNode;
}) {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const setOpen = (value: boolean) => {
    setOwn(value);
    onOpenChange?.(value);
  };
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useHotkey("k", () => {
    if (hotkey) setOpen(!open);
  });
  useEffect(() => {
    if (!open) {
      setQuery("");
      setCursor(0);
    }
  }, [open]);
  const found = useMemo(
    () =>
      commands
        .filter((command) =>
          matchesWords(
            `${command.label} ${command.group ?? ""} ${command.hint ?? ""} ${command.keywords ?? ""}`,
            query,
          ),
        )
        .slice(0, 60),
    [commands, query],
  );
  const groups = useMemo(() => {
    const out = new Map<string, Command[]>();
    for (const command of found)
      out.set(command.group ?? "", [...(out.get(command.group ?? "") ?? []), command]);
    return [...out];
  }, [found]);
  const ordered = groups.flatMap(([, items]) => items);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);
  const run = (command: Command | undefined) => {
    if (!command) return;
    setOpen(false);
    command.run();
  };
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 pt-[12vh]">
          <motion.div
            className="absolute inset-0 bg-[hsl(222_47%_6%/0.42)] backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setOpen(false)}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -4, transition: { duration: 0.12 } }}
            transition={{ type: "spring", stiffness: 520, damping: 38 }}
            className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-lift"
          >
            <div className="flex items-center gap-3 border-b border-border/70 px-4 [&_svg]:size-[18px]">
              <Search className="text-muted-foreground" />
              <input
                // biome-ignore lint/a11y/noAutofocus: typing is the only way to use the palette
                autoFocus
                value={query}
                placeholder={placeholder}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setCursor(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown")
                    setCursor((value) => Math.min(value + 1, ordered.length - 1));
                  else if (event.key === "ArrowUp") setCursor((value) => Math.max(value - 1, 0));
                  else if (event.key === "Enter") run(ordered[cursor]);
                  else if (event.key === "Escape") setOpen(false);
                  else return;
                  event.preventDefault();
                }}
                className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/70"
              />
              <kbd className="hidden rounded-md border border-border px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground sm:block">
                Esc
              </kbd>
            </div>
            <div ref={list} role="listbox" className="max-h-[min(420px,60vh)] overflow-y-auto p-2">
              {groups.map(([group, items]) => (
                <div key={group || "_"} className="mb-1 last:mb-0">
                  {group && (
                    <p className="px-2.5 pt-2 pb-1 text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
                      {group}
                    </p>
                  )}
                  {items.map((command) => {
                    const index = ordered.indexOf(command);
                    const active = index === cursor;
                    return (
                      <button
                        key={command.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        data-index={index}
                        onClick={() => run(command)}
                        onPointerMove={() => setCursor(index)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left text-sm [&_svg]:size-4",
                          active ? "bg-primary/10 text-foreground" : "text-foreground/90",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-lg",
                            active
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {command.icon ?? <CornerDownLeft />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{command.label}</span>
                          {command.hint && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {command.hint}
                            </span>
                          )}
                        </span>
                        {command.shortcut && (
                          <kbd className="rounded-md border border-border px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                            {command.shortcut}
                          </kbd>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
              {!ordered.length && (
                <p className="px-3 py-10 text-center text-sm text-muted-foreground">{empty}</p>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
