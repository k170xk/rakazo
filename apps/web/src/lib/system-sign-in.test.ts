import { describe, expect, it, vi } from "vitest";
import { systemSignIn } from "./system-sign-in";

const location = { origin: "https://computer.ocsc.me" };

function host(result: unknown) {
  return {
    location,
    Capacitor: {
      isPluginAvailable: (name: string) => name === "SystemSignIn",
      nativePromise: vi.fn(() =>
        result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
      ),
    },
  };
}

describe("systemSignIn", () => {
  it("leaves browsers to navigate", async () => {
    expect(await systemSignIn("https://evolve.ocsc.me/x", "/api/auth/evolve", { location })).toBe(
      undefined,
    );
  });

  it("returns the callback address on this origin", async () => {
    const url = "https://computer.ocsc.me/api/auth/evolve?token=abc";
    expect(await systemSignIn("https://evolve.ocsc.me/x", "/api/auth/evolve", host({ url }))).toBe(
      url,
    );
  });

  it("ignores a closed sheet or another address", async () => {
    expect(await systemSignIn("https://e/x", "/api/auth/evolve", host({}))).toBeNull();
    expect(
      await systemSignIn(
        "https://e/x",
        "/api/auth/evolve",
        host({ url: "https://evil.test/api/auth/evolve" }),
      ),
    ).toBeNull();
  });

  it("falls back where the sheet is unavailable", async () => {
    const unavailable = Object.assign(new Error("Needs iOS 17.4"), { code: "UNAVAILABLE" });
    expect(await systemSignIn("https://e/x", "/api/auth/evolve", host(unavailable))).toBe(
      undefined,
    );
  });
});
