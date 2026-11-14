import { useLingui } from "@lingui/react/macro";
import type { HorizontalAlignment, VerticalAlignment } from "@office-kit/xlsx/styles";
import { getCell } from "@office-kit/xlsx/worksheet";
import {
  Button,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  toast,
} from "@rakazo/ui-web";
import {
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDownAZ,
  ArrowDownZA,
  Baseline,
  BetweenHorizontalStart,
  Bold,
  DecimalsArrowLeft,
  DecimalsArrowRight,
  Eraser,
  FilePlus2,
  Grid2x2,
  Grid3x3,
  Hash,
  Italic,
  PaintBucket,
  Pencil,
  Percent,
  Redo2,
  Rows3,
  Sigma,
  Snowflake,
  SquareFunction,
  Strikethrough,
  TableCellsMerge,
  TableCellsSplit,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Trash2,
  Underline,
  Undo2,
  WrapText,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { RefObject } from "react";
import { useState } from "react";
import { ColorPicker } from "../ribbon/ColorPicker";
import {
  keepSelection,
  Ribbon,
  RibbonButton,
  RibbonGroup,
  RibbonMenu,
  RibbonSplit,
  RibbonTip,
  ribbonControl,
  useRibbonShortcuts,
} from "../ribbon/Ribbon";
import { DEFAULT_FILL, DEFAULT_TEXT_COLOR } from "../ribbon/swatches";
import type { CellPos, CellRange } from "./address";
import { cellRef } from "./address";
import type { BorderKind, FontToggle, FunctionGroup, NumberFormatKey } from "./commands";
import {
  addSheet,
  autoSumFormula,
  cellLook,
  clearFormats,
  currentRegion,
  decimalsOf,
  deleteRowsAt,
  deleteSheet,
  FUNCTIONS,
  formatTarget,
  gridlinesShown,
  insertFunction,
  insertRowsAt,
  looksLikeHeader,
  mergeRange,
  NUMBER_FORMATS,
  renameSheetTo,
  setBorders,
  setFillColor,
  setFontColor,
  setFontStyle,
  setGridlines,
  setHorizontal,
  setNumberFormat,
  setVertical,
  setWrap,
  sortRows,
  stepDecimals,
  unmergeRange,
} from "./commands";
import type { Workbook, Worksheet } from "./workbook";
import { clearRange } from "./workbook";

export const SHEET_ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

type SheetRibbonProps = {
  scope: RefObject<HTMLElement | null>;
  wb: Workbook;
  ws: Worksheet | undefined;
  sheet: string;
  range: CellRange;
  active: CellPos;
  readOnly: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Runs a change to the workbook; `run` answers whether anything changed. */
  onChange: (run: () => boolean) => void;
  /** Opens the formula bar on the active cell holding `text`. */
  onFormula: (text: string) => void;
  /** What the formula bar holds now. */
  formulaText: string;
  onSwitchSheet: (title: string) => void;
  frozen: { rows: number; cols: number };
  onFreeze: (rows: number, cols: number) => void;
  zoom: number;
  onZoom: (zoom: number) => void;
};

export function SheetRibbon({
  scope,
  wb,
  ws,
  sheet,
  range,
  active,
  readOnly,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onChange,
  onFormula,
  formulaText,
  onSwitchSheet,
  frozen,
  onFreeze,
  zoom,
  onZoom,
}: SheetRibbonProps) {
  const { t } = useLingui();
  const [tab, setTab] = useState("home");
  const editable = !readOnly && ws !== undefined;
  const look = ws ? cellLook(wb, ws, active) : null;
  const activeRef = cellRef(active);

  /** Runs a formatting change over the selection, trimmed to the used area when it is huge. */
  function format(run: (sheet: Worksheet, target: CellRange) => void) {
    if (!editable || !ws) return;
    const target = formatTarget(ws, range);
    if (!target) {
      toast(t`That selection is too large to format at once. Select fewer cells.`);
      return;
    }
    onChange(() => {
      run(ws, target);
      return true;
    });
  }

  const fontStyle = (style: FontToggle, on: boolean) =>
    format((sheetWs, target) => setFontStyle(wb, sheetWs, target, style, on));

  function merge(center: boolean) {
    if (!editable || !ws) return;
    let result = "";
    onChange(() => {
      result = mergeRange(ws, range, center, wb);
      return result === "merged";
    });
    if (result === "single") toast(t`Select two or more cells to merge.`);
    else if (result === "values")
      toast(t`Only the top-left cell can keep its value. Clear the other cells first, then merge.`);
    else if (result === "overlap")
      toast(t`That selection cuts across merged cells. Unmerge them first.`);
  }

  function unmerge() {
    if (!editable || !ws) return;
    onChange(() => unmergeRange(ws, range) > 0);
  }

  function decimals(direction: 1 | -1) {
    if (!look) return;
    const cell = ws ? getCell(ws, active.row, active.col) : undefined;
    const code = stepDecimals(look.numberFormat, direction, cell ? decimalsOf(cell.value) : 0);
    format((sheetWs, target) => setNumberFormat(wb, sheetWs, target, code));
  }

  function sort(descending: boolean) {
    if (!editable || !ws) return;
    const single = range.top === range.bottom && range.left === range.right;
    const region = single ? currentRegion(ws, active) : range;
    const body =
      single && looksLikeHeader(ws, region) ? { ...region, top: region.top + 1 } : region;
    let result = "";
    onChange(() => {
      result = sortRows(ws, body, active.col, descending);
      return result === "sorted";
    });
    if (result === "formulas")
      toast(t`Sorting cells with formulas could change what they add up, so it isn't done here.`);
    else if (result === "merged")
      toast(t`Sorting doesn't work across merged cells. Unmerge them first.`);
    else if (result === "nothing") toast(t`Select two or more rows to sort.`);
  }

  function autoSum(name = "SUM") {
    if (!editable || !ws) return;
    onFormula(autoSumFormula(ws, active).replace(/^=SUM\(/, `=${name}(`));
  }

  function rows(insert: boolean) {
    if (!editable || !ws) return;
    const count = range.bottom - range.top + 1;
    onChange(() => {
      if (insert) insertRowsAt(wb, ws, range.top, count);
      else deleteRowsAt(wb, ws, range.top, count);
      return true;
    });
  }

  function newSheet() {
    if (readOnly) return;
    let name = "";
    onChange(() => {
      name = addSheet(wb, sheet);
      return true;
    });
    if (name) onSwitchSheet(name);
  }

  function removeSheet() {
    if (readOnly) return;
    let gone = false;
    onChange(() => {
      gone = deleteSheet(wb, sheet);
      return gone;
    });
    if (!gone) {
      toast(t`A workbook needs at least one sheet.`);
      return;
    }
    toast(t`Sheet ${sheet} deleted.`, { action: { label: t`Undo`, onClick: onUndo } });
  }

  useRibbonShortcuts(scope, [
    { shortcut: "Mod+Z", run: onUndo, disabled: readOnly },
    { shortcut: "Mod+Y", run: onRedo, disabled: readOnly },
    { shortcut: "Mod+Shift+Z", run: onRedo, disabled: readOnly },
    { shortcut: "Mod+B", run: () => fontStyle("bold", !look?.bold), disabled: !editable },
    { shortcut: "Mod+I", run: () => fontStyle("italic", !look?.italic), disabled: !editable },
    { shortcut: "Mod+U", run: () => fontStyle("underline", !look?.underline), disabled: !editable },
    { shortcut: "Mod+5", run: () => fontStyle("strike", !look?.strike), disabled: !editable },
  ]);

  const horizontals: { value: HorizontalAlignment; label: string; icon: typeof Bold }[] = [
    { value: "left", label: t`Align left`, icon: TextAlignStart },
    { value: "center", label: t`Center`, icon: TextAlignCenter },
    { value: "right", label: t`Align right`, icon: TextAlignEnd },
  ];
  const verticals: { value: VerticalAlignment; label: string; icon: typeof Bold }[] = [
    { value: "top", label: t`Top align`, icon: AlignVerticalJustifyStart },
    { value: "center", label: t`Middle align`, icon: AlignVerticalJustifyCenter },
    { value: "bottom", label: t`Bottom align`, icon: AlignVerticalJustifyEnd },
  ];
  const formats: { key: NumberFormatKey; label: string }[] = [
    { key: "general", label: t`General` },
    { key: "number", label: t`Number` },
    { key: "pounds", label: t`Currency (£)` },
    { key: "euros", label: t`Currency (€)` },
    { key: "dollars", label: t`Currency ($)` },
    { key: "percent", label: t`Percentage` },
    { key: "date", label: t`Short date` },
    { key: "text", label: t`Text` },
  ];
  const borders: { kind: BorderKind; label: string; icon: typeof Bold }[] = [
    { kind: "all", label: t`All borders`, icon: Grid2x2 },
    { kind: "outside", label: t`Outside borders`, icon: Grid3x3 },
    { kind: "none", label: t`No border`, icon: Eraser },
  ];
  const groups: { group: FunctionGroup; label: string }[] = [
    { group: "common", label: t`Most used` },
    { group: "maths", label: t`Maths` },
    { group: "logical", label: t`Logical` },
    { group: "lookup", label: t`Lookup` },
    { group: "text", label: t`Text` },
    { group: "date", label: t`Date and time` },
  ];
  const currentFormat =
    formats.find((item) => NUMBER_FORMATS[item.key] === look?.numberFormat)?.label ??
    (look?.numberFormat === "General" ? t`General` : t`Custom`);

  const history = (
    <RibbonGroup label={t`History`}>
      <RibbonButton
        icon={Undo2}
        label={t`Undo`}
        shortcut="Mod+Z"
        disabled={readOnly || !canUndo}
        onClick={onUndo}
        testId="sheet-undo"
      />
      <RibbonButton
        icon={Redo2}
        label={t`Redo`}
        shortcut="Mod+Y"
        disabled={readOnly || !canRedo}
        onClick={onRedo}
        testId="sheet-redo"
      />
    </RibbonGroup>
  );

  const home = (
    <>
      {history}
      <RibbonGroup label={t`Font`}>
        <RibbonButton
          icon={Bold}
          label={t`Bold`}
          shortcut="Mod+B"
          pressed={look?.bold === true}
          disabled={!editable}
          onClick={() => fontStyle("bold", !look?.bold)}
          testId="sheet-bold"
        />
        <RibbonButton
          icon={Italic}
          label={t`Italic`}
          shortcut="Mod+I"
          pressed={look?.italic === true}
          disabled={!editable}
          onClick={() => fontStyle("italic", !look?.italic)}
        />
        <RibbonButton
          icon={Underline}
          label={t`Underline`}
          shortcut="Mod+U"
          pressed={look?.underline === true}
          disabled={!editable}
          onClick={() => fontStyle("underline", !look?.underline)}
        />
        <RibbonButton
          icon={Strikethrough}
          label={t`Strikethrough`}
          shortcut="Mod+5"
          pressed={look?.strike === true}
          disabled={!editable}
          onClick={() => fontStyle("strike", !look?.strike)}
        />
        <ColorPicker
          icon={Baseline}
          label={t`Font colour`}
          menuLabel={t`More font colours`}
          initial={DEFAULT_TEXT_COLOR}
          clearLabel={t`Automatic`}
          customLabel={t`Custom colour…`}
          disabled={!editable}
          testId="sheet-font-color"
          onPick={(hex) => format((sheetWs, target) => setFontColor(wb, sheetWs, target, hex))}
        />
        <ColorPicker
          icon={PaintBucket}
          label={t`Fill colour`}
          menuLabel={t`More fill colours`}
          initial={DEFAULT_FILL}
          clearLabel={t`No fill`}
          customLabel={t`Custom colour…`}
          disabled={!editable}
          testId="sheet-fill-color"
          onPick={(hex) => format((sheetWs, target) => setFillColor(wb, sheetWs, target, hex))}
        />
      </RibbonGroup>
      <RibbonGroup label={t`Alignment`}>
        {horizontals.map((item) => (
          <RibbonButton
            key={item.value}
            icon={item.icon}
            label={item.label}
            pressed={look?.horizontal === item.value}
            disabled={!editable}
            onClick={() =>
              format((sheetWs, target) =>
                setHorizontal(
                  wb,
                  sheetWs,
                  target,
                  look?.horizontal === item.value ? "general" : item.value,
                ),
              )
            }
            testId={`sheet-align-${item.value}`}
          />
        ))}
        {verticals.map((item) => (
          <RibbonButton
            key={item.value}
            icon={item.icon}
            label={item.label}
            pressed={look?.vertical === item.value}
            disabled={!editable}
            onClick={() =>
              format((sheetWs, target) => setVertical(wb, sheetWs, target, item.value))
            }
          />
        ))}
        <RibbonButton
          icon={WrapText}
          label={t`Wrap text`}
          pressed={look?.wrap === true}
          disabled={!editable}
          onClick={() => format((sheetWs, target) => setWrap(wb, sheetWs, target, !look?.wrap))}
          testId="sheet-wrap"
        />
        <RibbonSplit
          icon={TableCellsMerge}
          label={t`Merge and centre`}
          menuLabel={t`More merge options`}
          disabled={!editable}
          onClick={() => merge(true)}
          width="w-48"
          testId="sheet-merge"
        >
          <DropdownMenuItem onClick={() => merge(true)}>
            <TableCellsMerge aria-hidden="true" />
            {t`Merge and centre`}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => merge(false)}>
            <TableCellsMerge aria-hidden="true" />
            {t`Merge cells`}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={unmerge}>
            <TableCellsSplit aria-hidden="true" />
            {t`Unmerge cells`}
          </DropdownMenuItem>
        </RibbonSplit>
      </RibbonGroup>
      <RibbonGroup label={t`Number`}>
        <RibbonMenu
          icon={Hash}
          label={t`Number format`}
          text={currentFormat}
          disabled={!editable}
          width="w-48"
          triggerClassName="w-[112px] justify-between"
          testId="sheet-number-format"
        >
          {formats.map((item) => (
            <DropdownMenuItem
              key={item.key}
              onClick={() =>
                format((sheetWs, target) =>
                  setNumberFormat(wb, sheetWs, target, NUMBER_FORMATS[item.key]),
                )
              }
            >
              {item.label}
            </DropdownMenuItem>
          ))}
        </RibbonMenu>
        <RibbonButton
          icon={Percent}
          label={t`Percentage`}
          disabled={!editable}
          onClick={() =>
            format((sheetWs, target) =>
              setNumberFormat(wb, sheetWs, target, NUMBER_FORMATS.percent),
            )
          }
        />
        <RibbonButton
          icon={DecimalsArrowRight}
          label={t`Increase decimals`}
          disabled={!editable}
          onClick={() => decimals(1)}
          testId="sheet-more-decimals"
        />
        <RibbonButton
          icon={DecimalsArrowLeft}
          label={t`Decrease decimals`}
          disabled={!editable}
          onClick={() => decimals(-1)}
        />
      </RibbonGroup>
      <RibbonGroup label={t`Cells`}>
        <RibbonMenu
          icon={Grid2x2}
          label={t`Borders`}
          disabled={!editable}
          width="w-48"
          testId="sheet-borders"
        >
          {borders.map((item) => (
            <DropdownMenuItem
              key={item.kind}
              onClick={() =>
                format((sheetWs, target) => setBorders(wb, sheetWs, target, item.kind))
              }
            >
              <item.icon aria-hidden="true" />
              {item.label}
            </DropdownMenuItem>
          ))}
        </RibbonMenu>
        <RibbonMenu
          icon={Eraser}
          label={t`Clear`}
          disabled={!editable}
          width="w-48"
          testId="sheet-clear"
        >
          <DropdownMenuItem
            onClick={() =>
              ws && onChange(() => clearRange(ws, formatTarget(ws, range) ?? range) > 0)
            }
          >
            {t`Clear contents`}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => format((sheetWs, target) => clearFormats(wb, sheetWs, target))}
          >
            {t`Clear formats`}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              format((sheetWs, target) => {
                clearRange(sheetWs, target);
                clearFormats(wb, sheetWs, target);
              })
            }
          >
            {t`Clear all`}
          </DropdownMenuItem>
        </RibbonMenu>
      </RibbonGroup>
    </>
  );

  const rowCount = range.bottom - range.top + 1;
  const insert = (
    <>
      <RibbonGroup label={t`Rows`}>
        <RibbonButton
          icon={BetweenHorizontalStart}
          label={rowCount > 1 ? t`Insert ${rowCount} rows above` : t`Insert row above`}
          showLabel
          disabled={!editable}
          onClick={() => rows(true)}
          testId="sheet-insert-rows"
        />
        <RibbonButton
          icon={Rows3}
          label={rowCount > 1 ? t`Delete ${rowCount} rows` : t`Delete row`}
          showLabel
          disabled={!editable}
          onClick={() => rows(false)}
          testId="sheet-delete-rows"
        />
      </RibbonGroup>
      <RibbonGroup label={t`Sheets`}>
        <RibbonButton
          icon={FilePlus2}
          label={t`New sheet`}
          showLabel
          disabled={readOnly}
          onClick={newSheet}
          testId="sheet-add-sheet"
        />
        <RenameSheet
          wb={wb}
          sheet={sheet}
          disabled={readOnly || !ws}
          onRename={(name) => {
            let problem: ReturnType<typeof renameSheetTo> = null;
            onChange(() => {
              problem = renameSheetTo(wb, sheet, name);
              return problem === null && name !== sheet;
            });
            if (problem === null) onSwitchSheet(name);
            return problem;
          }}
        />
        <RibbonButton
          icon={Trash2}
          label={t`Delete sheet`}
          disabled={readOnly}
          onClick={removeSheet}
          testId="sheet-delete-sheet"
        />
      </RibbonGroup>
    </>
  );

  const formulas = (
    <>
      <RibbonGroup label={t`Functions`}>
        <RibbonSplit
          icon={Sigma}
          label={t`AutoSum`}
          menuLabel={t`More quick totals`}
          disabled={!editable}
          onClick={() => autoSum()}
          width="w-40"
          testId="sheet-autosum"
        >
          <DropdownMenuItem onClick={() => autoSum("SUM")}>{t`Sum`}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => autoSum("AVERAGE")}>{t`Average`}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => autoSum("COUNT")}>{t`Count numbers`}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => autoSum("MAX")}>{t`Max`}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => autoSum("MIN")}>{t`Min`}</DropdownMenuItem>
        </RibbonSplit>
        <RibbonMenu
          icon={SquareFunction}
          label={t`Insert function`}
          showLabel
          disabled={!editable}
          width="w-48"
          testId="sheet-functions"
        >
          <DropdownMenuLabel>{t`Adds to the formula in ${activeRef}`}</DropdownMenuLabel>
          {groups.map((item) => (
            <DropdownMenuSub key={item.group}>
              <DropdownMenuSubTrigger>{item.label}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 w-44 overflow-y-auto">
                {FUNCTIONS.filter((fn) => fn.group === item.group).map((fn) => (
                  <DropdownMenuItem
                    key={fn.name}
                    className="font-mono text-[12px]"
                    onClick={() => onFormula(insertFunction(formulaText, fn.name))}
                  >
                    {fn.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
        </RibbonMenu>
      </RibbonGroup>
    </>
  );

  const data = (
    <RibbonGroup label={t`Sort`}>
      <RibbonButton
        icon={ArrowDownAZ}
        label={t`Sort A to Z`}
        showLabel
        disabled={!editable}
        onClick={() => sort(false)}
        testId="sheet-sort-asc"
      />
      <RibbonButton
        icon={ArrowDownZA}
        label={t`Sort Z to A`}
        showLabel
        disabled={!editable}
        onClick={() => sort(true)}
        testId="sheet-sort-desc"
      />
    </RibbonGroup>
  );

  const gridlines = ws ? gridlinesShown(ws) : true;
  const view = (
    <>
      <RibbonGroup label={t`Window`}>
        <RibbonMenu
          icon={Snowflake}
          label={t`Freeze panes`}
          showLabel
          disabled={!editable}
          width="w-56"
          testId="sheet-freeze"
        >
          <DropdownMenuItem onClick={() => onFreeze(1, 0)}>{t`Freeze top row`}</DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onFreeze(0, 1)}
          >{t`Freeze first column`}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onFreeze(active.row - 1, active.col - 1)}>
            {t`Freeze above and left of ${activeRef}`}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={frozen.rows === 0 && frozen.cols === 0}
            onClick={() => onFreeze(0, 0)}
          >
            {t`Unfreeze`}
          </DropdownMenuItem>
        </RibbonMenu>
      </RibbonGroup>
      <RibbonGroup label={t`Show`}>
        <RibbonButton
          icon={Grid3x3}
          label={t`Gridlines`}
          showLabel
          pressed={gridlines}
          disabled={!editable}
          onClick={() =>
            ws &&
            onChange(() => {
              setGridlines(ws, !gridlines);
              return true;
            })
          }
          testId="sheet-gridlines"
        />
      </RibbonGroup>
      <RibbonGroup label={t`Zoom`}>
        <RibbonButton
          icon={ZoomOut}
          label={t`Zoom out`}
          onClick={() => onZoom(Math.max(0.5, Math.round((zoom - 0.1) * 10) / 10))}
        />
        <RibbonMenu
          label={t`Zoom`}
          text={`${Math.round(zoom * 100)}%`}
          width="w-28"
          testId="sheet-zoom"
        >
          {SHEET_ZOOMS.map((level) => (
            <DropdownMenuItem key={level} onClick={() => onZoom(level)}>
              {Math.round(level * 100)}%
            </DropdownMenuItem>
          ))}
        </RibbonMenu>
        <RibbonButton
          icon={ZoomIn}
          label={t`Zoom in`}
          onClick={() => onZoom(Math.min(2, Math.round((zoom + 0.1) * 10) / 10))}
        />
      </RibbonGroup>
    </>
  );

  return (
    <Ribbon
      label={t`Spreadsheet tools`}
      value={tab}
      onValueChange={setTab}
      testId="sheet-ribbon"
      tabs={[
        { id: "home", label: t`Home`, content: home },
        { id: "insert", label: t`Insert`, content: insert },
        { id: "formulas", label: t`Formulas`, content: formulas },
        { id: "data", label: t`Data`, content: data },
        { id: "view", label: t`View`, content: view },
      ]}
    />
  );
}

function RenameSheet({
  wb,
  sheet,
  disabled,
  onRename,
}: {
  wb: Workbook;
  sheet: string;
  disabled: boolean;
  onRename: (name: string) => ReturnType<typeof renameSheetTo>;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(sheet);
  const [problem, setProblem] = useState<string | null>(null);
  const messages = {
    empty: t`Type a name for the sheet.`,
    long: t`Sheet names can be up to 31 characters.`,
    characters: t`Sheet names can't contain slashes, question marks, asterisks, square brackets or colons.`,
    quote: t`Sheet names can't start or end with an apostrophe.`,
    taken: t`Another sheet already has that name.`,
  } as const;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName(sheet);
          setProblem(null);
        }
      }}
    >
      <RibbonTip label={t`Rename sheet`}>
        <PopoverTrigger
          disabled={disabled}
          aria-label={t`Rename sheet`}
          data-testid="sheet-rename-sheet"
          onMouseDown={keepSelection}
          className={ribbonControl}
        >
          <Pencil className="size-[17px]" strokeWidth={1.8} aria-hidden="true" />
        </PopoverTrigger>
      </RibbonTip>
      <PopoverContent align="start" className="w-72 gap-2">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const result = onRename(name.trim());
            if (result) setProblem(messages[result]);
            else setOpen(false);
          }}
        >
          <Input
            autoFocus
            aria-label={t`Sheet name`}
            value={name}
            maxLength={31}
            onChange={(event) => {
              setName(event.target.value);
              setProblem(null);
            }}
            aria-invalid={problem !== null}
          />
          {problem ? <p className="text-[12px] text-destructive">{problem}</p> : null}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!name.trim() || wb.sheets.length === 0}>
              {t`Rename`}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
