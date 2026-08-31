import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  liveSendDisposition,
  preferredActiveRunStatus,
} from "./run-state.js";

describe("run state machine", () => {
  it("allows takeover resume onto a lease", () => {
    expect(canTransition("waiting_takeover", "leased")).toBe(true);
    expect(canTransition("waiting_takeover", "running")).toBe(false);
  });

  it("redirects a follow-up onto the live turn instead of starting a rival run", () => {
    expect(liveSendDisposition("running")).toBe("redirect");
    expect(liveSendDisposition("leased")).toBe("redirect");
    expect(liveSendDisposition("waiting_takeover")).toBe("redirect");
    expect(liveSendDisposition("waiting_input")).toBe("resume");
    expect(liveSendDisposition("queued")).toBe("new-run");
    expect(liveSendDisposition(undefined)).toBe("new-run");
  });

  it("prefers a live run over a newer queued one on the roster", () => {
    expect(preferredActiveRunStatus(["queued", "running"])).toBe("running");
    expect(preferredActiveRunStatus(["queued"])).toBe("queued");
    expect(preferredActiveRunStatus([])).toBe("idle");
  });

  it("rejects rewriting a completed run", () => {
    expect(() => assertTransition("completed", "running")).toThrow(/illegal/i);
  });

  it("never leaves a terminal state except failed retry", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("completed" as const, "cancelled" as const),
        fc.constantFrom(
          "queued" as const,
          "leased" as const,
          "running" as const,
          "waiting_input" as const,
          "completed" as const,
        ),
        (from, to) => {
          expect(canTransition(from, to)).toBe(false);
        },
      ),
    );
  });
});
