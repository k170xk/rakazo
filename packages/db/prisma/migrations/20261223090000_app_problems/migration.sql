CREATE TABLE "app_problems" (
  "id" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "message" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 1,
  "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUserId" TEXT,
  CONSTRAINT "app_problems_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "app_problems_pageId_key_key" ON "app_problems"("pageId", "key");
CREATE INDEX "app_problems_pageId_lastSeen_idx" ON "app_problems"("pageId", "lastSeen");
ALTER TABLE "app_problems" ADD CONSTRAINT "app_problems_pageId_fkey"
  FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "app_problems" ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_problems_tenant ON "app_problems"
  USING (EXISTS (
    SELECT 1 FROM "pages" p
    WHERE p."id" = "app_problems"."pageId"
      AND p."spaceId" = NULLIF(current_setting('app.space_id', true), '')
      AND p."userId" = NULLIF(current_setting('app.user_id', true), '')
  ));
CREATE POLICY app_problems_system ON "app_problems"
  USING ((SELECT app_rls_bypass()));
