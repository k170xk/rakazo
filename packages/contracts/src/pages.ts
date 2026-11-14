import * as z from "zod";
import { Id, IsoDate } from "./ids.js";

export const PAGE_TITLE_MAX_LENGTH = 200;
export const PAGE_LIST_MAX_LIMIT = 60;
/** The most UTF-8 a page's source may be, wherever it comes from: a save or an import. */
export const PAGE_SOURCE_MAX_BYTES = 256 * 1024;

export function pageSourceBytes(source: string): number {
  return new TextEncoder().encode(source).byteLength;
}

/** Page source as stored: bounded before anything parses or compiles it. */
export const PageSourceSchema = z
  .string()
  // A string longer in UTF-16 than the limit is over it in UTF-8 too; skip encoding it.
  .max(PAGE_SOURCE_MAX_BYTES, { abort: true })
  .refine(
    (source) => pageSourceBytes(source) <= PAGE_SOURCE_MAX_BYTES,
    `Page source must fit within ${PAGE_SOURCE_MAX_BYTES} UTF-8 bytes`,
  );

/** "link" opens for people signed in to this company; "public" for anyone with the password too. */
export const PageVisibilitySchema = z.enum(["private", "link", "public"]);
export type PageVisibility = z.infer<typeof PageVisibilitySchema>;

/** A page anyone holding its link can open, signed in or with its password. */
export function pageIsShared(visibility: PageVisibility): boolean {
  return visibility !== "private";
}

/**
 * A page title is one line: control characters and line breaks fold into single spaces, since
 * the title sits in pills, chips and `[title](page:id)` links that a break would cut.
 */
export const PageTitleSchema = z
  .string()
  .transform((title) => title.replace(/[\p{Cc}\u2028\u2029\s]+/gu, " ").trim())
  .pipe(z.string().min(1).max(PAGE_TITLE_MAX_LENGTH));

/** A page is one JSX file; an app is a set of files; a whiteboard is a board of shapes stored as JSON. */
export const PageKindSchema = z.enum(["page", "app", "whiteboard"]);
export type PageKind = z.infer<typeof PageKindSchema>;

/** Unknown stored values stay pages, so a future kind does not fail a read from this release. */
export function shownPageKind(kind: string): PageKind {
  return kind === "app" || kind === "whiteboard" ? kind : "page";
}

export const PageSummarySchema = z.strictObject({
  id: Id,
  title: z.string().max(PAGE_TITLE_MAX_LENGTH),
  kind: PageKindSchema,
  botId: Id.nullable(),
  groupId: Id.nullable(),
  visibility: PageVisibilitySchema,
  currentVersion: z.number().int().positive(),
  pinned: z.boolean(),
  /** An app's generated icon (an asset id), once drawn. */
  icon: Id.nullable().optional(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type PageSummary = z.infer<typeof PageSummarySchema>;

export const PageDetailSchema = z.strictObject({
  ...PageSummarySchema.shape,
  /** The version shown; `currentVersion` is the newest. */
  version: z.number().int().positive(),
  /** The version's source compiled for the viewer, which carries no compiler. */
  code: z.string(),
  owner: z.strictObject({ name: z.string(), image: z.string().nullable() }),
  /** Set while anyone with the link can open the page. */
  shareUrl: z.string().nullable(),
  /** Set while the link is open to anyone, who must type it. */
  sharePassword: z.string().nullable(),
});
export type PageDetail = z.infer<typeof PageDetailSchema>;

/** What anyone with a page's link reads; no owner, bot or ids. */
export const SharedPageSchema = z.strictObject({
  title: z.string().max(PAGE_TITLE_MAX_LENGTH),
  kind: PageKindSchema,
  /** Compiled for the viewer, as in PageDetail. */
  code: z.string(),
  version: z.number().int().positive(),
  updatedAt: IsoDate,
  /** Whether this reader may save the page's own data; a password reader only reads it. */
  canSaveState: z.boolean(),
  /** For an app: whether this reader may add, change and remove its rows. */
  canEditData: z.boolean(),
});
export type SharedPage = z.infer<typeof SharedPageSchema>;

/** 32 random bytes as base64url. */
const PAGE_SHARE_TOKEN_LENGTH = 43;

export const SHARED_PAGE_PATH_PREFIX = "/api/v1/pages/shared/";
/** The header a password reader sends with each shared page request. */
export const SHARED_PAGE_PASSWORD_HEADER = "x-page-password";

/** `<web origin>/p/<title slug>-<token>`; the token is the last 43 characters. */
export function pageShareUrl(webOrigin: string, title: string, token: string): string {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return new URL(`/p/${slug ? `${slug}-` : ""}${token}`, webOrigin).href;
}

/** The token at the end of a share URL path segment, or null when it cannot hold one. */
export function pageShareTokenFromSlug(segment: string): string | null {
  const token = segment.slice(-PAGE_SHARE_TOKEN_LENGTH);
  return token.length === PAGE_SHARE_TOKEN_LENGTH && /^[A-Za-z0-9_-]+$/.test(token) ? token : null;
}

/** What a page keeps for itself (usePageState): one JSON value per key, shared by its readers. */
export const PAGE_STATE_KEY = /^[A-Za-z0-9_.:-]{1,64}$/;
export const PAGE_STATE_MAX_BYTES = 64_000;
export const PAGE_STATE_MAX_KEYS = 200;
export const PageStateKeySchema = z.string().regex(PAGE_STATE_KEY);
export const PageStateValuesSchema = z.record(z.string(), z.unknown());
export type PageStateValues = z.infer<typeof PageStateValuesSchema>;
/** A null value forgets the key. */
export const PageStateWriteSchema = z.strictObject({
  key: PageStateKeySchema,
  value: z.unknown(),
});
