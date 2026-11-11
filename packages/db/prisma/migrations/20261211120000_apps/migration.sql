-- Additive: older releases never read these columns or tables, and every page stays a "page".
ALTER TABLE "pages" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'page';
ALTER TABLE "pages" ADD COLUMN "dataRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "pages" ADD COLUMN "dataAccess" TEXT NOT NULL DEFAULT 'owner';

CREATE TABLE "app_tables" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "schema" JSONB NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_tables_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "app_rows" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,

    CONSTRAINT "app_rows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "app_assets" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "app_tables_pageId_name_key" ON "app_tables"("pageId", "name");
CREATE INDEX "app_rows_tableId_position_idx" ON "app_rows"("tableId", "position");
CREATE INDEX "app_rows_pageId_idx" ON "app_rows"("pageId");
CREATE INDEX "app_assets_pageId_idx" ON "app_assets"("pageId");

ALTER TABLE "app_tables" ADD CONSTRAINT "app_tables_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_rows" ADD CONSTRAINT "app_rows_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_rows" ADD CONSTRAINT "app_rows_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "app_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_assets" ADD CONSTRAINT "app_assets_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The owner reads and writes as themselves; colleagues and link readers go through named system
-- calls that check the link, password or sign-in first.
ALTER TABLE "app_tables" ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_tables_tenant ON "app_tables"
  USING (EXISTS (
    SELECT 1 FROM "pages" p
    WHERE p."id" = "app_tables"."pageId"
      AND p."spaceId" = NULLIF(current_setting('app.space_id', true), '')
      AND p."userId" = NULLIF(current_setting('app.user_id', true), '')
  ));
CREATE POLICY app_tables_system ON "app_tables"
  USING ((SELECT app_rls_bypass()));

ALTER TABLE "app_rows" ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_rows_tenant ON "app_rows"
  USING (EXISTS (
    SELECT 1 FROM "pages" p
    WHERE p."id" = "app_rows"."pageId"
      AND p."spaceId" = NULLIF(current_setting('app.space_id', true), '')
      AND p."userId" = NULLIF(current_setting('app.user_id', true), '')
  ));
CREATE POLICY app_rows_system ON "app_rows"
  USING ((SELECT app_rls_bypass()));

ALTER TABLE "app_assets" ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_assets_tenant ON "app_assets"
  USING (EXISTS (
    SELECT 1 FROM "pages" p
    WHERE p."id" = "app_assets"."pageId"
      AND p."spaceId" = NULLIF(current_setting('app.space_id', true), '')
      AND p."userId" = NULLIF(current_setting('app.user_id', true), '')
  ));
CREATE POLICY app_assets_system ON "app_assets"
  USING ((SELECT app_rls_bypass()));
