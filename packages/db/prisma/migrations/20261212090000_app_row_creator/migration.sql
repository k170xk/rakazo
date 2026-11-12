-- Additive: an app row remembers who added it, so contribute apps let people change only their own rows.
ALTER TABLE "app_rows" ADD COLUMN "createdBy" TEXT;
