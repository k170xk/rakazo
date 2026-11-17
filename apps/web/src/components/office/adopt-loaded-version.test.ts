import { expect, it } from "vitest";
import { adoptLoadedVersion } from "./adopt-loaded-version";

const detail = {
  latest: { artifactId: "a2", version: 2 },
  name: "Plan.docx",
  versions: [
    {
      artifactId: "a1",
      version: 1,
      size: 1,
      createdAt: "2026-11-14T12:00:00.000Z",
      source: "assistant" as const,
    },
    {
      artifactId: "a2",
      version: 2,
      size: 1,
      createdAt: "2026-11-14T12:01:00.000Z",
      source: "assistant" as const,
    },
  ],
};

it("adopts when the load turn is still current", () => {
  const latest = { current: { artifactId: "a1", version: 1, name: "Plan.docx", versions: [] } };
  const adopted = adoptLoadedVersion(latest, 3, (turn) => turn === 3, detail);
  expect(adopted?.version).toBe(2);
  expect(latest.current?.version).toBe(2);
  expect(latest.current?.artifactId).toBe("a2");
});

it("leaves the pointer alone when a newer load aborted this turn", () => {
  const latest = {
    current: {
      artifactId: "a1",
      version: 1,
      name: "Plan.docx",
      versions: detail.versions.slice(0, 1),
    },
  };
  expect(adoptLoadedVersion(latest, 1, () => false, detail)).toBeNull();
  expect(latest.current?.version).toBe(1);
  expect(latest.current?.artifactId).toBe("a1");
});
