import { describe, expect, it } from "vitest";
import { openStudioNote, stripStudioNote } from "./studio-note.js";

describe("openStudioNote", () => {
  it("names the open whiteboard and a blank canvas", () => {
    const note = openStudioNote({
      kind: "whiteboard",
      title: "BIM Process",
      id: "board-1",
      blank: true,
    });
    expect(note).toContain("Whiteboard studio");
    expect(note).toContain('with "BIM Process" open (whiteboardId board-1)');
    expect(note).toContain("The canvas is blank");
    expect(stripStudioNote(`ok but connect it up\n\n${note}`)).toBe("ok but connect it up");
  });

  it("names the open app, and a studio with none", () => {
    const open = openStudioNote({ kind: "app", title: "Site diary", id: "app-1" });
    expect(open).toContain("App Studio");
    expect(open).toContain("(appId app-1)");
    expect(open).toContain("This is the app they are looking at");
    const blank = openStudioNote({ kind: "app", blank: true });
    expect(blank).toContain("No app is open and the canvas is blank");
  });

  it("names the open to-do list, including an empty board", () => {
    const open = openStudioNote({
      kind: "todo",
      title: "Personal",
      id: "personal",
    });
    expect(open).toContain("To-do studio");
    expect(open).toContain("(todoListId personal)");
    expect(open).toContain("todo_add");
    const blank = openStudioNote({ kind: "todo", title: "Site", id: "list-1", blank: true });
    expect(blank).toContain("The board is empty");
    expect(blank).toContain("list_id list-1");
    expect(stripStudioNote(`add these\n\n${open}`)).toBe("add these");
  });

  it("keeps a whiteboard selection inside the hidden block", () => {
    const note = openStudioNote({
      kind: "whiteboard",
      title: "Plan",
      id: "board-1",
      selection: [{ id: "api", kind: "rect", text: "API" }],
    });
    expect(note).toContain("Selected on the whiteboard:\n- api (rect): API");
    expect(stripStudioNote(`[Plan](page:board-1)\nMove it\n\n${note}`)).toBe(
      "[Plan](page:board-1)\nMove it",
    );
  });
});
