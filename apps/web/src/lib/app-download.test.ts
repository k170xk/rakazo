import { describe, expect, it } from "vitest";
import { downloadName } from "./app-host";

describe("downloadName", () => {
  it("keeps a name that already ends as its type does", () => {
    expect(downloadName("jobs.csv", ["csv"])).toBe("jobs.csv");
    expect(downloadName("Notes.MD", ["md", "markdown"])).toBe("Notes.MD");
  });

  it("adds the type's ending to a name that would open as something else", () => {
    expect(downloadName("invoice.html", ["txt", "log"])).toBe("invoice.html.txt");
    expect(downloadName("setup.exe", ["json"])).toBe("setup.exe.json");
    expect(downloadName("report", ["csv"])).toBe("report.csv");
    expect(downloadName("  ", ["ics"])).toBe("download.ics");
  });
});
