import { describe, expect, it } from "vitest";
import { APP_KIT_GUIDE } from "../guide.js";
import { auditAppCraft, buildApp, MAX_BUNDLE_BYTES } from "./index.js";

describe("engineering apps", () => {
  it("builds the guide's engineering example with maths, plots and units inside the size limit", async () => {
    const example = /## Engineering example\n```tsx\n([\s\S]*?)```/.exec(APP_KIT_GUIDE)?.[1];
    expect(example).toBeTruthy();
    for (const kit of ["@ocsc/eng", "@ocsc/math", "@ocsc/plot"]) expect(example).toContain(`from "${kit}"`);
    expect(auditAppCraft({ "App.tsx": example! })).toEqual([]);
    const built = await buildApp({ "App.tsx": example! }, { title: "Beam" });
    expect(built.ok ? [] : built.errors).toEqual([]);
    if (!built.ok) return;
    expect(built.bytes).toBeLessThan(MAX_BUNDLE_BYTES * 0.6);
    const parts = Object.fromEntries(built.weight.map((w) => [w.part, w.kb]));
    expect(parts["@ocsc/math"]).toBeLessThan(560);
    expect(parts["@ocsc/plot"]).toBeLessThan(60);
    expect(parts["@ocsc/eng"]).toBeLessThan(40);
    expect(built.js).toContain("data:font/woff2;base64,");
  }, 60_000);
});
