import {
  Bold,
  Heading2,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Strikethrough,
  Table2,
} from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "./cn.js";
import { Markdown } from "./content.js";

type Edit = { text: string; start: number; end: number };

/** Wraps the selection (or the word placeholder) in marks, or takes them off when already there. */
export function wrapSelection(
  edit: Edit,
  before: string,
  after = before,
  placeholder = "text",
): Edit {
  const { text, start, end } = edit;
  const chosen = text.slice(start, end);
  if (
    text.slice(start - before.length, start) === before &&
    text.slice(end, end + after.length) === after
  ) {
    return {
      text: text.slice(0, start - before.length) + chosen + text.slice(end + after.length),
      start: start - before.length,
      end: end - before.length,
    };
  }
  const inner = chosen || placeholder;
  return {
    text: text.slice(0, start) + before + inner + after + text.slice(end),
    start: start + before.length,
    end: start + before.length + inner.length,
  };
}

/** Puts a prefix on each selected line ("- ", "1. ", "> ", "## "), or takes it off when all have it. */
export function prefixLines(edit: Edit, prefix: string | ((index: number) => string)): Edit {
  const { text, start, end } = edit;
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const toBreak = text.indexOf("\n", end);
  const to = toBreak === -1 ? text.length : toBreak;
  const lines = text.slice(from, to).split("\n");
  const mark = (index: number) => (typeof prefix === "string" ? prefix : prefix(index));
  const pattern = typeof prefix === "string" ? null : /^\d+\. /;
  const has = (line: string, index: number) =>
    pattern ? pattern.test(line) : line.startsWith(mark(index));
  const bare = (line: string, index: number) =>
    pattern ? line.replace(pattern, "") : has(line, index) ? line.slice(mark(index).length) : line;
  const all = lines.every(has);
  const next = lines
    .map((line, index) => (all ? bare(line, index) : mark(index) + bare(line, index)))
    .join("\n");
  const out = text.slice(0, from) + next + text.slice(to);
  // A plain cursor stays a cursor at the end of its line; a selection stays selected.
  if (start === end) return { text: out, start: from + next.length, end: from + next.length };
  return { text: out, start: from, end: from + next.length };
}

