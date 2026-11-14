import { describe, expect, it } from "vitest";
import { documentDockPage, markdownTable } from "./context";
import { rangeContent, SHEET_CELLS_MAX, sheetContext } from "./sheet/context";
import { slidesContext } from "./slides/context";
import { wordContext } from "./word/context";

const wordWords = {
  page: (n: number) => `Page ${n}`,
  table: (name: string) => `Table: ${name}`,
  tableUnnamed: "Table",
  image: (name: string) => `Image: ${name}`,
  imageUnnamed: "Image",
  text: (excerpt: string) => `Text: “${excerpt}”`,
};

const slideWords = {
  slide: (n: number) => `Slide ${n}`,
  title: "Title",
  textBox: (excerpt: string) => `Text box: “${excerpt}”`,
  textBoxEmpty: "Text box",
  picture: (name: string) => `Picture: ${name}`,
  pictureUnnamed: "Picture",
  shape: (name: string) => `Shape: ${name}`,
};

describe("markdownTable", () => {
  it("uses the first row as the header and escapes pipes", () => {
    expect(
      markdownTable([
        ["A", "B"],
        ["1|2", "3"],
      ]),
    ).toBe("| A | B |\n| --- | --- |\n| 1\\|2 | 3 |");
  });

  it("stops at the cell cap and says how many rows were left out", () => {
    const rows = Array.from({ length: 10 }, (_, r) => [`r${r}a`, `r${r}b`]);
    const text = markdownTable(rows, 6);
    expect(text).toContain("r2b");
    expect(text).not.toContain("r3a");
    expect(text).toMatch(/7 more rows \(truncated\)/);
  });
});

describe("wordContext", () => {
  const view = { page: 3, pages: 9, pageText: "Intro text", headings: ["BIM essentials"] };

  it("describes a selected table as a markdown table with its caption", () => {
    const { focus, selected } = wordContext(
      {
        ...view,
        selection: {
          kind: "table",
          caption: "BIM essentials",
          rows: [
            ["Item", "Cost"],
            ["Survey", "£400"],
          ],
        },
      },
      wordWords,
    );
    expect(focus).toMatchObject({ where: "page 3 of 9", short: "Page 3" });
    expect(focus.detail).toContain("Headings: BIM essentials");
    expect(selected).toMatchObject({ what: "table", label: "Table: BIM essentials" });
    expect(selected?.content).toContain("| Survey | £400 |");
    expect(selected?.position).toBe("page 3, 2 rows, 4 cells");
  });

  it("marks a selected image as attached", () => {
    const { selected } = wordContext(
      {
        ...view,
        selection: { kind: "image", alt: "Site plan", name: "Picture 1", width: 300, height: 200 },
      },
      wordWords,
    );
    expect(selected).toMatchObject({
      what: "image",
      label: "Image: Site plan",
      imageAttached: true,
    });
  });

  it("counts paragraphs and caps long selected text", () => {
    const text = `${"a".repeat(5000)}\n\nsecond`;
    const { selected } = wordContext({ ...view, selection: { kind: "text", text } }, wordWords);
    expect(selected?.what).toBe("2 paragraphs");
    expect(selected?.content).toMatch(/… \(truncated\)$/);
  });

  it("has no selection for an empty text selection", () => {
    expect(
      wordContext({ ...view, selection: { kind: "text", text: "  " } }, wordWords).selected,
    ).toBeNull();
  });
});

describe("slidesContext", () => {
  it("names a picked picture and its position", () => {
    const { focus, selected } = slidesContext(
      {
        index: 3,
        count: 8,
        title: "Programme",
        texts: ["Phase 1"],
        notes: "Mention delays",
        picked: {
          kind: "picture",
          name: "Picture 4",
          text: "",
          alt: "Gantt chart",
          placeholder: null,
          box: { x: 360000, y: 720000, w: 3600000, h: 1800000 },
        },
      },
      slideWords,
    );
    expect(focus.short).toBe("Slide 4");
    expect(focus.detail).toContain("Mention delays");
    expect(selected).toMatchObject({
      what: "picture",
      label: "Picture: Gantt chart",
      imageAttached: true,
    });
    expect(selected?.position).toContain("1");
  });

  it("labels the title placeholder as the title", () => {
    const { selected } = slidesContext(
      {
        index: 0,
        count: 1,
        title: "Hello",
        texts: [],
        notes: "",
        picked: {
          kind: "text",
          name: "Title 1",
          text: "Hello",
          alt: null,
          placeholder: "title",
          box: null,
        },
      },
      slideWords,
    );
    expect(selected?.label).toBe("Title");
  });
});

describe("sheetContext", () => {
  const read = (row: number, col: number) =>
    col === 3
      ? { value: String(row * 2), formula: `B${row}*2` }
      : { value: `v${row}.${col}`, formula: null };

  it("lists values and formulas of the selected range", () => {
    const input = {
      sheet: "Sheet1",
      sheetCount: 2,
      visible: { top: 1, left: 1, bottom: 30, right: 8 },
      selection: { top: 2, left: 2, bottom: 3, right: 3 },
      read,
    };
    const { focus, selected } = sheetContext(input, { cells: (ref, n) => `${ref} (${n} cells)` });
    expect(focus.where).toContain("A1:H30");
    expect(selected.label).toBe("Sheet1!B2:C3 (4 cells)");
    expect(selected.content).toContain("Formulas:");
    expect(selected.content).toContain("C2: =B2*2");
    expect(selected.content).not.toContain("truncated");
  });

  it("caps the cells at the limit and says so", () => {
    const text = rangeContent({
      sheet: "Sheet1",
      sheetCount: 1,
      visible: null,
      selection: { top: 1, left: 1, bottom: 100, right: 5 },
      read,
    });
    expect(text).toContain(`showing the first ${SHEET_CELLS_MAX} of 500 cells (truncated)`);
  });
});

describe("documentDockPage", () => {
  it("keeps a note without the selection for when it is dropped", () => {
    const page = documentDockPage({
      kind: "word",
      name: "Brief.docx",
      rootArtifactId: "r1",
      artifactId: "a3",
      version: 3,
      focus: { where: "page 3 of 9", short: "Page 3" },
      selected: { what: "table", label: "Table: BIM essentials", content: "| a |" },
    });
    expect(page.title).toBe("Brief");
    expect(page.note).toContain("Selected: the table");
    expect(page.bareNote).not.toContain("Selected:");
    expect(page.chip).toMatchObject({
      label: "Page 3 · Table: BIM essentials",
      bareLabel: "Page 3",
      hasSelection: true,
    });
  });
});
