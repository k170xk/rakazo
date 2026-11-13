-- The assistant run behind each app version and data change, and a company admin's freeze switch
-- that takes a shared or published app offline without touching its owner's copy.
ALTER TABLE "page_versions" ADD COLUMN "runId" TEXT;
ALTER TABLE "app_data_changes" ADD COLUMN "runId" TEXT;
ALTER TABLE "pages" ADD COLUMN "frozenAt" TIMESTAMP(3);
ALTER TABLE "pages" ADD COLUMN "frozenBy" TEXT;
