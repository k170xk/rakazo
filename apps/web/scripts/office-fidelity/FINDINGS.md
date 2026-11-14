# Office fidelity spike: findings

Run 14 November 2026 with `node apps/web/scripts/office-fidelity/run.mjs --keep` from the repo root.
The script makes real files with the OCSC runner scripts (`ocsc-word new` then `edit` for a tracked
change, `ocsc-pptx new`, `ocsc-xlsx new`) and saves each one twice: once unchanged and once with a
small edit. It then compares `ocsc … read` before and after, lists zip parts that were lost, added or
changed, and counts XML elements in each changed part. After a studio save, it runs an `ocsc … edit`
on the result to check the assistant can keep working on the file.

Engine versions: `@office-kit/docx` 0.2.1, `@office-kit/pptx` 0.28.0, `@office-kit/xlsx` 0.27.0,
`@stll/folio-core` 0.69.0. Everything below ran in Node 22 with no browser.

## Verdicts

| Format | Verdict | Lost parts |
| --- | --- | --- |
| Word (Folio editor) | Full editing | None. Empty runs are dropped and runs with the same formatting are merged, which changes nothing a reader sees. |
| Word (office-kit) | Full editing for text replacement and validation | None |
| PowerPoint (office-kit) | Full editing for text boxes and notes | None |
| Excel (office-kit) | Full editing for values. Show recalculation as pending. | None. Cached formula results stay as they were. |

Before shipping, open the saved files in desktop Word, PowerPoint and Excel. The spike did not do
this.

## Word

Source: `Report-tracked.docx`. It uses the OCSC template with a cover, contents field, headers and
footers, a table, lists and a page break. It also contains one tracked replacement by "OCSC Bot".

- **office-kit, unchanged**: `ocsc word read` is identical. No parts were lost or added. Five parts
  were rewritten (content types, document rels, document, header and footer rels) with the same
  element counts, so only serialization changed. `validate()` reports no issues.
- **office-kit, `replaceText` of one sentence**: `ocsc word read` shows only that paragraph changed.
  `validate()` is clean, the tracked change survives (`revisions()` = 2: one insertion and one
  deletion), and the assistant's `ocsc word edit add_to_section` works on the result.
- **Folio, parse and repack in Node** (`parseDocx` then `repackDocx`): `ocsc word read` is
  identical. Only `word/document.xml` and `docProps/core.xml` change. One empty run is dropped. These
  counts stay the same: tracked changes (`w:ins`/`w:del`, with the author and date kept), 5 section
  breaks, 5 header references, 2 drawings, 3 field characters, 3 tables, numbering and paragraph
  styles.
- **Folio, editor path** (`toProseDoc`, then insert a word in the ProseMirror document, then
  `fromProseDoc`, then `repackDocx`): `ocsc word read` shows only the edited paragraph changed. Raw
  element counts fall (`w:r` 108 to 101, `w:rPr` 108 to 100). Comparing every run that has visible
  text and its formatting shows this comes from removing empty runs and merging runs with the same
  formatting. The only formatting difference is in one cover run's font element, where Folio writes
  the complex-script font out explicitly (`w:cs="Arial"`) instead of inheriting it. That makes no
  visible change. office-kit `validate()` is clean, and the assistant's follow-up edit works.
- **Folio conformance check** (`validateDocxConformance` from `@stll/folio-core/server`): it gives
  the same two warnings before and after. One says the parser preserved 22 elements it doesn't model.
  The other says a drawing has zero height. Both come from the OCSC template, not from the save.

Verdict: **full editing in the Folio editor.** Run office-kit `validate()` before each save, as the
plan says. Keep the read-only preview as the fallback for files Folio fails to parse.

## PowerPoint

Source: `Deck.pptx`. It has six slides: cover, agenda, steps with an image, chart, table and
closing, with speaker notes.

- **Unchanged** `loadPresentation` then `savePresentation`: `ocsc pptx read` is identical. Only
  `[Content_Types].xml` is rewritten. The chart, image, layouts, masters and notes parts are all kept
  byte for byte. `validatePresentation` is clean.
