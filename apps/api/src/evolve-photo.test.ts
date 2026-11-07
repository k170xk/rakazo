import { beforeEach, describe, expect, it, vi } from "vitest";

const readEvolveOwnProfile = vi.fn();
vi.mock("@rakazo/adapters", () => ({ readEvolveOwnProfile }));

const { resetEvolvePhotoChecks, syncEvolvePhoto } = await import("./evolve-photo.js");

const EVOLVE = "https://evolve.example.supabase.co";
const connection = { url: `${EVOLVE}/functions/v1/plugin-builder`, secret: "s" };

function deps() {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  return {
    updateMany,
    deps: { evolvePlugins: connection, prisma: { user: { updateMany } } } as never,
  };
}

describe("syncEvolvePhoto", () => {
  beforeEach(() => {
    resetEvolvePhotoChecks();
    readEvolveOwnProfile.mockReset();
  });

  it("sets the Evolve photo on an account without one", async () => {
    readEvolveOwnProfile.mockResolvedValue({ name: "Keith", photo: `${EVOLVE}/storage/me.jpg` });
    const { deps: d, updateMany } = deps();
    await syncEvolvePhoto(d, { id: "u1", email: "k@ocsc.co.uk", image: null });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "u1", image: null },
      data: { image: `${EVOLVE}/storage/me.jpg` },
    });
  });

  it("replaces an older Evolve photo", async () => {
    readEvolveOwnProfile.mockResolvedValue({ name: null, photo: `${EVOLVE}/storage/new.jpg` });
    const { deps: d, updateMany } = deps();
    await syncEvolvePhoto(d, {
      id: "u2",
      email: "k@ocsc.co.uk",
      image: `${EVOLVE}/storage/old.jpg`,
    });
    expect(updateMany).toHaveBeenCalledOnce();
  });

  it("leaves a picture the person chose elsewhere", async () => {
    const { deps: d, updateMany } = deps();
    await syncEvolvePhoto(d, {
      id: "u3",
      email: "k@ocsc.co.uk",
      image: "https://cdn.other/me.png",
    });
    expect(readEvolveOwnProfile).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("asks Evolve at most once in six hours per person, and survives Evolve errors", async () => {
    readEvolveOwnProfile.mockRejectedValue(new Error("down"));
    const { deps: d } = deps();
    const user = { id: "u4", email: "k@ocsc.co.uk", image: null };
    await syncEvolvePhoto(d, user, 0);
    await syncEvolvePhoto(d, user, 60_000);
    expect(readEvolveOwnProfile).toHaveBeenCalledOnce();
    await syncEvolvePhoto(d, user, 7 * 60 * 60 * 1000);
    expect(readEvolveOwnProfile).toHaveBeenCalledTimes(2);
  });
});
