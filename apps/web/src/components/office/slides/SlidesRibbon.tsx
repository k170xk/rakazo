import { useLingui } from "@lingui/react/macro";
import type { SlideData, SlideShapeData } from "@office-kit/pptx";
import { getShapeId, getShapeKind } from "@office-kit/pptx";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, toast } from "@rakazo/ui-web";
import {
  AArrowDown,
  AArrowUp,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Baseline,
  Bold,
  BringToFront,
  Circle,
  Copy,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  Minus,
  MoveHorizontal,
  PaintBucket,
  PenLine,
  Play,
  Plus,
  Presentation,
  RectangleHorizontal,
  Redo2,
  SendToBack,
  Shapes,
  Square,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  Trash2,
  Type,
  Underline,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { RefObject } from "react";
import { useRef, useState } from "react";
import { ColorPicker } from "../ribbon/ColorPicker";
import { FontSizeInput } from "../ribbon/FontSizeInput";
import {
  Ribbon,
  RibbonButton,
  RibbonGroup,
  RibbonMenu,
  RibbonSplit,
  useRibbonShortcuts,
} from "../ribbon/Ribbon";
import { DEFAULT_OUTLINE, DEFAULT_SHAPE_FILL, DEFAULT_TEXT_COLOR } from "../ribbon/swatches";
import type { Arrange, InsertShape, SlideAlign, TextAlign } from "./commands";
import {
  addSlideWithLayout,
  alignToSlide,
  arrangeShape,
  deleteShape,
  insertPicture,
  insertShape,
  insertTextBox,
  layoutsOf,
  setFill,
  setOutline,
  setTextAlign,
  setTextColor,
  setTextSize,
  stepTextSize,
  textLook,
  toggleBullets,
  toggleTextStyle,
} from "./commands";
import type { Deck } from "./deck";
import { canEditText, canMoveShape } from "./deck";
import type { ShapePick } from "./SlideCanvas";

export const SLIDE_ZOOMS = [0.5, 0.75, 1, 1.5, 2] as const;
export const MIN_SLIDE_ZOOM = 0.25;
export const MAX_SLIDE_ZOOM = 3;

/** What an edit leaves selected: another slide, another shape, or nothing. */
export type SlideEditResult = { index?: number; pick?: ShapePick | null } | undefined;

type SlidesRibbonProps = {
  scope: RefObject<HTMLElement | null>;
  deck: Deck;
  slide: SlideData;
  index: number;
  shape: SlideShapeData | null;
  pick: ShapePick | null;
  readOnly: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Runs a change to the deck, then saves it as one step to undo. */
  onChange: (change: () => SlideEditResult) => void;
  onSlideOp: (op: "add" | "duplicate" | "delete") => void;
  zoom: number;
  onZoom: (zoom: number) => void;
  onPresent: (from: number) => void;
};

/** Natural size of a picture file, read by the browser. */
async function pictureSize(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

export function SlidesRibbon({
  scope,
  deck,
  slide,
  index,
  shape,
  pick,
  readOnly,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onChange,
  onSlideOp,
  zoom,
  onZoom,
  onPresent,
}: SlidesRibbonProps) {
  const { t } = useLingui();
  const [tab, setTab] = useState("home");
  const pictureInput = useRef<HTMLInputElement>(null);

  const kind = shape ? getShapeKind(shape) : null;
  const textual = !readOnly && shape !== null && canEditText(shape);
  const placeable =
    !readOnly && shape !== null && pick !== null && canMoveShape(shape, pick.nested);
  const stylable =
    !readOnly &&
    shape !== null &&
    pick?.nested === false &&
    (kind === "shape" || kind === "connector");
  const look = textual && shape ? textLook(deck, shape) : null;

  const onShape = (run: (target: SlideShapeData) => void) => () => {
    if (!shape) return;
    onChange(() => {
      run(shape);
      return undefined;
    });
  };

  const inserted = (made: SlideShapeData): SlideEditResult => ({
    pick: { id: getShapeId(made), nested: false },
  });

  function addPicture(file: File) {
    if (readOnly) return;
    Promise.all([file.arrayBuffer(), pictureSize(file)])
      .then(([buffer, size]) =>
        onChange(() => inserted(insertPicture(deck, slide, new Uint8Array(buffer), size))),
      )
      .catch(() => toast.error(t`Couldn't add that picture.`));
  }

  function zoomBy(step: number) {
    onZoom(
      Math.min(MAX_SLIDE_ZOOM, Math.max(MIN_SLIDE_ZOOM, Math.round((zoom + step) * 100) / 100)),
    );
  }

  const layouts = readOnly ? [] : layoutsOf(deck);
  const removeShape = onShape((target) => deleteShape(target));

  useRibbonShortcuts(scope, [
    { shortcut: "Mod+Z", run: onUndo, disabled: readOnly },
    { shortcut: "Mod+Y", run: onRedo, disabled: readOnly },
    { shortcut: "Mod+Shift+Z", run: onRedo, disabled: readOnly },
    { shortcut: "Mod+M", run: () => onSlideOp("add"), disabled: readOnly },
    { shortcut: "Mod+D", run: () => onSlideOp("duplicate"), disabled: readOnly },
    {
      shortcut: "Mod+B",
      run: onShape((s) => toggleTextStyle(deck, s, "bold")),
      disabled: !textual,
    },
    {
      shortcut: "Mod+I",
      run: onShape((s) => toggleTextStyle(deck, s, "italic")),
      disabled: !textual,
    },
    {
      shortcut: "Mod+U",
      run: onShape((s) => toggleTextStyle(deck, s, "underline")),
      disabled: !textual,
    },
    { shortcut: "Delete", run: () => removeShape(), disabled: !placeable },
    { shortcut: "Backspace", run: () => removeShape(), disabled: !placeable },
    { shortcut: "F5", run: () => onPresent(0) },
    { shortcut: "Shift+F5", run: () => onPresent(index) },
  ]);

  const alignments: { value: TextAlign; label: string; icon: typeof TextAlignStart }[] = [
    { value: "left", label: t`Align left`, icon: TextAlignStart },
    { value: "center", label: t`Center`, icon: TextAlignCenter },
    { value: "right", label: t`Align right`, icon: TextAlignEnd },
    { value: "justify", label: t`Justify`, icon: TextAlignJustify },
  ];

  const shapes: { value: InsertShape; label: string; icon: typeof Square }[] = [
    { value: "rect", label: t`Rectangle`, icon: Square },
    { value: "roundRect", label: t`Rounded rectangle`, icon: RectangleHorizontal },
    { value: "ellipse", label: t`Oval`, icon: Circle },
    { value: "line", label: t`Line`, icon: Minus },
    { value: "arrow", label: t`Arrow`, icon: ArrowRight },
  ];

  const order: { value: Arrange; label: string; icon: typeof Square }[] = [
    { value: "forward", label: t`Bring forward`, icon: ArrowUpFromLine },
    { value: "backward", label: t`Send backward`, icon: ArrowDownToLine },
    { value: "front", label: t`Bring to front`, icon: BringToFront },
    { value: "back", label: t`Send to back`, icon: SendToBack },
  ];

  const places: { value: SlideAlign; label: string; icon: typeof Square }[] = [
    { value: "left", label: t`Align left`, icon: AlignStartVertical },
    { value: "center", label: t`Align centre`, icon: AlignCenterVertical },
    { value: "right", label: t`Align right`, icon: AlignEndVertical },
    { value: "top", label: t`Align top`, icon: AlignStartHorizontal },
    { value: "middle", label: t`Align middle`, icon: AlignCenterHorizontal },
    { value: "bottom", label: t`Align bottom`, icon: AlignEndHorizontal },
  ];

  const history = (
    <RibbonGroup label={t`History`}>
      <RibbonButton
        icon={Undo2}
        label={t`Undo`}
        shortcut="Mod+Z"
        disabled={readOnly || !canUndo}
        onClick={onUndo}
        testId="slides-undo"
      />
      <RibbonButton
        icon={Redo2}
        label={t`Redo`}
        shortcut="Mod+Y"
        disabled={readOnly || !canRedo}
        onClick={onRedo}
        testId="slides-redo"
      />
    </RibbonGroup>
  );

  const home = (
    <>
      {history}
      <RibbonGroup label={t`Slides`}>
        <RibbonSplit
          icon={Plus}
          label={t`New slide`}
          menuLabel={t`Choose a layout`}
          shortcut="Mod+M"
          disabled={readOnly}
          onClick={() => onSlideOp("add")}
          width="w-60"
          testId="slides-new-slide"
        >
          <DropdownMenuLabel>{t`Layouts`}</DropdownMenuLabel>
          {layouts.map((item) => (
            <DropdownMenuItem
              key={item.name}
              onClick={() =>
                onChange(() => ({
                  index: addSlideWithLayout(deck, index, item.layout),
                  pick: null,
                }))
              }
            >
              {item.name}
            </DropdownMenuItem>
          ))}
        </RibbonSplit>
        <RibbonButton
          icon={Copy}
          label={t`Duplicate slide`}
          shortcut="Mod+D"
          disabled={readOnly}
          onClick={() => onSlideOp("duplicate")}
        />
        <RibbonButton
          icon={Trash2}
          label={t`Delete slide`}
          disabled={readOnly}
          onClick={() => onSlideOp("delete")}
        />
      </RibbonGroup>
      <RibbonGroup label={t`Font`}>
        <FontSizeInput
          label={t`Font size`}
          value={look?.size ?? undefined}
          disabled={!textual}
          testId="slides-font-size"
          onCommit={(points) => onShape((s) => setTextSize(s, points))()}
        />
        <RibbonButton
          icon={AArrowUp}
          label={t`Increase font size`}
          disabled={!textual}
          onClick={onShape((s) => stepTextSize(deck, s, 1))}
        />
        <RibbonButton
          icon={AArrowDown}
          label={t`Decrease font size`}
          disabled={!textual}
          onClick={onShape((s) => stepTextSize(deck, s, -1))}
        />
        <RibbonButton
          icon={Bold}
          label={t`Bold`}
          shortcut="Mod+B"
          pressed={look?.bold === true}
          disabled={!textual}
          onClick={onShape((s) => toggleTextStyle(deck, s, "bold"))}
          testId="slides-bold"
        />
        <RibbonButton
          icon={Italic}
          label={t`Italic`}
          shortcut="Mod+I"
          pressed={look?.italic === true}
          disabled={!textual}
          onClick={onShape((s) => toggleTextStyle(deck, s, "italic"))}
        />
        <RibbonButton
          icon={Underline}
          label={t`Underline`}
          shortcut="Mod+U"
          pressed={look?.underline === true}
          disabled={!textual}
          onClick={onShape((s) => toggleTextStyle(deck, s, "underline"))}
        />
        <ColorPicker
          icon={Baseline}
          label={t`Font colour`}
          menuLabel={t`More font colours`}
          initial={DEFAULT_TEXT_COLOR}
          customLabel={t`Custom colour…`}
          disabled={!textual}
          testId="slides-text-color"
          onPick={(hex) => onShape((s) => setTextColor(s, hex))()}
        />
      </RibbonGroup>
      <RibbonGroup label={t`Paragraph`}>
        {alignments.map((item) => (
          <RibbonButton
            key={item.value}
            icon={item.icon}
            label={item.label}
            pressed={look?.align === item.value}
            disabled={!textual}
            onClick={onShape((s) => setTextAlign(s, item.value))}
          />
        ))}
        <RibbonButton
          icon={List}
          label={t`Bullets`}
          pressed={look?.bullet === "bullet"}
          disabled={!textual}
          onClick={onShape((s) => toggleBullets(deck, s, "bullet"))}
          testId="slides-bullets"
        />
        <RibbonButton
          icon={ListOrdered}
          label={t`Numbering`}
          pressed={look?.bullet === "number"}
          disabled={!textual}
          onClick={onShape((s) => toggleBullets(deck, s, "number"))}
        />
      </RibbonGroup>
    </>
  );

  const insert = (
    <>
      <RibbonGroup label={t`Text`}>
        <RibbonButton
          icon={Type}
          label={t`Text box`}
          showLabel
          disabled={readOnly}
          onClick={() => onChange(() => inserted(insertTextBox(deck, slide, t`Text`)))}
          testId="slides-insert-text"
        />
      </RibbonGroup>
      <RibbonGroup label={t`Illustrations`}>
        <RibbonMenu
          icon={Shapes}
          label={t`Shapes`}
          showLabel
          disabled={readOnly}
          width="w-52"
          testId="slides-insert-shape"
        >
          {shapes.map((item) => (
            <DropdownMenuItem
              key={item.value}
              onClick={() => onChange(() => inserted(insertShape(deck, slide, item.value)))}
            >
              <item.icon aria-hidden="true" />
              {item.label}
            </DropdownMenuItem>
          ))}
        </RibbonMenu>
        <RibbonButton
          icon={ImagePlus}
          label={t`Picture`}
          showLabel
          disabled={readOnly}
          onClick={() => pictureInput.current?.click()}
          testId="slides-insert-image"
        />
        <input
          ref={pictureInput}
          type="file"
          accept="image/png,image/jpeg,image/gif"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) addPicture(file);
          }}
        />
      </RibbonGroup>
    </>
  );

  const arrange = (
    <>
      <RibbonGroup label={t`Order`}>
        {order.map((item) => (
          <RibbonButton
            key={item.value}
            icon={item.icon}
            label={item.label}
            disabled={!placeable}
            onClick={onShape((s) => arrangeShape(s, item.value))}
            testId={`slides-arrange-${item.value}`}
          />
        ))}
      </RibbonGroup>
      <RibbonGroup label={t`Align to slide`}>
        {places.map((item) => (
          <RibbonButton
            key={item.value}
            icon={item.icon}
            label={item.label}
            disabled={!placeable}
            onClick={onShape((s) => alignToSlide(deck, s, item.value))}
          />
        ))}
      </RibbonGroup>
      <RibbonGroup label={t`Shape style`}>
        <ColorPicker
          icon={PaintBucket}
          label={t`Fill`}
          menuLabel={t`More fill colours`}
          initial={DEFAULT_SHAPE_FILL}
          clearLabel={t`No fill`}
          customLabel={t`Custom colour…`}
          disabled={!stylable || kind === "connector"}
          testId="slides-fill"
          onPick={(hex) => onShape((s) => setFill(s, hex))()}
        />
        <ColorPicker
          icon={PenLine}
          label={t`Outline`}
          menuLabel={t`More outline colours`}
          initial={DEFAULT_OUTLINE}
          clearLabel={t`No outline`}
          customLabel={t`Custom colour…`}
          disabled={!stylable}
          testId="slides-outline"
          onPick={(hex) => onShape((s) => setOutline(s, hex))()}
        />
      </RibbonGroup>
      <RibbonGroup label={t`Edit`}>
        <RibbonButton
          icon={Trash2}
          label={t`Delete shape`}
          shortcut="Delete"
          disabled={!placeable}
          onClick={removeShape}
          testId="slides-delete-shape"
        />
      </RibbonGroup>
    </>
  );

  const percent = Math.round(zoom * 100);
  const view = (
    <>
      <RibbonGroup label={t`Zoom`}>
        <RibbonButton icon={ZoomOut} label={t`Zoom out`} onClick={() => zoomBy(-0.25)} />
        <RibbonMenu label={t`Zoom`} text={`${percent}%`} width="w-28" testId="slides-zoom">
          {SLIDE_ZOOMS.map((level) => (
            <DropdownMenuItem key={level} onClick={() => onZoom(level)}>
              {Math.round(level * 100)}%
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onZoom(1)}>{t`Fit to window`}</DropdownMenuItem>
        </RibbonMenu>
        <RibbonButton icon={ZoomIn} label={t`Zoom in`} onClick={() => zoomBy(0.25)} />
        <RibbonButton
          icon={MoveHorizontal}
          label={t`Fit to window`}
          showLabel
          pressed={zoom === 1}
          onClick={() => onZoom(1)}
        />
      </RibbonGroup>
      <RibbonGroup label={t`Slideshow`}>
        <RibbonButton
          icon={Presentation}
          label={t`From beginning`}
          shortcut="F5"
          showLabel
          onClick={() => onPresent(0)}
          testId="slides-present"
        />
        <RibbonButton
          icon={Play}
          label={t`From current slide`}
          shortcut="Shift+F5"
          showLabel
          onClick={() => onPresent(index)}
        />
      </RibbonGroup>
    </>
  );

  return (
    <Ribbon
      label={t`Presentation tools`}
      value={tab}
      onValueChange={setTab}
      testId="slides-ribbon"
      tabs={[
        { id: "home", label: t`Home`, content: home },
        { id: "insert", label: t`Insert`, content: insert },
        { id: "arrange", label: t`Arrange`, content: arrange },
        { id: "view", label: t`View`, content: view },
      ]}
      end={
        <RibbonButton
          icon={Presentation}
          label={t`Present`}
          shortcut="Shift+F5"
          showLabel
          onClick={() => onPresent(index)}
          className="text-primary"
        />
      }
    />
  );
}
