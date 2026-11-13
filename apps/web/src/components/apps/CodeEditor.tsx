import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import type { Diagnostic } from "@codemirror/lint";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { Compartment, EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { codeSyntaxColors } from "@rakazo/ui-tokens";
import { useEffect, useRef } from "react";

export type CodeProblem = { line?: number; column?: number; message: string };

function languageFor(file: string): Extension {
  if (file.endsWith(".css")) return css();
  if (file.endsWith(".json")) return json();
  return javascript({ jsx: true, typescript: true });
}

function colours(dark: boolean): Extension {
  const c = codeSyntaxColors[dark ? "dark" : "light"];
  return [
    syntaxHighlighting(
      HighlightStyle.define([
        { tag: [tags.keyword, tags.moduleKeyword, tags.controlKeyword], color: c.keyword },
        { tag: [tags.string, tags.special(tags.string), tags.regexp], color: c.string },
        { tag: [tags.number, tags.bool, tags.null, tags.atom], color: c.number },
        {
          tag: [tags.comment, tags.lineComment, tags.blockComment],
          color: c.comment,
          fontStyle: "italic",
        },
        {
          tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
          color: c.function,
        },
        { tag: [tags.typeName, tags.className, tags.namespace], color: c.type },
        { tag: [tags.tagName, tags.standard(tags.tagName)], color: c.tag },
        { tag: [tags.attributeName, tags.propertyName], color: c.attribute },
        { tag: [tags.operator, tags.punctuation, tags.angleBracket], color: c.punctuation },
        { tag: tags.definition(tags.variableName), color: c.definition },
        { tag: tags.invalid, color: c.invalid },
      ]),
    ),
    EditorView.theme({
      ".cm-searchMatch": {
        backgroundColor: `color-mix(in oklab, ${c.searchMatch} 30%, transparent)`,
      },
      ".cm-searchMatch-selected": {
        backgroundColor: `color-mix(in oklab, ${c.searchMatch} 55%, transparent)`,
      },
    }),
  ];
}

const chrome = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12.5px",
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    lineHeight: "1.55",
  },
  ".cm-content": { padding: "10px 0", caretColor: "var(--foreground)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  ".cm-gutters": {
    backgroundColor: "var(--background)",
    color: "color-mix(in oklab, var(--foreground) 35%, transparent)",
    border: "none",
    borderRight: "1px solid color-mix(in oklab, var(--foreground) 6%, transparent)",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--foreground) 4%, transparent)" },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--foreground)",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
    { backgroundColor: "color-mix(in oklab, var(--primary) 22%, transparent) !important" },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in oklab, var(--primary) 14%, transparent)" },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "color-mix(in oklab, var(--primary) 22%, transparent)",
    outline: "none",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "color-mix(in oklab, var(--foreground) 8%, transparent)",
    border: "none",
    color: "var(--muted-foreground)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "color-mix(in oklab, var(--primary) 18%, transparent)",
    color: "var(--foreground)",
  },
  ".cm-panels": { backgroundColor: "var(--card)", color: "var(--foreground)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-textfield, .cm-button": {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    backgroundImage: "none",
  },
});

const isDark = () => document.documentElement.dataset.theme === "dark";

function diagnosticsFor(state: EditorState, problems: CodeProblem[]): Diagnostic[] {
  const { doc } = state;
  return problems.map((problem) => {
    const lineNumber = Math.min(Math.max(problem.line ?? 1, 1), doc.lines);
    const line = doc.line(lineNumber);
    const from = Math.min(line.from + Math.max((problem.column ?? 1) - 1, 0), line.to);
    return {
      from,
      to: line.to > from ? line.to : from,
      severity: "error",
      message: problem.message,
    };
  });
}

/**
 * The App Studio's code editor: highlighting for TSX, CSS and JSON, line numbers, folding,
 * bracket matching, search (⌘F), multi-cursor and indenting with Tab, with build problems marked
 * on their lines. Follows Evolve's light and dark appearance.
 */
export default function CodeEditor({
  file,
  value,
  onChange,
  onSave,
  problems,
  label,
}: {
  file: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  problems: CodeProblem[];
  label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onSave });
  callbacks.current = { onChange, onSave };
  const palette = useRef(new Compartment());

  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          foldGutter(),
          lintGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          indentUnit.of("  "),
          EditorState.tabSize.of(2),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          rectangularSelection(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          languageFor(file),
          palette.current.of(colours(isDark())),
          chrome,
          EditorView.contentAttributes.of({ "aria-label": label }),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                callbacks.current.onSave();
                return true;
              },
            },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    const watcher = new MutationObserver(() =>
      editor.dispatch({
        effects: palette.current.reconfigure(colours(isDark())),
      }),
    );
    watcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      watcher.disconnect();
      editor.destroy();
      view.current = null;
    };
  }, [file]);

  // A discard, a reload or a newer version replaces the text; typing is already in the editor.
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current !== value)
      editor.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch(setDiagnostics(editor.state, diagnosticsFor(editor.state, problems)));
  }, [problems, file]);

  return <div ref={host} className="min-h-0 flex-1 overflow-hidden" />;
}
