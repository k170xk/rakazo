import { describe, expect, it } from "vitest";
import { nativeDownloadFor } from "./native-downloads";

const origin = "https://computer.example";

function link(href: string, download?: string) {
  return {
    href,
    getAttribute: (name: string) => (name === "download" ? (download ?? null) : null),
    hasAttribute: (name: string) => name === "download" && download !== undefined,
  };
}

describe("nativeDownloadFor", () => {
  it("leaves single-use token links for the native side to fetch", () => {
    expect(nativeDownloadFor(link(`${origin}/api/artifacts/download?token=a`), origin)).toEqual({
      kind: "url",
      url: `${origin}/api/artifacts/download?token=a`,
    });
    expect(
      nativeDownloadFor(link(`${origin}/api/account/export?token=b`, "report.zip"), origin),
    ).toEqual({ kind: "url", url: `${origin}/api/account/export?token=b`, name: "report.zip" });
  });

  it("reads files built in the page or behind the session in the page", () => {
    expect(nativeDownloadFor(link("blob:https://computer.example/1", "table.csv"), origin)).toEqual(
      { kind: "inline", url: "blob:https://computer.example/1", name: "table.csv" },
    );
    expect(nativeDownloadFor(link(`${origin}/files/plan.pdf`, ""), origin)).toEqual({
      kind: "inline",
      url: `${origin}/files/plan.pdf`,
      name: "plan.pdf",
    });
  });

  it("opens documents linked from other sites in the app", () => {
    expect(
      nativeDownloadFor(link("https://files.example/docs/AI%20policy.pdf?token=x"), origin),
    ).toEqual({
      kind: "url",
      url: "https://files.example/docs/AI%20policy.pdf?token=x",
      name: "AI policy.pdf",
    });
  });

  it("ignores ordinary links and other sites", () => {
    expect(nativeDownloadFor(link(`${origin}/app/1`), origin)).toBeNull();
    expect(nativeDownloadFor(link("https://other.example/page", "a.pdf"), origin)).toBeNull();
    expect(nativeDownloadFor(link("blob:https://computer.example/2"), origin)).toBeNull();
  });
});
