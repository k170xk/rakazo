import { describe, expect, it } from "vitest";
import { buildApp } from "./build/index.js";
import {
  applyStyles,
  applyVisualEdit,
  locClass,
  locFromClass,
  readElement,
  VISUAL_EDIT_CLASSES,
} from "./visual-edit.js";

const APP = `import { Button, PageHeader, cn } from "@ocsc/ui";
import { Plus } from "lucide-react";
export default function App({ name, wide }: { name: string; wide: boolean }) {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">Don't miss a deadline</h1>
      <PageHeader title="Projects" description='Every job in one place' />
      <Button icon={<Plus />} onClick={() => { if (wide) return; }}>Add job</Button>
      <p className={cn("text-sm text-muted-foreground", wide && "max-w-none")}>Hello <b>there</b> {name}</p>
      <span className={wide ? "a" : "b"}>{"Literal words"}</span>
    </div>
  );
}
`;
const files = { "App.tsx": APP };
const at = (line: number, text: string) =>
  `App.tsx:${line}:${APP.split("\n")[line - 1]!.indexOf(text) + 1}`;

describe("readElement", () => {
  it("lists the words and classes written at a place", () => {
    expect(readElement(files, at(6, "<h1"))).toEqual({
      file: "App.tsx",
      name: "h1",
      texts: [{ id: "child:0", label: "Text", value: "Don't miss a deadline" }],
      classes: ["text-2xl", "font-bold"],
      styles: expect.objectContaining({ size: "text-2xl", weight: "font-bold", color: null }),
    });
  });

  it("offers a component's text props and its children, past JSX inside attributes", () => {
    const header = readElement(files, at(7, "<PageHeader"));
    expect(header).toMatchObject({
      name: "PageHeader",
      texts: [
        { id: "prop:title", value: "Projects" },
        { id: "prop:description", value: "Every job in one place" },
      ],
      classes: [],
    });
    expect(readElement(files, at(8, "<Button"))).toMatchObject({
      texts: [{ id: "child:0", value: "Add job" }],
    });
  });

  it("reads the literal in cn() and says when classes are computed", () => {
    expect(readElement(files, at(9, "<p"))).toMatchObject({
      texts: [{ value: "Hello" }],
      classes: ["text-sm", "text-muted-foreground"],
    });
    expect(readElement(files, at(10, "<span"))).toMatchObject({
      classes: null,
      texts: [{ value: "Literal words" }],
    });
  });

  it("refuses a place that is no longer an element", () => {
    expect(readElement(files, "App.tsx:99:1")).toHaveProperty("error");
    expect(readElement(files, "Missing.tsx:1:1")).toHaveProperty("error");
  });
});

describe("applyVisualEdit", () => {
  const edit = (loc: string, change: Parameters<typeof applyVisualEdit>[2]) => {
    const result = applyVisualEdit(files, loc, change);
    if ("error" in result) throw new Error(result.error);
    return result.files["App.tsx"]!;
  };

  it("changes words and one style group, leaving everything else alone", () => {
    const next = edit(at(6, "<h1"), {
      texts: { "child:0": "Never miss a deadline" },
      styles: { size: "text-4xl" },
    });
    expect(next).toContain('<h1 className="font-bold text-4xl">Never miss a deadline</h1>');
    expect(next.replace(/<h1.*<\/h1>/, "")).toBe(APP.replace(/<h1.*<\/h1>/, ""));
  });

  it("adds a className to an element that had none and quotes awkward words", () => {
    const next = edit(at(8, "<Button"), {
      texts: { "child:0": "Add {job}" },
      styles: { radius: "rounded-full" },
    });
    expect(next).toContain('<Button className="rounded-full" icon={<Plus />}');
    expect(next).toContain('>{"Add {job}"}</Button>');
  });

  it("rewrites prop strings, switching to an expression when the quote is inside", () => {
    expect(edit(at(7, "<PageHeader"), { texts: { "prop:title": "Live jobs" } })).toContain(
      'title="Live jobs"',
    );
    expect(edit(at(7, "<PageHeader"), { texts: { "prop:title": 'The "live" jobs' } })).toContain(
      'title={"The \\"live\\" jobs"}',
    );
  });

  it("edits only the literal inside cn() and keeps the surrounding text spacing", () => {
    const next = edit(at(9, "<p"), {
      texts: { "child:0": "Hi" },
      styles: { color: "text-primary" },
    });
    expect(next).toContain(
      'className={cn("text-sm text-primary", wide && "max-w-none")}>Hi <b>there</b> {name}</p>',
    );
  });

  it("refuses style changes on computed classes but still edits literal text", () => {
    expect(applyVisualEdit(files, at(10, "<span"), { styles: { size: "text-lg" } })).toHaveProperty(
      "error",
    );
    expect(edit(at(10, "<span"), { texts: { "child:0": "New words" } })).toContain(
      '<span className={wide ? "a" : "b"}>{"New words"}</span>',
    );
  });

  it("removes a group with null and ignores options outside the brand list", () => {
    expect(applyStyles(["p-4", "text-2xl", "flex"], { size: null, padding: "p-8" })).toEqual([
      "flex",
      "p-8",
    ]);
    expect(applyStyles(["text-2xl"], { color: "text-[#0000ff]" })).toEqual(["text-2xl"]);
  });

  it("returns the same files when nothing changed", () => {
    const result = applyVisualEdit(files, at(6, "<h1"), {
      texts: { "child:0": "Don't miss a deadline" },
    });
    expect(result).toEqual({ files });
  });
});

describe("place classes and preview builds", () => {
  it("round-trips a place through a class name", () => {
    expect(locFromClass(locClass("pages/Home.tsx:12:7"))).toBe("pages/Home.tsx:12:7");
    expect(locFromClass("text-sm")).toBeNull();
  });

  it("tags kit components in previews and carries every visual-edit class there only", async () => {
    const preview = await buildApp(files, { mode: "preview" });
    const published = await buildApp(files);
    if (!preview.ok || !published.ok) throw new Error("build failed");
    expect(preview.js).toContain("ocsc@");
    for (const name of ["text-5xl", "rounded-3xl", "shadow-xl"]) {
      expect(VISUAL_EDIT_CLASSES).toContain(name);
      expect(preview.css).toContain(`.${name}`);
      expect(published.css).not.toContain(`.${name}{`);
    }
  });
});
