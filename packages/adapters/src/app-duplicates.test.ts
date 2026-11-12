import { describe, expect, it } from "vitest";
import type { CatalogueApp } from "./app-duplicates.js";
import { rankSimilar, similarAppNote, similarity, words } from "./app-duplicates.js";

const app = (name: string, extra: Partial<CatalogueApp> = {}): CatalogueApp => ({
  slug: name.toLowerCase().replace(/\W+/g, "-"),
  name,
  description: null,
  brief: null,
  state: "library",
  mine: false,
  url: null,
  creator: {
    name: "Joe Bloggs",
    email: null,
    role: "Engineer",
    discipline: "Civil",
    office: "Cork",
  },
  ...extra,
});

describe("duplicate app check", () => {
  it("keeps the meaningful words, lightly stemmed", () => {
    expect([...words("An app that tracks Site Inspections and defects")]).toEqual([
      "site",
      "inspection",
      "defect",
    ]);
  });

  it("finds an app for the same job and ignores unrelated ones", () => {
    const planned = {
      title: "Timesheet tracker",
      brief: "Staff log their weekly hours against job numbers.",
    };
    const ranked = rankSimilar(planned, [
      app("Weekly timesheets", { brief: "Log hours worked against each job number every week." }),
      app("Fleet register", { brief: "Company vans, MOT dates and drivers." }),
      app("Tender pipeline", { brief: "Bids, deadlines and win rates." }),
    ]);
    expect(ranked.map((entry) => entry.name)).toEqual(["Weekly timesheets"]);
  });

  it("never counts the person's own apps", () => {
    const planned = { title: "Site inspections", brief: null };
    expect(rankSimilar(planned, [app("Site inspections", { mine: true })])).toEqual([]);
    expect(similarity(planned, app("Site inspections"))).toBeGreaterThan(0.5);
  });

  it("names the creator so the person can ask them to share it", () => {
    const [found] = rankSimilar({ title: "Site inspections" }, [
      app("Site inspection log", { url: "https://evolve.example/plugins/site-inspection-log" }),
    ]);
    expect(similarAppNote(found!)).toBe(
      'Joe Bloggs (Engineer, Cork) built "Site inspection log", which looks like the same use case; it is in the Evolve library (https://evolve.example/plugins/site-inspection-log). Check in with Joe to share it with you.',
    );
    const [inReview] = rankSimilar({ title: "Site inspections" }, [
      app("Site inspection log", { state: "in_review", creator: null }),
    ]);
    expect(similarAppNote(inReview!)).toContain("it is being reviewed for the Evolve library");
    expect(similarAppNote(inReview!)).toContain("Check in with its creator to share it");
  });
});
