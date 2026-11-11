import { describe, expect, it } from "vitest";
import { cn, toneFor } from "./cn.js";

describe("cn", () => {
  it("lets a later class replace a conflicting one", () => {
    expect(cn("text-foreground hover:bg-muted", "text-destructive")).toBe(
      "hover:bg-muted text-destructive",
    );
    expect(cn("h-10 px-4 text-sm", "h-8 text-[13px]")).toBe("px-4 h-8 text-[13px]");
    expect(cn("bg-card shadow-card", "bg-primary/10 shadow-lift")).toBe(
      "bg-primary/10 shadow-lift",
    );
  });

  it("keeps classes from different groups and variants", () => {
    expect(cn("text-sm text-muted-foreground text-left")).toBe(
      "text-sm text-muted-foreground text-left",
    );
    expect(cn("bg-muted hover:bg-accent dark:bg-card")).toBe(
      "bg-muted hover:bg-accent dark:bg-card",
    );
    expect(cn("border border-border border-l-4", "border-primary")).toBe(
      "border border-l-4 border-primary",
    );
    expect(cn("gap-4 gap-x-2 px-2 p-4")).toBe("gap-4 gap-x-2 px-2 p-4");
    expect(cn("rounded-xl rounded-t-lg")).toBe("rounded-xl rounded-t-lg");
    expect(cn("bg-[linear-gradient(90deg,red,blue)] bg-[length:200%_100%] bg-muted")).toContain(
      "bg-[length:200%_100%]",
    );
  });

  it("skips empty values", () => {
    expect(cn("a", false, null, undefined, 0, "b")).toBe("a b");
  });
});

describe("toneFor", () => {
  it("colours common status words", () => {
    expect(toneFor("Complete")).toBe("success");
    expect(toneFor("Overdue")).toBe("danger");
    expect(toneFor("In progress")).toBe("warning");
    expect(toneFor("Planned")).toBe("info");
    expect(toneFor("Banana")).toBe("neutral");
  });
});
