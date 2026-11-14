import { describe, expect, it } from "vitest";
import type { BoardItem } from "./whiteboard.js";
import { inspectBoardLayout, layoutBoardItems, routeBoardArrow } from "./whiteboard-layout.js";

describe("whiteboard layout engine", () => {
  it("wraps sections around their children and avoids overlaps on multi-stage workflows", () => {
    const messy: BoardItem[] = [
      {
        id: "title",
        kind: "text",
        x: 0,
        y: 0,
        w: 120,
        h: 32,
        text: "OCSC Tender Delivery Workflow",
      },
      {
        id: "s1",
        kind: "section",
        x: 0,
        y: 0,
        w: 200,
        h: 120,
        text: "1. Mobilisation",
        color: "blue",
      },
      {
        id: "s2",
        kind: "section",
        x: 0,
        y: 0,
        w: 200,
        h: 120,
        text: "2. Authoring & Review",
        color: "green",
      },
      {
        id: "itt",
        kind: "document",
        section: "s1",
        x: 0,
        y: 0,
        w: 140,
        h: 80,
        text: "Review ITT & Evaluation Criteria",
      },
      {
        id: "bid",
        kind: "diamond",
        section: "s1",
        x: 0,
        y: 0,
        w: 140,
        h: 80,
        text: "Bid / No-Bid Go Decision?",
        color: "orange",
      },
      {
        id: "draft",
        kind: "rect",
        section: "s2",
        x: 0,
        y: 0,
        w: 140,
        h: 80,
        text: "Draft Evidence-Led Methodology",
        color: "green",
      },
      {
        id: "qa",
        kind: "cylinder",
        section: "s2",
        x: 0,
        y: 0,
        w: 140,
        h: 80,
        text: "Compliance Matrix & Red Team",
        color: "purple",
      },
      {
        id: "e1",
        kind: "arrow",
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        from: { item: "itt" },
        to: { item: "bid" },
      },
      {
        id: "e2",
        kind: "arrow",
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        text: "Approved",
        from: { item: "bid" },
        to: { item: "draft" },
      },
      {
        id: "e3",
        kind: "arrow",
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        from: { item: "draft" },
        to: { item: "qa" },
      },
    ];

    const laidOut = layoutBoardItems(messy, "right");
    const summary = inspectBoardLayout(laidOut);

    expect(summary.overlaps).toEqual([]);
    expect(summary.outsideSection).toEqual([]);
    expect(summary.arrowCrossings).toEqual([]);
  });

  it("arranges swimlane / retro columns cleanly side by side", () => {
    const retro: BoardItem[] = [
      {
        id: "went",
        kind: "section",
        x: 0,
        y: 0,
        w: 200,
        h: 200,
        text: "Went Well",
        color: "green",
      },
      {
        id: "pain",
        kind: "section",
        x: 0,
        y: 0,
        w: 200,
        h: 200,
        text: "Friction",
        color: "orange",
      },
      { id: "act", kind: "section", x: 0, y: 0, w: 200, h: 200, text: "Actions", color: "blue" },
      {
        id: "w1",
        kind: "sticky",
        section: "went",
        x: 0,
        y: 0,
        w: 180,
        h: 150,
        text: "Fast client sign-off",
      },
      {
        id: "w2",
        kind: "sticky",
        section: "went",
        x: 0,
        y: 0,
        w: 180,
        h: 150,
        text: "Reusable CV profiles",
      },
      {
        id: "p1",
        kind: "sticky",
        section: "pain",
        x: 0,
        y: 0,
        w: 180,
        h: 150,
        text: "Late fee sheet input",
      },
      {
        id: "a1",
        kind: "rect",
        section: "act",
        x: 0,
        y: 0,
        w: 180,
        h: 90,
        text: "Lock pricing 48h prior",
      },
    ];

    const laidOut = layoutBoardItems(retro, "lanes");
    const summary = inspectBoardLayout(laidOut);
    expect(summary.overlaps).toEqual([]);
    expect(summary.outsideSection).toEqual([]);

    const sWent = laidOut.find((i) => i.id === "went")!;
    const sPain = laidOut.find((i) => i.id === "pain")!;
    const sAct = laidOut.find((i) => i.id === "act")!;
    expect(sWent.y).toBe(sPain.y);
    expect(sPain.y).toBe(sAct.y);
    expect(sWent.h).toBe(sAct.h);
  });

  it("routes arrows around an obstacle sitting directly between two blocks", () => {
    const items: BoardItem[] = [
      { id: "a", kind: "rect", x: 40, y: 100, w: 160, h: 80, text: "Start" },
      { id: "mid", kind: "rect", x: 260, y: 90, w: 160, h: 100, text: "Blocker" },
      { id: "b", kind: "rect", x: 480, y: 100, w: 160, h: 80, text: "Finish" },
    ];
    const byId = new Map(items.map((item) => [item.id, item]));
    const pts = routeBoardArrow({ from: { item: "a" }, to: { item: "b" } }, byId, items);
    expect(pts).not.toBeNull();
    expect(pts!.length).toBe(4);
  });

  it("distinguishes valid section containment from overlaps, header clashes and spills", () => {
    const board: BoardItem[] = [
      { id: "outer", kind: "section", x: 40, y: 40, w: 640, h: 420, text: "Stage 1" },
      { id: "nested", kind: "section", x: 64, y: 110, w: 280, h: 280, text: "Sub-group" },
      { id: "good", kind: "rect", x: 84, y: 180, w: 200, h: 90, text: "Cleanly inside" },
      { id: "clashA", kind: "rect", x: 380, y: 180, w: 200, h: 90, text: "Block A" },
      {
        id: "clashB",
        kind: "sticky",
        x: 440,
        y: 210,
        w: 180,
        h: 150,
        text: "Intentional or accidental overlap",
      },
      { id: "hdrHit", kind: "rect", x: 380, y: 60, w: 200, h: 80, text: "Hits section header" },
      {
        id: "spill",
        kind: "rect",
        section: "outer",
        x: 560,
        y: 375,
        w: 200,
        h: 90,
        text: "Spills right and bottom",
      },
    ];
    const summary = inspectBoardLayout(board);
    expect(summary.containedInSection).toContain("section nested nested in outer");
    expect(summary.containedInSection).toContain("good in nested");
    expect(summary.overlaps).toHaveLength(1);
    expect(summary.overlaps[0]).toContain("clashA");
    expect(summary.overlaps[0]).toContain("clashB");
    expect(summary.headerClashes[0]).toContain("hdrHit");
    expect(summary.outsideSection[0]).toContain("spill");
    expect(summary.note).toMatch(/intentional/i);
  });

  it("separates parallel arrows, distributes ports, and prevents arrow labels from overlapping", () => {
    const dense: BoardItem[] = [
      { id: "hub", kind: "diamond", x: 60, y: 180, w: 220, h: 140, text: "Design Review Gate?" },
      { id: "t1", kind: "rect", x: 460, y: 60, w: 210, h: 90, text: "Approve Civil Package" },
      { id: "t2", kind: "rect", x: 460, y: 205, w: 210, h: 90, text: "Request BIM Revision" },
      { id: "t3", kind: "rect", x: 460, y: 350, w: 210, h: 90, text: "Escalate Ground Risk" },
      {
        id: "e1",
        kind: "arrow",
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        text: "Approved — Issue IFC",
        from: { item: "hub" },
        to: { item: "t1" },
      },
      {
        id: "e2",
        kind: "arrow",
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        text: "Minor Clash — Revise",
        from: { item: "hub" },
        to: { item: "t2" },
      },
      {
        id: "e3",
        kind: "arrow",
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        text: "Hold — Director Sign-Off",
        from: { item: "hub" },
        to: { item: "t3" },
      },
    ];
    const summary = inspectBoardLayout(dense);
    expect(summary.arrowCrossings).toEqual([]);
    expect(summary.labelClashes).toEqual([]);
  });
});
