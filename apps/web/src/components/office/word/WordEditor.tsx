import "@stll/folio-react/editor.css";
import {
  acceptAIEditRevision,
  rejectAIEditRevision,
} from "@stll/folio-core/prosemirror/commands/comments";
import { SUGGESTION_BYPASS_META } from "@stll/folio-core/prosemirror/plugins/suggestionMode";
import type { DocxEditorRef, ReviewDisplayMode } from "@stll/folio-react";
import { DocxEditor } from "@stll/folio-react";
import { getFolioMessages, isFolioLocale } from "@stll/folio-react/messages";
import { Loader2 } from "lucide-react";
import type { Node as PmNode, ResolvedPos } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { Ref } from "react";
import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { IntlProvider } from "use-intl";
import type { WordSelection, WordView } from "./context";
import { isEditingKey, isPersonEdit } from "./edit-intent";
import { createSelectionStore, WordRibbon } from "./WordRibbon";

/** One tracked insertion or deletion, as the review list shows it. */
export type ReviewChange = {
  id: number;
  type: string;
  author: string;
  date: string | null;
  text: string;
};

export type WordEditorHandle = {
  /** The document as a .docx, or null before it has loaded. */
  save: () => Promise<Uint8Array | null>;
  trackedChanges: () => ReviewChange[];
  /** Accepts or rejects the given revision ids; a replacement has one for each side. */
  resolve: (ids: readonly number[], accept: boolean) => boolean;
  show: (ids: readonly number[]) => void;
  selectionText: () => string;
  /** The page in view, its headings and text, and what is selected. */
  view: () => WordView;
  /** The selected picture as a file, or null when no picture is selected. */
  selectedImage: () => Promise<File | null>;
};

export type WordEditorProps = {
  bytes: ArrayBuffer;
  accessibleName: string;
  /** Shown on tracked changes and comments the person makes. */
  author: string;
  locale: string;
  readOnly: boolean;
  /** The person's edits are recorded as tracked changes under `author`. */
  trackChanges: boolean;
  fitWidth: boolean;
  handleRef: Ref<WordEditorHandle>;
  /** The person changed the document. Never called for loading. */
  onEdit: () => void;
  /** Tracked changes may have moved, or the document just opened; read them again. */
  onReviewChange: () => void;
  onSelection: (text: string) => void;
  /** The page in view may have changed; read `view()` again. */
  onScroll?: () => void;
  /** The editor could not open this file. */
  onFail: (error: Error) => void;
};

const HEADING_STYLE = /^(heading|title|subtitle)/i;
const HEADINGS_MAX = 8;

function nodeAt($pos: ResolvedPos, name: string): { node: PmNode; pos: number } | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === name) return { node, pos: $pos.before(depth) };
  }
  return null;
}

function tableRows(table: PmNode): string[][] {
  const rows: string[][] = [];
  table.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => {
      cells.push(cell.textContent);
    });
    rows.push(cells);
  });
  return rows;
}

/** The short paragraph just before a table, which usually names it. */
function tableCaption(doc: PmNode, tablePos: number): string | null {
  const before = doc.resolve(tablePos).nodeBefore;
  const text = before?.type.name === "paragraph" ? before.textContent.trim() : "";
  return text && text.length <= 120 ? text : null;
}

function readSelection(view: EditorView | null): WordSelection | null {
  if (!view) return null;
  const { selection, doc } = view.state;
  if (selection instanceof NodeSelection && selection.node.type.name === "image") {
    const attrs = selection.node.attrs as Record<string, unknown>;
    const text = (key: string) => (typeof attrs[key] === "string" ? (attrs[key] as string) : null);
    const number = (key: string) =>
      typeof attrs[key] === "number" ? (attrs[key] as number) : null;
    return {
      kind: "image",
      alt: text("alt") || text("title"),
      name: text("docPrName"),
      width: number("width"),
      height: number("height"),
    };
  }
  const from = nodeAt(selection.$from, "table");
  const to = nodeAt(selection.$to, "table");
  const crossesCells =
    "$anchorCell" in selection ||
    (!selection.empty &&
      nodeAt(selection.$from, "tableCell")?.pos !== nodeAt(selection.$to, "tableCell")?.pos);
  if (from && to && from.pos === to.pos && crossesCells) {
    return { kind: "table", caption: tableCaption(doc, from.pos), rows: tableRows(from.node) };
  }
  if (selection.empty) return null;
  return { kind: "text", text: doc.textBetween(selection.from, selection.to, "\n", " ") };
}