/**
 * A notes editor with formatting buttons (bold, headings, lists, checklists, links, quotes,
 * tables) and a preview. The value is Markdown text for a longtext column; show it elsewhere with
 * <Markdown>. With mentions, typing @ suggests names and onMention hears who was named.
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder = "Write here…",
  minRows = 8,
  mentions,
  onMention,
  id,
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  minRows?: number;
  mentions?: string[];
  onMention?: (name: string) => void;
  id?: string;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const [query, setQuery] = useState<{ at: number; text: string } | null>(null);
  const [pick, setPick] = useState(0);
  const text = value ?? "";

  // Where the cursor goes once the changed text is back, set in the same render so fast typing
  // never lands in the old place.
  const caret = useRef<{ start: number; end: number } | null>(null);
  useLayoutEffect(() => {
    const element = area.current;
    if (!caret.current || !element) return;
    element.focus();
    element.setSelectionRange(caret.current.start, caret.current.end);
    caret.current = null;
  });

  const apply = (change: (edit: Edit) => Edit) => {
    const element = area.current;
    if (!element) return;
    const next = change({ text, start: element.selectionStart, end: element.selectionEnd });
    caret.current = { start: next.start, end: next.end };
    onChange(next.text);
  };

  const matches =
    query && mentions
      ? mentions.filter((name) => name.toLowerCase().includes(query.text.toLowerCase())).slice(0, 6)
      : [];
  const mention = (name: string) => {
    if (!query) return;
    const end = area.current?.selectionStart ?? query.at + query.text.length + 1;
    const insert = `@${name} `;
    caret.current = { start: query.at + insert.length, end: query.at + insert.length };
    onChange(text.slice(0, query.at) + insert + text.slice(end));
    onMention?.(name);
    setQuery(null);
  };
  const watchMention = (next: string, caret: number) => {
    if (!mentions?.length) return;
    const before = next.slice(0, caret);
    const match = /(^|\s)@([\p{L}' .-]{0,30})$/u.exec(before);
    if (match && !match[2]?.includes("  ")) {
      setQuery({ at: caret - (match[2]?.length ?? 0) - 1, text: match[2] ?? "" });
      setPick(0);
    } else setQuery(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setPick((n) => (n + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        mention(matches[pick] ?? matches[0]!);
        return;
      }
      if (event.key === "Escape") return setQuery(null);
    }
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "b") {
      event.preventDefault();
      apply((edit) => wrapSelection(edit, "**"));
    } else if (mod && event.key.toLowerCase() === "i") {
      event.preventDefault();
      apply((edit) => wrapSelection(edit, "_"));
    } else if (mod && event.key.toLowerCase() === "k") {
      event.preventDefault();
      apply((edit) => wrapSelection(edit, "[", "](https://)", "link text"));
    } else if (event.key === "Enter" && !event.shiftKey) {
      // Carries a list on to the next line, or ends it on an empty item.
      const element = event.currentTarget;
      const caret = element.selectionStart;
      const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
      const line = text.slice(lineStart, caret);
      const list = /^(\s*)(- \[[ x]\] |[-*] |(\d+)\. )/.exec(line);
      if (!list || caret !== element.selectionEnd) return;
      event.preventDefault();
      if (line.trim() === list[2]?.trim()) {
        apply(() => ({
          text: text.slice(0, lineStart) + text.slice(caret),
          start: lineStart,
          end: lineStart,
        }));
        return;
      }
      const marker = list[3]
        ? `${Number(list[3]) + 1}. `
        : list[2]?.startsWith("- [")
          ? "- [ ] "
          : (list[2] ?? "- ");
      const insert = `\n${list[1]}${marker}`;
      apply(() => ({
        text: text.slice(0, caret) + insert + text.slice(caret),
        start: caret + insert.length,
        end: caret + insert.length,
      }));
    }
  };

  const tools: Array<{ label: string; icon: ReactNode; run: () => void }> = [
    {
      label: "Bold (Ctrl+B)",
      icon: <Bold />,
      run: () => apply((edit) => wrapSelection(edit, "**")),
    },
    {
      label: "Italic (Ctrl+I)",
      icon: <Italic />,
      run: () => apply((edit) => wrapSelection(edit, "_")),
    },
    {
      label: "Strikethrough",
      icon: <Strikethrough />,
      run: () => apply((edit) => wrapSelection(edit, "~~")),
    },
    { label: "Heading", icon: <Heading2 />, run: () => apply((edit) => prefixLines(edit, "## ")) },
    { label: "Bulleted list", icon: <List />, run: () => apply((edit) => prefixLines(edit, "- ")) },
    {
      label: "Numbered list",
      icon: <ListOrdered />,
      run: () => apply((edit) => prefixLines(edit, (index) => `${index + 1}. `)),
    },
    {
      label: "Checklist",
      icon: <ListChecks />,
      run: () => apply((edit) => prefixLines(edit, "- [ ] ")),
    },
    { label: "Quote", icon: <Quote />, run: () => apply((edit) => prefixLines(edit, "> ")) },
    {
      label: "Link (Ctrl+K)",
      icon: <Link2 />,
      run: () => apply((edit) => wrapSelection(edit, "[", "](https://)", "link text")),
    },
    {
      label: "Table",
      icon: <Table2 />,
      run: () =>
        apply(({ text: all, end }) => {
          const table = "\n| Item | Notes |\n| --- | --- |\n|  |  |\n";
          return {
            text: all.slice(0, end) + table + all.slice(end),
            start: end + table.length - 6,
            end: end + table.length - 6,
          };
        }),
    },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-input bg-card focus-within:ring-4 focus-within:ring-primary/15">
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border/70 px-1.5 py-1">
        {tools.map((tool) => (
          <button
            key={tool.label}
            type="button"
            aria-label={tool.label}
            title={tool.label}
            disabled={preview}
            onPointerDown={(event) => event.preventDefault()}
            onClick={tool.run}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 [&_svg]:size-4"
          >
            {tool.icon}
          </button>
        ))}
        <span className="ml-auto flex shrink-0 rounded-lg bg-muted p-0.5 text-xs font-semibold">
          {(["Write", "Preview"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={(mode === "Preview") === preview}
              onClick={() => setPreview(mode === "Preview")}
              className={cn(
                "rounded-md px-2.5 py-1",
                (mode === "Preview") === preview ? "bg-card shadow-sm" : "text-muted-foreground",
              )}
            >
              {mode}
            </button>
          ))}
        </span>
      </div>
      <div className="relative">
        {preview ? (
          <div className="min-h-40 p-3.5">
            {text.trim() ? (
              <Markdown>{text}</Markdown>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing written yet</p>
            )}
          </div>
        ) : (
          <textarea
            ref={area}
            id={id}
            value={text}
            rows={minRows}
            placeholder={placeholder}
            onChange={(event) => {
              onChange(event.target.value);
              watchMention(event.target.value, event.target.selectionStart);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => setTimeout(() => setQuery(null), 150)}
            className="block w-full resize-y bg-transparent p-3.5 text-sm leading-relaxed outline-none"
          />
        )}
        {matches.length > 0 && !preview && (
          <div className="absolute bottom-2 left-3 z-20 w-56 rounded-xl border border-border bg-popover p-1 shadow-lg">
            {matches.map((name, index) => (
              <button
                key={name}
                type="button"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => mention(name)}
                className={cn(
                  "block w-full rounded-lg px-2.5 py-1.5 text-left text-sm",
                  index === pick ? "bg-primary/12 text-primary" : "hover:bg-muted",
                )}
              >
                @{name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
