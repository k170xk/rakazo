import { useLingui } from "@lingui/react/macro";
import {
  Button,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  toast,
} from "@rakazo/ui-web";
import type { SelectionState } from "@stll/folio-core/prosemirror";
import type { DocxEditorRef, ReviewDisplayMode } from "@stll/folio-react";
import { insertImageFromFile, insertPageBreakInView, insertTableInView } from "@stll/folio-react";
import {
  AArrowDown,
  AArrowUp,
  Baseline,
  Bold,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListOrdered,
  MessageSquarePlus,
  MessageSquareText,
  MoveHorizontal,
  Redo2,
  RemoveFormatting,
  Replace,
  Search,
  SeparatorHorizontal,
  Strikethrough,
  Table,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  Underline,
  Undo2,
  UnfoldVertical,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { RefObject } from "react";
import { useRef, useState, useSyncExternalStore } from "react";
import { ColorPicker } from "../ribbon/ColorPicker";
import { FontSizeInput, stepFontSize } from "../ribbon/FontSizeInput";
import {
  ColorMark,
  keepSelection,
  Ribbon,
  RibbonButton,
  RibbonGroup,
  RibbonMenu,
  RibbonSplit,
  RibbonTip,
  ribbonControl,
} from "../ribbon/Ribbon";
import { DEFAULT_TEXT_COLOR, normalizeHex } from "../ribbon/swatches";
import type { Alignment, WordAction } from "./commands";
import {
  applyParagraphStyle,
  FONT_FAMILIES,
  HIGHLIGHTS,
  insertLink,
  LINE_SPACINGS,
  nextChange,
  normalizeLink,
  PARAGRAPH_STYLES,
  previousChange,
  resolveAllChanges,
  resolveChangeAtCursor,
  runWordAction,
} from "./commands";

/** The selection's formatting, kept outside React so a moving cursor redraws only the ribbon. */
export type SelectionStore = {
  get: () => SelectionState | null;
  set: (next: SelectionState | null) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createSelectionStore(): SelectionStore {
  let current: SelectionState | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(next) {
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const TABLE_GRID = 8;

type WordRibbonProps = {
  editor: RefObject<DocxEditorRef | null>;
  root: RefObject<HTMLDivElement | null>;
  selection: SelectionStore;
  readOnly: boolean;
  display: ReviewDisplayMode;
  onDisplayChange: (mode: ReviewDisplayMode) => void;
};

/** Word-style tools above the page, driving the editor through its own commands. */
export function WordRibbon({
  editor,
  root,
  selection: store,
  readOnly,
  display,
  onDisplayChange,
}: WordRibbonProps) {
  const { t } = useLingui();
  const [tab, setTab] = useState("home");
  const [zoom, setZoomState] = useState<number | null>(null);
  const selection = useSyncExternalStore(store.subscribe, store.get, store.get);
  const imageInput = useRef<HTMLInputElement>(null);

  const text = selection?.textFormatting;
  const paragraph = selection?.paragraphFormatting;
  const fontSize = text?.fontSize ? text.fontSize / 2 : undefined;
  const font = text?.fontFamily?.ascii;
  const styleId = selection?.styleId ?? "Normal";
  const listType = selection?.listState.type ?? "none";
  const alignment = paragraph?.alignment ?? "left";

  const styleNames: Record<string, string> = {
    Normal: t`Normal`,
    Title: t`Title`,
    Heading1: t`Heading 1`,
    Heading2: t`Heading 2`,
    Heading3: t`Heading 3`,
    Quote: t`Quote`,
  };

  function view() {
    return editor.current?.getEditorRef()?.getView() ?? null;
  }

  /** Runs a command on the document, then puts the cursor back in it. */
  function act(run: (v: NonNullable<ReturnType<typeof view>>) => boolean | undefined) {
    const v = view();
    if (!v || readOnly) return;
    run(v);
    v.focus();
  }

  const format = (action: WordAction) => act((v) => runWordAction(v, action));

  function scrollTo(pos: number) {
    editor.current?.getEditorRef()?.scrollToPosition(pos);
  }

  function setZoom(next: number) {
    const value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 100) / 100));
    editor.current?.setZoom(value);
    setZoomState(value);
  }

  function currentZoom() {
    return zoom ?? editor.current?.getZoom() ?? 1;
  }

  function fitWidth() {
    const scroller = editor.current?.getScrollRoot();
    const page = scroller?.querySelector(".layout-page");
    if (!scroller || !(page instanceof HTMLElement) || page.offsetWidth === 0) return;
    const now = currentZoom();
    const natural = page.getBoundingClientRect().width / now;
    setZoom((scroller.clientWidth - 48) / natural);
  }

  function addComment() {
    const button = root.current?.querySelector<HTMLButtonElement>(
      'button[aria-label="Add comment"]',
    );
    if (!button) {
      toast(t`Select the words to comment on first.`);
      return;
    }
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  }

  function toggleComments() {
    root.current
      ?.querySelector<HTMLButtonElement>('[data-testid="toolbar-comments-toggle"]')
      ?.click();
  }

  function review(run: (v: NonNullable<ReturnType<typeof view>>) => boolean, none: string) {
    const v = view();
    if (!v || readOnly) return;
    if (!run(v)) toast(none);
    v.focus();
  }

  const alignments: {
    value: Alignment;
    label: string;
    icon: typeof TextAlignStart;
    key: string;
  }[] = [
    { value: "left", label: t`Align left`, icon: TextAlignStart, key: "left" },
    { value: "center", label: t`Center`, icon: TextAlignCenter, key: "center" },
    { value: "right", label: t`Align right`, icon: TextAlignEnd, key: "right" },
    { value: "both", label: t`Justify`, icon: TextAlignJustify, key: "both" },
  ];

  const home = (
    <>
      <RibbonGroup label={t`History`}>
        <RibbonButton
          icon={Undo2}
          label={t`Undo`}
          shortcut="Mod+Z"
          disabled={readOnly}
          onClick={() => editor.current?.undo()}
          testId="word-undo"
        />
        <RibbonButton
          icon={Redo2}
          label={t`Redo`}
          shortcut="Mod+Y"
          disabled={readOnly}
          onClick={() => editor.current?.redo()}
          testId="word-redo"
        />
      </RibbonGroup>
      <RibbonGroup label={t`Styles`}>
        <RibbonMenu
          label={t`Paragraph style`}
          text={styleNames[styleId] ?? styleId}
          disabled={readOnly}
          testId="word-style"
          triggerClassName="w-[118px] justify-between"
        >
          <DropdownMenuRadioGroup
            value={styleId}
            onValueChange={(id) =>
              act((v) => applyParagraphStyle(v, editor.current?.getDocument() ?? null, String(id)))
            }
          >
            {PARAGRAPH_STYLES.map((id) => (
              <DropdownMenuRadioItem key={id} value={id} className={styleClass(id)}>
                {styleNames[id]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </RibbonMenu>
      </RibbonGroup>
      <RibbonGroup label={t`Font`}>
        <RibbonMenu
          label={t`Font`}
          text={font ?? t`Font`}
          disabled={readOnly}
          testId="word-font"
          triggerClassName="w-[124px] justify-between"
        >
          <DropdownMenuRadioGroup
            value={font ?? ""}
            onValueChange={(value) => format({ type: "fontFamily", value: String(value) })}
          >
            {FONT_FAMILIES.map((name) => (
              <DropdownMenuRadioItem key={name} value={name} style={{ fontFamily: name }}>
                {name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </RibbonMenu>
        <FontSizeInput
          label={t`Font size`}
          value={fontSize}
          disabled={readOnly}
          testId="word-font-size"
          onCommit={(points) => format({ type: "fontSize", points })}
        />
        <RibbonButton
          icon={AArrowUp}
          label={t`Increase font size`}
          disabled={readOnly}
          onClick={() => format({ type: "fontSize", points: stepFontSize(fontSize ?? 11, 1) })}
        />
        <RibbonButton
          icon={AArrowDown}
          label={t`Decrease font size`}
          disabled={readOnly}
          onClick={() => format({ type: "fontSize", points: stepFontSize(fontSize ?? 11, -1) })}
        />
      </RibbonGroup>
      <RibbonGroup label={t`Text`}>
        <RibbonButton
          icon={Bold}
          label={t`Bold`}
          shortcut="Mod+B"
          pressed={text?.bold === true}
          disabled={readOnly}
          onClick={() => format("bold")}
          testId="word-bold"
        />
        <RibbonButton
          icon={Italic}
          label={t`Italic`}
          shortcut="Mod+I"
          pressed={text?.italic === true}
          disabled={readOnly}
          onClick={() => format("italic")}
          testId="word-italic"
        />
        <RibbonButton
          icon={Underline}
          label={t`Underline`}
          shortcut="Mod+U"
          pressed={Boolean(text?.underline && text.underline.style !== "none")}
          disabled={readOnly}
          onClick={() => format("underline")}
          testId="word-underline"
        />
        <RibbonButton
          icon={Strikethrough}
          label={t`Strikethrough`}
          pressed={text?.strike === true}
          disabled={readOnly}
          onClick={() => format("strikethrough")}
        />
        <ColorPicker
          icon={Baseline}
          label={t`Font colour`}
          menuLabel={t`More font colours`}
          initial={DEFAULT_TEXT_COLOR}
          clearLabel={t`Automatic`}
          customLabel={t`Custom colour…`}
          disabled={readOnly}
          testId="word-text-color"
          onPick={(hex) => format(hex ? { type: "textColor", hex } : "clearTextColor")}
        />
        <HighlightPicker
          disabled={readOnly}
          current={text?.highlight}
          onPick={(name) => format(name ? { type: "highlight", name } : "clearHighlight")}
        />
        <RibbonButton
          icon={RemoveFormatting}
          label={t`Clear formatting`}
          disabled={readOnly}
          onClick={() => format("clearFormatting")}
        />
      </RibbonGroup>
      <RibbonGroup label={t`Paragraph`}>
        {alignments.map((item) => (
          <RibbonButton
            key={item.key}
            icon={item.icon}
            label={item.label}
            pressed={alignment === item.value || (item.value === "left" && alignment === "start")}
            disabled={readOnly}
            onClick={() => format({ type: "align", value: item.value })}
            testId={`word-align-${item.key}`}
          />
        ))}
        <RibbonButton
          icon={List}
          label={t`Bullets`}
          pressed={listType === "bullet"}
          disabled={readOnly}
          onClick={() => format("bulletList")}
          testId="word-bullets"
        />
        <RibbonButton
          icon={ListOrdered}
          label={t`Numbering`}
          pressed={listType === "numbered"}
          disabled={readOnly}
          onClick={() => format("numberedList")}
        />
        <RibbonButton
          icon={IndentDecrease}
          label={t`Decrease indent`}
          disabled={readOnly}
          onClick={() => format("outdent")}
        />
        <RibbonButton
          icon={IndentIncrease}
          label={t`Increase indent`}
          disabled={readOnly}
          onClick={() => format("indent")}
        />
        <RibbonMenu icon={UnfoldVertical} label={t`Line spacing`} disabled={readOnly} width="w-28">
          <DropdownMenuRadioGroup
            value={String(paragraph?.lineSpacing ?? "")}
            onValueChange={(value) => format({ type: "lineSpacing", twips: Number(value) })}
          >
            {LINE_SPACINGS.map((item) => (
              <DropdownMenuRadioItem key={item.value} value={String(item.value)}>
                {item.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </RibbonMenu>
      </RibbonGroup>
      <RibbonGroup label={t`Editing`}>
        <RibbonButton
          icon={Search}
          label={t`Find`}
          shortcut="Mod+F"
          onClick={() => editor.current?.openFind()}
          testId="word-find"
        />
        <RibbonButton
          icon={Replace}
          label={t`Replace`}
          shortcut="Mod+H"
          disabled={readOnly}
          onClick={() => editor.current?.openReplace()}
        />
      </RibbonGroup>
    </>
  );

  const insert = (
    <>
      <RibbonGroup label={t`Tables`}>
        <TablePicker
          disabled={readOnly}
          onPick={(rows, columns) => act((v) => insertTableInView(v, rows, columns))}
        />
      </RibbonGroup>
      <RibbonGroup label={t`Illustrations`}>
        <RibbonButton
          icon={ImagePlus}
          label={t`Picture`}
          showLabel
          disabled={readOnly}
          onClick={() => imageInput.current?.click()}
          testId="word-insert-image"
        />
        <input
          ref={imageInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/bmp,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            const v = view();
            if (!file || !v || readOnly) return;
            insertImageFromFile(v, file, () => v.focus()).catch(() =>
              toast.error(t`Couldn't add that picture.`),
            );
          }}
        />
      </RibbonGroup>
      <RibbonGroup label={t`Pages`}>
        <RibbonButton
          icon={SeparatorHorizontal}
          label={t`Page break`}
          showLabel
          disabled={readOnly}
          onClick={() => act((v) => insertPageBreakInView(v))}
          testId="word-page-break"
        />
      </RibbonGroup>
      <RibbonGroup label={t`Links`}>
        <LinkPicker
          disabled={readOnly}
          onApply={(href) => act((v) => insertLink(v, href))}
          onRemove={() => format("removeLink")}
        />
      </RibbonGroup>
      <RibbonGroup label={t`Comments`}>
        <RibbonButton
          icon={MessageSquarePlus}
          label={t`Comment`}
          showLabel
          disabled={readOnly}
          onClick={addComment}
          testId="word-insert-comment"
        />
      </RibbonGroup>
    </>
  );

  const noChange = t`There are no more tracked changes.`;
  const reviewTab = (
    <>
      <RibbonGroup label={t`Tracking`}>
        <RibbonMenu
          icon={Eye}
          label={t`Show markup`}
          text={
            display === "final"
              ? t`No markup`
              : display === "original"
                ? t`Original`
                : t`All markup`
          }
          width="w-44"
        >
          <DropdownMenuRadioGroup
            value={display}
            onValueChange={(value) => onDisplayChange(value as ReviewDisplayMode)}
          >
            <DropdownMenuRadioItem value="all-markup">{t`All markup`}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="final">{t`No markup`}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="original">{t`Original`}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </RibbonMenu>
      </RibbonGroup>
      <RibbonGroup label={t`Changes`}>
        <RibbonButton
          icon={ChevronLeft}
          label={t`Previous change`}
          onClick={() => review((v) => previousChange(v, scrollTo), noChange)}
        />
        <RibbonButton
          icon={ChevronRight}
          label={t`Next change`}
          onClick={() => review((v) => nextChange(v, scrollTo), noChange)}
          testId="word-next-change"
        />
        <RibbonSplit
          icon={Check}
          label={t`Accept`}
          menuLabel={t`More ways to accept`}
          disabled={readOnly}
          onClick={() =>
            review(
              (v) => resolveChangeAtCursor(v, true),
              t`Put the cursor in a tracked change first.`,
            )
          }
          testId="word-accept"
        >
          <DropdownMenuItem
            onClick={() =>
              review(
                (v) => resolveChangeAtCursor(v, true),
                t`Put the cursor in a tracked change first.`,
              )
            }
          >
            {t`Accept this change`}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => review((v) => resolveAllChanges(v, true), noChange)}>
            {t`Accept all changes`}
          </DropdownMenuItem>
        </RibbonSplit>
        <RibbonSplit
          icon={X}
          label={t`Reject`}
          menuLabel={t`More ways to reject`}
          disabled={readOnly}
          onClick={() =>
            review(
              (v) => resolveChangeAtCursor(v, false),
              t`Put the cursor in a tracked change first.`,
            )
          }
        >
          <DropdownMenuItem
            onClick={() =>
              review(
                (v) => resolveChangeAtCursor(v, false),
                t`Put the cursor in a tracked change first.`,
              )
            }
          >
            {t`Reject this change`}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => review((v) => resolveAllChanges(v, false), noChange)}>
            {t`Reject all changes`}
          </DropdownMenuItem>
        </RibbonSplit>
      </RibbonGroup>
      <RibbonGroup label={t`Comments`}>
        <RibbonButton
          icon={MessageSquarePlus}
          label={t`New comment`}
          disabled={readOnly}
          onClick={addComment}
        />
        <RibbonButton
          icon={MessageSquareText}
          label={t`Comments`}
          showLabel
          onClick={toggleComments}
          testId="word-comments"
        />
      </RibbonGroup>
    </>
  );

  const zoomPercent = Math.round(currentZoom() * 100);
  const viewTab = (
    <>
      <RibbonGroup label={t`Zoom`}>
        <RibbonButton
          icon={ZoomOut}
          label={t`Zoom out`}
          onClick={() => setZoom(currentZoom() - 0.1)}
        />
        <RibbonMenu label={t`Zoom`} text={`${zoomPercent}%`} width="w-28" testId="word-zoom">
          {ZOOMS.map((level) => (
            <DropdownMenuItem key={level} onClick={() => setZoom(level)}>
              {Math.round(level * 100)}%
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={fitWidth}>{t`Fit width`}</DropdownMenuItem>
        </RibbonMenu>
        <RibbonButton
          icon={ZoomIn}
          label={t`Zoom in`}
          onClick={() => setZoom(currentZoom() + 0.1)}
        />
        <RibbonButton
          icon={MoveHorizontal}
          label={t`Fit width`}
          showLabel
          onClick={fitWidth}
          testId="word-fit-width"
        />
      </RibbonGroup>
    </>
  );

  return (
    <Ribbon
      label={t`Document tools`}
      value={tab}
      onValueChange={setTab}
      testId="word-ribbon"
      tabs={[
        { id: "home", label: t`Home`, content: home },
        { id: "insert", label: t`Insert`, content: insert },
        { id: "review", label: t`Review`, content: reviewTab },
        { id: "view", label: t`View`, content: viewTab },
      ]}
    />
  );
}

function styleClass(id: string): string {
  if (id === "Title") return "text-[17px] font-semibold";
  if (id === "Heading1") return "text-[15px] font-semibold text-primary";
  if (id === "Heading2") return "text-[14px] font-semibold text-primary";
  if (id === "Heading3") return "font-medium text-primary";
  if (id === "Quote") return "italic text-muted-foreground";
  return "";
}

function HighlightPicker({
  disabled,
  current,
  onPick,
}: {
  disabled: boolean;
  current: string | undefined;
  onPick: (name: string | null) => void;
}) {
  const { t } = useLingui();
  const [last, setLast] = useState("yellow");
  const hex = HIGHLIGHTS.find((item) => item.name === last)?.hex ?? null;
  const pick = (name: string | null) => {
    if (name) setLast(name);
    onPick(name);
  };
  return (
    <RibbonSplit
      icon={Highlighter}
      label={t`Highlight`}
      menuLabel={t`Highlight colours`}
      disabled={disabled}
      onClick={() => pick(last)}
      marker={<ColorMark color={hex} />}
      width="w-auto"
      testId="word-highlight"
    >
      <div className="grid grid-cols-5 gap-1 p-1">
        {HIGHLIGHTS.map((item) => (
          <DropdownMenuItem
            key={item.name}
            aria-label={item.name}
            onClick={() => pick(item.name)}
            className={`size-6 justify-center rounded-[5px] p-0 ring-1 ring-foreground/15 ${
              current === item.name ? "ring-2 ring-primary" : ""
            }`}
            style={{ background: normalizeHex(item.hex) ?? undefined }}
          />
        ))}
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => pick(null)}>{t`No highlight`}</DropdownMenuItem>
    </RibbonSplit>
  );
}

function TablePicker({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (rows: number, columns: number) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState({ rows: 0, columns: 0 });
  const cells = Array.from({ length: TABLE_GRID * TABLE_GRID }, (_, index) => ({
    row: Math.floor(index / TABLE_GRID) + 1,
    column: (index % TABLE_GRID) + 1,
  }));
  const size = hover.rows ? `${hover.columns} × ${hover.rows}` : t`Insert table`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <RibbonTip label={t`Table`}>
        <PopoverTrigger
          disabled={disabled}
          aria-label={t`Table`}
          data-testid="word-insert-table"
          onMouseDown={keepSelection}
          className={`${ribbonControl} px-2.5`}
        >
          <Table className="size-[17px]" strokeWidth={1.8} aria-hidden="true" />
          <span>{t`Table`}</span>
        </PopoverTrigger>
      </RibbonTip>
      <PopoverContent
        align="start"
        className="w-auto gap-2 p-2"
        initialFocus={false}
        onMouseLeave={() => setHover({ rows: 0, columns: 0 })}
      >
        <p className="text-center text-[12px] text-muted-foreground">{size}</p>
        <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${TABLE_GRID}, 1fr)` }}>
          {cells.map((cell) => {
            const lit = cell.row <= hover.rows && cell.column <= hover.columns;
            return (
              <button
                key={`${cell.row}-${cell.column}`}
                type="button"
                aria-label={`${cell.column} × ${cell.row}`}
                onMouseDown={keepSelection}
                onMouseEnter={() => setHover({ rows: cell.row, columns: cell.column })}
                onFocus={() => setHover({ rows: cell.row, columns: cell.column })}
                onClick={() => {
                  setOpen(false);
                  onPick(cell.row, cell.column);
                }}
                className={`size-4 rounded-[3px] ring-1 outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  lit ? "bg-primary/30 ring-primary" : "bg-background ring-foreground/15"
                }`}
              />
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LinkPicker({
  disabled,
  onApply,
  onRemove,
}: {
  disabled: boolean;
  onApply: (href: string) => void;
  onRemove: () => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  function apply() {
    const href = normalizeLink(address);
    if (!href) return;
    setOpen(false);
    setAddress("");
    onApply(href);
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <RibbonTip label={t`Link`}>
        <PopoverTrigger
          disabled={disabled}
          aria-label={t`Link`}
          data-testid="word-insert-link"
          onMouseDown={keepSelection}
          className={`${ribbonControl} px-2.5`}
        >
          <Link className="size-[17px]" strokeWidth={1.8} aria-hidden="true" />
          <span>{t`Link`}</span>
        </PopoverTrigger>
      </RibbonTip>
      <PopoverContent align="start" className="w-72 gap-2">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <Input
            autoFocus
            aria-label={t`Web address`}
            placeholder={t`Web address`}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                onRemove();
              }}
            >
              {t`Remove link`}
            </Button>
            <Button type="submit" size="sm" disabled={!address.trim()}>
              {t`Apply`}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