function selectedImageNode(view: EditorView | null): PmNode | null {
  const selection = view?.state.selection;
  return selection instanceof NodeSelection && selection.node.type.name === "image"
    ? selection.node
    : null;
}

const BUTTONISH = 'button, [role="menuitem"], [role="menuitemcheckbox"], [role="option"], select';

/** The paginated Word editor. Loaded on its own so the main bundle never carries it. */
export default function WordEditor({
  bytes,
  accessibleName,
  author,
  locale,
  readOnly,
  trackChanges,
  fitWidth,
  handleRef,
  onEdit,
  onReviewChange,
  onSelection,
  onScroll,
  onFail,
}: WordEditorProps) {
  const editor = useRef<DocxEditorRef>(null);
  const root = useRef<HTMLDivElement>(null);
  const ready = useRef(false);
  const lastIntent = useRef<number | null>(null);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const callbacks = useRef({ onEdit, onReviewChange, onSelection, onScroll, onFail });
  callbacks.current = { onEdit, onReviewChange, onSelection, onScroll, onFail };
  // The editor may keep the buffer it is given, so each load gets its own copy.
  const input = useMemo(() => bytes.slice(0), [bytes]);
  // New bytes reload in place behind the pages already shown. Changes that loading makes are
  // never the person's edit, and a file that fails to open falls back like a first load.
  // The editor scrolls to the top on every load and then to `initialScrollTop`, so the person's
  // place is kept by passing where they were when the bytes changed.
  const swapping = useRef(false);
  const shownInput = useRef(input);
  const scrollTop = useRef(0);
  const restoreTop = useRef<number | undefined>(undefined);
  if (shownInput.current !== input) {
    shownInput.current = input;
    swapping.current = true;
    lastIntent.current = null;
    restoreTop.current = scrollTop.current;
  }
  const folioLocale = isFolioLocale(locale) ? locale : "en";
  const messages = useMemo(() => getFolioMessages(folioLocale), [folioLocale]);
  const [selection] = useState(createSelectionStore);
  const [display, setDisplay] = useState<ReviewDisplayMode>("all-markup");

  // Typing, pasting or pressing a tool inside the editor, or in its menus and dialogs.
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const inEditor = (target: EventTarget | null) =>
      target instanceof Node &&
      (host.contains(target) ||
        (target instanceof Element &&
          Boolean(target.closest("[data-base-ui-portal], [role='dialog'], [role='menu']")) &&
          !target.closest("header")));
    const intend = (event: Event) => {
      if (inEditor(event.target)) lastIntent.current = performance.now();
    };
    const onKey = (event: KeyboardEvent) => {
      if (isEditingKey(event)) intend(event);
    };
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(BUTTONISH)) intend(event);
    };
    const kinds = ["beforeinput", "paste", "cut", "drop"] as const;
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    for (const kind of kinds) document.addEventListener(kind, intend, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
      for (const kind of kinds) document.removeEventListener(kind, intend, true);
    };
  }, []);

  useImperativeHandle(
    handleRef,
    () => ({
      async save() {
        const out = await editor.current?.save();
        return out ? new Uint8Array(out) : null;
      },
      trackedChanges() {
        return (editor.current?.getTrackedChanges() ?? []).map((change) => ({
          id: change.id,
          type: String(change.type),
          author: change.author,
          date: change.date,
          text: change.text,
        }));
      },
      resolve(ids, accept) {
        const current = editor.current;
        if (!current || ids.length === 0) return false;
        const view = current.getEditorRef()?.getView();
        if (!view)
          return accept ? current.acceptAIEditOperation(ids) : current.rejectAIEditOperation(ids);
        // With track changes on, resolving a change must not itself be recorded as a new one.
        return (accept ? acceptAIEditRevision : rejectAIEditRevision)(ids)(view.state, (tr) =>
          view.dispatch(tr.setMeta(SUGGESTION_BYPASS_META, true)),
        );
      },
      show(ids) {
        if (ids.length) editor.current?.scrollToAIEditOperation(ids);
      },
      selectionText() {
        return editor.current?.getSelectionText() ?? "";
      },
      view() {
        const current = editor.current;
        const pmView = current?.getEditorRef()?.getView() ?? null;
        const page = current?.getCurrentPage() ?? 1;
        const pageText = current?.getPageText(page) ?? null;
        const headings: string[] = [];
        if (pmView && pageText) {
          pmView.state.doc.descendants((node) => {
            if (headings.length >= HEADINGS_MAX) return false;
            if (node.type.name !== "paragraph") return node.type.name !== "image";
            const style = String(node.attrs["styleId"] ?? "");
            const text = node.textContent.trim();
            if (
              text &&
              (HEADING_STYLE.test(style) || node.attrs["outlineLevel"] != null) &&
              pageText.includes(text)
            )
              headings.push(text);
            return false;
          });
        }
        return {
          page,
          pages: current?.getTotalPages() ?? 0,
          pageText,
          headings,
          selection: readSelection(pmView),
        };
      },
      async selectedImage() {
        const node = selectedImageNode(editor.current?.getEditorRef()?.getView() ?? null);
        const src = typeof node?.attrs["src"] === "string" ? (node.attrs["src"] as string) : "";
        if (!node || !src) return null;
        const blob = await (await fetch(src)).blob();
        if (!blob.type.startsWith("image/")) return null;
        const ext = blob.type.split("/")[1]?.replace("jpeg", "jpg").replace(/\+.*/, "") || "png";
        const base = String(node.attrs["docPrName"] || "selected-image").replace(/[^\w.-]+/g, "-");
        return new File([blob], `${base.replace(/\.\w+$/, "")}.${ext}`, { type: blob.type });
      },
    }),
    [],
  );

  // Scrolling to another page changes what the person is looking at. While new bytes load, the
  // editor's jump to the top is undone before it paints, until the person scrolls themselves.
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const onScroll = (event: Event) => {
      const target = event.target;
      const top = restoreTop.current;
      if (
        swapping.current &&
        top &&
        target instanceof HTMLElement &&
        target.hasAttribute("data-folio-scroll") &&
        target.scrollTop === 0
      ) {
        target.scrollTop = top;
        return;
      }
      callbacks.current.onScroll?.();
    };
    const release = () => {
      swapping.current = false;
    };
    host.addEventListener("scroll", onScroll, { capture: true, passive: true });
    host.addEventListener("wheel", release, { passive: true });
    host.addEventListener("pointerdown", release);
    host.addEventListener("keydown", release);
    return () => {
      host.removeEventListener("scroll", onScroll, { capture: true });
      host.removeEventListener("wheel", release);
      host.removeEventListener("pointerdown", release);
      host.removeEventListener("keydown", release);
    };
  }, []);

  return (
    <div
      ref={root}
      className="flex size-full flex-col [&_[data-folio-scroll]]:pb-(--studio-dock-space) [&_[data-folio-toolbar]]:hidden"
    >
      <WordRibbon
        editor={editor}
        root={root}
        selection={selection}
        readOnly={readOnly}
        display={display}
        onDisplayChange={setDisplay}
      />
      <IntlProvider locale={folioLocale} messages={messages}>
        <DocxEditor
          ref={editor}
          accessibleName={accessibleName}
          documentBuffer={input}
          author={author}
          readOnly={readOnly}
          mode={trackChanges ? "suggesting" : "editing"}
          reviewDisplayMode={display}
          initialZoom={fitWidth ? "fit-width" : 1}
          showPrintButton={false}
          preserveDocumentWhileLoading
          initialScrollTop={restoreTop.current}
          onScrollTopChange={(top) => {
            scrollTop.current = top;
          }}
          className="min-h-0 flex-1"
          onSelectionChange={selection.set}
          loadingIndicator={
            <div className="grid size-full place-items-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
          }
          onChange={() => {
            if (!ready.current) {
              ready.current = true;
              callbacks.current.onReviewChange();
              return;
            }
            swapping.current = false;
            callbacks.current.onReviewChange();
            if (readOnlyRef.current) return;
            if (isPersonEdit(lastIntent.current, performance.now())) callbacks.current.onEdit();
          }}
          onSelectionTextChange={(selection) => callbacks.current.onSelection(selection.text)}
          onError={(error) => {
            if (!ready.current || swapping.current) callbacks.current.onFail(error);
          }}
        />
      </IntlProvider>
    </div>
  );
}
