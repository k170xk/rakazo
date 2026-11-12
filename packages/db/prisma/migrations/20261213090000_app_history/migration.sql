-- Who saved each app version and how, so the Studio's history can say so.
ALTER TABLE "page_versions" ADD COLUMN "authorId" TEXT;
ALTER TABLE "page_versions" ADD COLUMN "via" TEXT;
ALTER TABLE "page_versions" ADD COLUMN "restoredFrom" INTEGER;

-- Every change to an app's data, so the owner can see it and undo it.
CREATE TABLE "app_data_changes" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "table" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "rowId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "summary" TEXT NOT NULL,
    "userId" TEXT,
    "via" TEXT,
    "undoneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_data_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "app_data_changes_pageId_createdAt_idx" ON "app_data_changes"("pageId", "createdAt");

ALTER TABLE "app_data_changes" ADD CONSTRAINT "app_data_changes_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- As app_rows: the owner reads and writes as themselves; other writers go through system calls.
ALTER TABLE "app_data_changes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_data_changes_tenant ON "app_data_changes"
  USING (EXISTS (
    SELECT 1 FROM "pages" p
    WHERE p."id" = "app_data_changes"."pageId"
      AND p."spaceId" = NULLIF(current_setting('app.space_id', true), '')
      AND p."userId" = NULLIF(current_setting('app.user_id', true), '')
  ));
CREATE POLICY app_data_changes_system ON "app_data_changes"
  USING ((SELECT app_rls_bypass()));
