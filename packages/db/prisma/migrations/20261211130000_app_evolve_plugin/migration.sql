-- Additive: an app published to Evolve remembers its plugin slug, one app per slug.
ALTER TABLE "pages" ADD COLUMN "evolvePluginSlug" TEXT;
ALTER TABLE "pages" ADD COLUMN "evolvePluginRelease" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "pages_evolvePluginSlug_key" ON "pages"("evolvePluginSlug");
