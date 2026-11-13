-- Open apps fetch only what changed. Each row write is stamped with the revision its transaction
-- will move the app to, and each removed row leaves a short-lived note, so a copy at revision N
-- asks for rows above N and removals above N instead of every row. Locking the page row on the
-- first write keeps revisions in commit order, so a reader never skips a slower transaction.
ALTER TABLE "app_rows" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "app_rows_pageId_revision_idx" ON "app_rows"("pageId", "revision");

CREATE TABLE "app_row_removals" (
    "id" BIGSERIAL NOT NULL,
    "pageId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_row_removals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "app_row_removals_pageId_revision_idx" ON "app_row_removals"("pageId", "revision");
ALTER TABLE "app_row_removals" ADD CONSTRAINT "app_row_removals_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Writers move the revision once, at the end of their transaction, so the rows they write now
-- belong to the revision after the current one.
CREATE FUNCTION app_rows_stamp() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  SELECT "dataRevision" + 1 INTO NEW."revision" FROM "pages" WHERE "id" = NEW."pageId" FOR UPDATE;
  NEW."revision" := COALESCE(NEW."revision", 0);
  RETURN NEW;
END $$;
CREATE TRIGGER app_rows_stamp BEFORE INSERT OR UPDATE ON "app_rows" FOR EACH ROW EXECUTE FUNCTION app_rows_stamp();

-- A row removed with its whole app leaves nothing behind: the page is already gone.
CREATE FUNCTION app_rows_removed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  next_revision INTEGER;
BEGIN
  SELECT "dataRevision" + 1 INTO next_revision FROM "pages" WHERE "id" = OLD."pageId" FOR UPDATE;
  IF next_revision IS NOT NULL THEN
    INSERT INTO "app_row_removals" ("pageId", "tableId", "rowId", "revision")
    VALUES (OLD."pageId", OLD."tableId", OLD."id", next_revision);
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER app_rows_removed AFTER DELETE ON "app_rows" FOR EACH ROW EXECUTE FUNCTION app_rows_removed();

-- Who has an app open: refreshed every few seconds while they look, read for the avatars.
CREATE TABLE "app_presence" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "focus" JSONB,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_presence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "app_presence_pageId_userId_key" ON "app_presence"("pageId", "userId");
CREATE INDEX "app_presence_pageId_seenAt_idx" ON "app_presence"("pageId", "seenAt");
ALTER TABLE "app_presence" ADD CONSTRAINT "app_presence_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Conversations on a row. They outlive the row, so undoing its removal brings them back too.
CREATE TABLE "app_comments" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "table" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "userId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_comments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "app_comments_pageId_table_rowId_idx" ON "app_comments"("pageId", "table", "rowId");
ALTER TABLE "app_comments" ADD CONSTRAINT "app_comments_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- As app_rows: the owner reads and writes as themselves; everyone else goes through system calls
-- that check the link, password, sign-in or Evolve first.
ALTER TABLE "app_row_removals" ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_row_removals_tenant ON "app_row_removals"
  USING (EXISTS (
    SELECT 1 FROM "pages" p
    WHERE p."id" = "app_row_removals"."pageId"
      AND p."spaceId" = NULLIF(current_setting('app.space_id', true), '')
      AND p."userId" = NULLIF(current_setting('app.user_id', true), '')
  ));
CREATE POLICY app_row_removals_system ON "app_row_removals"
  USING ((SELECT app_rls_bypass()));

ALTER TABLE "app_presence" ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_presence_tenant ON "app_presence"
  USING (EXISTS (
    SELECT 1 FROM "pages" p
    WHERE p."id" = "app_presence"."pageId"
      AND p."spaceId" = NULLIF(current_setting('app.space_id', true), '')
      AND p."userId" = NULLIF(current_setting('app.user_id', true), '')
  ));
CREATE POLICY app_presence_system ON "app_presence"
  USING ((SELECT app_rls_bypass()));

ALTER TABLE "app_comments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_comments_tenant ON "app_comments"
  USING (EXISTS (
    SELECT 1 FROM "pages" p
    WHERE p."id" = "app_comments"."pageId"
      AND p."spaceId" = NULLIF(current_setting('app.space_id', true), '')
      AND p."userId" = NULLIF(current_setting('app.user_id', true), '')
  ));
CREATE POLICY app_comments_system ON "app_comments"
  USING ((SELECT app_rls_bypass()));
