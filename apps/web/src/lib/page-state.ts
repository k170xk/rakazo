import type { PageStateValues } from "@rakazo/contracts";
import {
  PAGE_STATE_KEY,
  SHARED_PAGE_PASSWORD_HEADER,
  SHARED_PAGE_PATH_PREFIX,
} from "@rakazo/contracts";
import type { SpaceQueries } from "./query";

/** Where a page's usePageState values are kept, for the frame showing it. */
export type PageStateStore = {
  read: () => Promise<{ values: PageStateValues; writable: boolean }>;
  write: (key: string, value: unknown) => Promise<boolean>;
};

/** The page's owner, through their own session. */
export function ownerPageState(queries: SpaceQueries, pageId: string): PageStateStore {
  return {
    read: async () => ({
      values: (await queries.pages.state.call({ pageId })).values,
      writable: true,
    }),
    write: (key, value) =>
      PAGE_STATE_KEY.test(key)
        ? queries.pages.saveState.call({ pageId, key, value }).then(
            () => true,
            () => false,
          )
        : Promise.resolve(false),
  };
}

/** A shared link: signed-in readers keep changes; a password reader only reads them. */
export function sharedPageState(token: string, password: string | null): PageStateStore {
  const url = `${SHARED_PAGE_PATH_PREFIX}${token}/state`;
  const headers: Record<string, string> = password
    ? { [SHARED_PAGE_PASSWORD_HEADER]: password }
    : {};
  return {
    read: async () => {
      const response = await fetch(url, {
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers,
      });
      if (!response.ok) return { values: {}, writable: false };
      const body = (await response.json()) as { values?: PageStateValues; writable?: boolean };
      return { values: body.values ?? {}, writable: body.writable === true };
    },
    write: async (key, value) => {
      if (!PAGE_STATE_KEY.test(key)) return false;
      const response = await fetch(url, {
        method: "PUT",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ key, value: value ?? null }),
      }).catch(() => null);
      return response?.ok === true;
    },
  };
}
