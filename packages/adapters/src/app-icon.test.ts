import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { APP_ICON_SIZE, appIconPrompt, appIconSubject, cutOutBackdrop } from "./app-icon.js";
import { selectBuiltinToolsForRun } from "./run-tool-selection.js";

describe("app icons", () => {
  it("draws the assistant's object, or one that fits the title", () => {
    expect(appIconSubject("Asset register", "  a toolbox  with a tag ")).toBe(
      "a toolbox with a tag",
    );
    expect(appIconSubject("Asset register", "")).toContain('"Asset register"');
    const prompt = appIconPrompt("a toolbox");
    expect(prompt).toContain("#76BF43");
    expect(prompt).toContain("magenta #FF00FF");
    expect(prompt.endsWith("Subject: a toolbox")).toBe(true);
  });

  it("cuts the magenta backdrop out and keeps the green object", async () => {
    // Left half OCSC green, right half the magenta backdrop.
    const width = 64;
    const raw = Buffer.alloc(width * width * 3);
    for (let y = 0; y < width; y++) {
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 3;
        const [r, g, b] = x < width / 2 ? [0x76, 0xbf, 0x43] : [0xff, 0x00, 0xff];
        raw[at] = r;
        raw[at + 1] = g;
        raw[at + 2] = b;
      }
    }
    const png = await sharp(raw, { raw: { width, height: width, channels: 3 } })
      .png()
      .toBuffer();
    const out = await cutOutBackdrop(png);
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(APP_ICON_SIZE);
    expect(info.channels).toBe(4);
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    expect(alphaAt(20, 128)).toBe(255);
    expect(alphaAt(230, 128)).toBe(0);
  });
});

describe("the old page builder", () => {
  const base = {
    graphicalToolsAllowed: false,
    groupId: null,
    semanticMemoryEnabled: false,
    messagingChannelRun: false,
    followUpFromUser: true,
  };
  const names = (trigger: string) =>
    selectBuiltinToolsForRun({ ...base, trigger }).map((tool) => tool.name);

  it("is not offered in chats, where apps are built with save_app", () => {
    expect(names("user")).toContain("save_app");
    expect(names("user")).not.toContain("save_page");
  });

  it("stays for routines that refresh a page they name", () => {
    expect(names("routine")).toContain("save_page");
  });
});
