import { describe, expect, it, vi } from "vitest";
import { evolveProfileActive } from "./evolve-directory.js";
import { evolveLeaverSweep } from "./evolve-leavers.js";

const HOUR = 60 * 60 * 1000;

function fakeDb(emails: string[]) {
  const offboarded: string[] = [];
  const db = {
    user: {
      findMany: async () => emails.map((email, index) => ({ id: `u${index}`, email })),
    },
    connection: {
      findMany: async () => [{ id: "c1", secretId: "s1" }],
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    secret: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    session: {
      deleteMany: vi.fn(async ({ where }: { where: { userId: string } }) => {
        offboarded.push(where.userId);
        return { count: 1 };
      }),
    },
    routine: { updateMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return { db, offboarded };
}

function sweepWith(emails: string[], active: (email: string) => Promise<boolean>) {
  const { db, offboarded } = fakeDb(emails);
  let clock = 0;
  const sweep = evolveLeaverSweep({
    prisma: db as never,
    isActive: active,
    now: () => clock,
  });
  const signal = new AbortController().signal;
  return {
    offboarded,
    db,
    at: async (hours: number) => {
      clock = hours * HOUR;
      await sweep(signal);
    },
  };
}

const staff = [
  "a@ocsc.co.uk",
  "b@ocsc.ie",
  "c@ocsc.co.uk",
  "d@ocsc.ie",
  "e@ocsc.co.uk",
  "f@ocsc.ie",
];

describe("evolveLeaverSweep", () => {
  it("offboards only after two misses at least 20 hours apart", async () => {
    const run = sweepWith(staff, async (email) => email !== "c@ocsc.co.uk");
    await run.at(0);
    expect(run.offboarded).toEqual([]);
    await run.at(13);
    expect(run.offboarded).toEqual([]);
    await run.at(26);
    expect(run.offboarded).toEqual(["u2"]);
    expect(run.db.secret.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["s1"] }, userId: "u2" },
    });
    expect(run.db.routine.updateMany).toHaveBeenCalledWith({
      where: { userId: "u2", active: true },
      data: { active: false },
    });
  });

  it("forgets a miss when the person appears again", async () => {
    let present = false;
    const run = sweepWith(staff, async (email) => email !== "c@ocsc.co.uk" || present);
    await run.at(0);
    present = true;
    await run.at(13);
    present = false;
    await run.at(26);
    await run.at(39);
    expect(run.offboarded).toEqual([]);
  });

  it("does nothing when the directory cannot answer", async () => {
    const run = sweepWith(staff, async (email) => {
      if (email === "d@ocsc.ie") throw new Error("Evolve directory answered 503");
      return email !== "c@ocsc.co.uk";
    });
    await expect(run.at(0)).rejects.toThrow("503");
    await expect(run.at(30)).rejects.toThrow("503");
    expect(run.offboarded).toEqual([]);
  });

  it("stops instead of removing many people at once", async () => {
    const run = sweepWith(staff, async (email) => email.startsWith("a@"));
    await run.at(0);
    await run.at(24);
    expect(run.offboarded).toEqual([]);
  });

  it("never looks up or removes people outside OCSC", async () => {
    const isActive = vi.fn(async () => false);
    const run = sweepWith(["guest@example.com", "a@ocsc.co.uk"], isActive);
    await run.at(0);
    expect(isActive).toHaveBeenCalledTimes(1);
    expect(isActive).toHaveBeenCalledWith("a@ocsc.co.uk");
  });

  it("waits between passes", async () => {
    const isActive = vi.fn(async () => true);
    const run = sweepWith(staff, isActive);
    await run.at(0);
    await run.at(5);
    expect(isActive).toHaveBeenCalledTimes(staff.length);
  });
});

describe("evolveProfileActive", () => {
  const reply = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("needs an exact email match", async () => {
    const fetch = reply({ profiles: [{ email: "Ann.Smith@ocsc.co.uk" }] });
    await expect(
      evolveProfileActive({ secret: "s", url: undefined, email: "ann.smith@ocsc.co.uk", fetch }),
    ).resolves.toBe(true);
    await expect(
      evolveProfileActive({ secret: "s", url: undefined, email: "ann@ocsc.co.uk", fetch }),
    ).resolves.toBe(false);
  });

  it("throws rather than reporting a leaver when Evolve fails", async () => {
    await expect(
      evolveProfileActive({
        secret: "s",
        url: undefined,
        email: "a@ocsc.ie",
        fetch: reply({}, 500),
      }),
    ).rejects.toThrow();
    await expect(
      evolveProfileActive({ secret: "s", url: undefined, email: "a@ocsc.ie", fetch: reply({}) }),
    ).rejects.toThrow();
  });
});