- **Edited** (`setShapeText(..., { preserveFormatting: true })` on one text box, `setSlideNotes` on
  the cover): `ocsc pptx read` shows exactly those two changes. Only that slide and its notes part
  change. Validation is clean, and the assistant's `ocsc pptx edit replace_text` works on the result.

Verdict: **full editing for text boxes and notes.** Moving and resizing shapes, and adding,
reordering or removing slides, were not tested here. Test them when the Presentation studio is built.

## Excel

Source: `Book.xlsx`. It has two sheets, currency and date formats, formulas with a total row, a frozen
header row, autofilter and column widths.

- **Unchanged** `loadWorkbook` then `workbookToBytes`: `ocsc xlsx read` is identical, and no parts
  are lost or added. Nine parts are rewritten with the same element counts. Columns, panes,
  autofilter, number formats, cell styles, page setup and formulas all keep their counts.
- **Edited** (`setCellAtAddress(wb, "Costs!C2", 475)`): `getCellDisplayText` gives `£475.00`. The
  cached values of the cells that depend on C2 stay as they were (`D2` = £5,400.00, total = £10,540.00
  in the file). `ocsc xlsx read` reports £5,700.00 and £10,840.00 because it calculates formulas
  itself, so those two cells show up in the read diff on purpose. `<calcPr fullCalcOnLoad="1"/>` is
  kept. `ocsc xlsx new` already writes it, so office-kit kept it rather than added it. The assistant's
  `ocsc xlsx edit set` works on the result.
- office-kit xlsx has no public `validate()`. The workbook check is the `ocsc xlsx read` comparison
  plus a clean reload.

Verdict: **full editing for values and formulas,** but the studio must show "recalculates when
opened in Excel" for cells that depend on an edited cell. Files that weren't made by `ocsc` might not
have `fullCalcOnLoad`. For those, the Excel studio should set it through the workbook calc properties
before saving.

## API calls that worked (Node, no browser)

```js
// Word, office-kit
import { openDocx, validate, replaceText, revisions, toUint8Array } from "@office-kit/docx";
const doc = openDocx(bytes);                 // Uint8Array
validate(doc);                               // [] when clean; items carry level/code/message
replaceText(doc, "old", "new");              // returns the number of replacements
const out = toUint8Array(doc);

// Word, Folio (core runs in Node; the editor UI needs a browser)
import { parseDocx, validateDocxConformance } from "@stll/folio-core/server";
import { repackDocx } from "@stll/folio-core/docx/rezip";
import { toProseDoc, fromProseDoc } from "@stll/folio-core/prosemirror/conversion";
const parsed = await parseDocx(arrayBuffer);
const pm = toProseDoc(parsed, { styles: parsed.package?.styles, numbering: parsed.package?.numbering, theme: parsed.package?.theme ?? null });
const rebuilt = fromProseDoc(editedPm, parsed, { stylesheetSource: { type: "package" } });
const out = await repackDocx(rebuilt);

// PowerPoint
import { loadPresentation, savePresentation, validatePresentation, getSlides, getSlideShapes, getShapeText, setShapeText, setSlideNotes } from "@office-kit/pptx";
const deck = await loadPresentation(bytes);
setShapeText(shape, "text", { preserveFormatting: true });
const out = await savePresentation(deck);

// Excel
import { loadWorkbook, fromArrayBuffer, workbookToBytes } from "@office-kit/xlsx/io";
import { getCellAtAddress, setCellAtAddress } from "@office-kit/xlsx/workbook";
import { getCellDisplayText } from "@office-kit/xlsx/styles";
const wb = await loadWorkbook(fromArrayBuffer(bytes));
setCellAtAddress(wb, "Costs!C2", 475);
const out = await workbookToBytes(wb);
```

## Not covered

- The read-only Word preview and the slide preview are browser renderers, so they were not run here.
  Check them in the studio.
- Opening the files in desktop Office. Run the script with `--keep` to keep the files, then open
  them by hand.
- Comments, SmartArt, video, pivot tables and macros. The OCSC generators don't produce these. Test
  them with real files from staff before the Presentation and Excel studios ship.
