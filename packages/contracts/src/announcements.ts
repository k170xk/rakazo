import * as z from "zod";

/** Screenshots are shrunk in the browser before upload, so this leaves room for a large one. */
export const ANNOUNCEMENT_IMAGE_MAX_CHARS = 3_000_000;
/** People who join later still see announcements from this far back. */
export const ANNOUNCEMENT_SHOWN_DAYS = 30;

const ImageDataUrl = z
  .string()
  .max(ANNOUNCEMENT_IMAGE_MAX_CHARS)
  .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/);

/** A company update an admin sent: shown to everyone as a dialog until they dismiss it. */
export const AnnouncementSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  /** A screenshot as a data URL, or null. */
  image: z.string().nullable(),
  /** Shows "Reload to update", for changes people only get after reloading the app. */
  offerReload: z.boolean(),
  createdAt: z.string(),
  authorName: z.string().nullable(),
});
export type Announcement = z.infer<typeof AnnouncementSchema>;

/** What admins see in Company admin: also who has dismissed it, and whether it was withdrawn. */
export const AdminAnnouncementSchema = AnnouncementSchema.extend({
  dismissedCount: z.number().int().nonnegative(),
  withdrawnAt: z.string().nullable(),
});
export type AdminAnnouncement = z.infer<typeof AdminAnnouncementSchema>;

export const AnnouncementInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(4000).default(""),
  image: ImageDataUrl.nullable().default(null),
  offerReload: z.boolean().default(true),
});
export type AnnouncementInput = z.infer<typeof AnnouncementInputSchema>;
