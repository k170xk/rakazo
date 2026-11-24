-- Channel and category preferences. Older finish/help/takeover columns stay for the previous
-- release; new columns are backfilled from them where a mapping exists.
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "inApp" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "push" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "actionNeeded" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "updates" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "problems" BOOLEAN NOT NULL DEFAULT true;

UPDATE "notification_preferences"
SET
  "updates" = "finish",
  "actionNeeded" = ("help" OR "takeover"),
  "problems" = true;
