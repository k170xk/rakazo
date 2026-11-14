import { describe, expect, it } from "vitest";
import { categoryForAppTitle, groupByAppCategory } from "./app-category";

describe("categoryForAppTitle", () => {
  it("files the apps staff already have under the work they do", () => {
    expect(categoryForAppTitle("Geotechnical Site Investigation & Lab Testing Tracker")).toBe(
      "field",
    );
    expect(categoryForAppTitle("BIM Attribute Register")).toBe("register");
  });

  it("prefers the more specific kind of work", () => {
    expect(categoryForAppTitle("Fee tracker")).toBe("clients");
    expect(categoryForAppTitle("Site inspection tracker")).toBe("field");
    expect(categoryForAppTitle("Resource planning rota")).toBe("people");
  });

  it("leaves a title it cannot place as a custom tool", () => {
    expect(categoryForAppTitle("Monday notes")).toBe("custom");
    expect(categoryForAppTitle("Website programming helper")).toBe("custom");
  });
});

describe("groupByAppCategory", () => {
  it("keeps listed order inside a category and puts custom tools last", () => {
    const grouped = groupByAppCategory(
      [
        { title: "Monday notes" },
        { title: "BIM Attribute Register" },
        { title: "Asset register" },
        { title: "Lab diary" },
      ],
      (item) => item.title,
    );
    expect(grouped.map((group) => group.id)).toEqual(["register", "field", "custom"]);
    expect(grouped[0]?.items.map((item) => item.title)).toEqual([
      "BIM Attribute Register",
      "Asset register",
    ]);
  });
});
