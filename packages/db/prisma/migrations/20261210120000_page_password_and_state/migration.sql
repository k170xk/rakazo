-- Additive: older releases never read these columns or this table.
ALTER TABLE "pages" ADD COLUMN "sharePasswordHash" TEXT;
ALTER TABLE "pages" ADD COLUMN "sharePasswordSecretId" TEXT;

CREATE UNIQUE INDEX "pages_sharePasswordSecretId_key" ON "pages"("sharePasswordSecretId");

ALTER TABLE "pages" ADD CONSTRAINT "pages_sharePasswordSecretId_fkey" FOREIGN KEY ("sharePasswordSecretId") REFERENCES "secrets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- What a page saves for itself (ticks, entries, choices), shared by everyone who opens it.
CREATE TABLE "page_state" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,

    CONSTRAINT "page_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "page_state_pageId_key_key" ON "page_state"("pageId", "key");

ALTER TABLE "page_state" ADD CONSTRAINT "page_state_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The owner reads and writes as themselves; shared viewers go through named system reads.
ALTER TABLE "page_state" ENABLE ROW LEVEL SECURITY;
CREATE POLICY page_state_tenant ON "page_state"
  USING (EXISTS (
    SELECT 1 FROM "pages" p
    WHERE p."id" = "page_state"."pageId"
      AND p."spaceId" = NULLIF(current_setting('app.space_id', true), '')
      AND p."userId" = NULLIF(current_setting('app.user_id', true), '')
  ));
CREATE POLICY page_state_system ON "page_state"
  USING ((SELECT app_rls_bypass()));
