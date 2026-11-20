import { describe, expect, it } from "vitest";
import { categoryKey, nextCategoryColour, withCategories } from "./categories";
import type { PlanDocument } from "./plan";

describe("categoryKey", () => {
  it("makes a readable key that does not clash", () => {
    expect(categoryKey("M&E Services", [])).toBe("m-e-services");
    expect(categoryKey("General", ["general"])).toBe("general-2");
    expect(categoryKey("General", ["general", "general-2"])).toBe("general-3");
    expect(categoryKey("  !!  ", [])).toBe("category");
  });
});

describe("nextCategoryColour", () => {
  it("skips colours already in use", () => {
    expect(nextCategoryColour([{ label: "General", color: "#76bf43" }])).toBe("#3B82F6");
  });
});

describe("withCategories", () => {
  const plan: PlanDocument = {
    tasks: [{ id: "t1", label: "Drainage", category: "civils", start: "2027-01-04", end: "2027-01-08" }],
    categories: { default: { label: "General", color: "#76BF43" } },
  };

  it("leaves out a new category no task uses", () => {
    expect(withCategories(plan, new Map([["unused", { label: "Unused", color: "#000" }]]))).toBe(plan);
  });

  it("adds new categories and keeps existing ones", () => {
    const next = withCategories(plan, new Map([["civils", { label: "Civils", color: "#3B82F6" }]]));
    expect(next.categories).toEqual({
      default: { label: "General", color: "#76BF43" },
      civils: { label: "Civils", color: "#3B82F6" },
    });
  });

  it("returns the same plan when nothing is new", () => {
    expect(withCategories(plan, new Map([["default", { label: "Other", color: "#000" }]]))).toBe(plan);
  });
});
