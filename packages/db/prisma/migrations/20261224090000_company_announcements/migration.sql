CREATE TABLE "company_announcements" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL DEFAULT '',
  "image" TEXT,
  "offerReload" BOOLEAN NOT NULL DEFAULT true,
  "authorId" TEXT,
  "authorName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "withdrawnAt" TIMESTAMP(3),
  CONSTRAINT "company_announcements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "company_announcements_createdAt_idx" ON "company_announcements"("createdAt");

CREATE TABLE "announcement_dismissals" (
  "announcementId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "announcement_dismissals_pkey" PRIMARY KEY ("announcementId", "userId")
);

CREATE INDEX "announcement_dismissals_userId_idx" ON "announcement_dismissals"("userId");
ALTER TABLE "announcement_dismissals" ADD CONSTRAINT "announcement_dismissals_announcementId_fkey"
  FOREIGN KEY ("announcementId") REFERENCES "company_announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "announcement_dismissals" ADD CONSTRAINT "announcement_dismissals_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "company_announcements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_announcements_system ON "company_announcements"
  USING ((SELECT app_rls_bypass()));

ALTER TABLE "announcement_dismissals" ENABLE ROW LEVEL SECURITY;
CREATE POLICY announcement_dismissals_system ON "announcement_dismissals"
  USING ((SELECT app_rls_bypass()));
