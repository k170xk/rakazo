import type { RealtimeFanout } from "@rakazo/adapter-kit";

/** One company-wide topic: every open app hears each announcement an admin sends. */
export const ANNOUNCEMENTS_TOPIC = "company-announcements";

export async function publishAnnouncement(realtime: RealtimeFanout | undefined, id: string) {
  await realtime?.publish(ANNOUNCEMENTS_TOPIC, id);
}

/**
 * The ids of announcements sent while following. Transient: one sent while the app is closed is
 * picked up by the app's own list when it next opens. A failed subscribe ends the stream with
 * that error, so the app reconnects.
 */
export async function* followAnnouncements(
  realtime: RealtimeFanout | undefined,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const queue: string[] = [];
  let wake: (() => void) | undefined;
  const unsubscribe = realtime
    ? await realtime.subscribe(ANNOUNCEMENTS_TOPIC, (payload) => {
        if (!payload || queue.length >= 20) return;
        queue.push(payload);
        wake?.();
      })
    : async () => {};
  try {
    while (!signal?.aborted) {
      const next = queue.shift();
      if (next) {
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => {
        const done = () => {
          wake = undefined;
          signal?.removeEventListener("abort", done);
          resolve();
        };
        wake = done;
        signal?.addEventListener("abort", done, { once: true });
        if (signal?.aborted) done();
      });
    }
  } finally {
    wake = undefined;
    await unsubscribe();
  }
}
