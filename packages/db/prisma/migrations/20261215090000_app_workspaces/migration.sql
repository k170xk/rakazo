-- An app can keep its data in workspaces (a bridge, a project, a client): each person sees only
-- the workspaces they belong to, while tables marked shared stay app-wide.
ALTER TABLE "pages" ADD COLUMN "workspaceLabel" TEXT;
ALTER TABLE "pages" ADD COLUMN "workspaceCreate" TEXT NOT NULL DEFAULT 'anyone';

CREATE TABLE "app_workspaces" (
  "id" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "app_workspaces_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "app_workspaces_pageId_name_key" ON "app_workspaces"("pageId", "name");
ALTER TABLE "app_workspaces" ADD CONSTRAINT "app_workspaces_pageId_fkey"
  FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "app_workspace_members" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "userId" TEXT,
  "role" TEXT NOT NULL DEFAULT 'member',
  "addedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "app_workspace_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "app_workspace_members_workspaceId_email_key"
  ON "app_workspace_members"("workspaceId", "email");
CREATE INDEX "app_workspace_members_pageId_userId_idx" ON "app_workspace_members"("pageId", "userId");
CREATE INDEX "app_workspace_members_pageId_email_idx" ON "app_workspace_members"("pageId", "email");
ALTER TABLE "app_workspace_members" ADD CONSTRAINT "app_workspace_members_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "app_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_workspace_members" ADD CONSTRAINT "app_workspace_members_pageId_fkey"
  FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "app_workspace_choices" (
  "id" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workspaceId" TEXT,
  "chosenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "app_workspace_choices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "app_workspace_choices_pageId_userId_key"
  ON "app_workspace_choices"("pageId", "userId");
ALTER TABLE "app_workspace_choices" ADD CONSTRAINT "app_workspace_choices_pageId_fkey"
  FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_workspace_choices" ADD CONSTRAINT "app_workspace_choices_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "app_workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "app_rows" ADD COLUMN "workspaceId" TEXT;
CREATE INDEX "app_rows_pageId_workspaceId_idx" ON "app_rows"("pageId", "workspaceId");
ALTER TABLE "app_rows" ADD CONSTRAINT "app_rows_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "app_workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "app_workspaces" ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_workspaces_tenant ON "app_workspaces"
  USING (EXISTS (
    SELECT 1 FROM "pages" p
    WHERE p."id" = "app_workspaces"."pageId"
      AND p."spaceId" = NULLIF(current_setting('app.space_id', true), '')
      AND p."userId" = NULLIF(current_setting('app.user_id', true), '')
  ));
CREATE POLICY app_workspaces_system ON "app_workspaces"
  USING ((SELECT app_rls_bypass()));

ALTER TABLE "app_workspace_members" ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_workspace_members_tenant ON "app_workspace_members"
  USING (EXISTS (
    SELECT 1 FROM "pages" p
    WHERE p."id" = "app_workspace_members"."pageId"
      AND p."spaceId" = NULLIF(current_setting('app.space_id', true), '')
      AND p."userId" = NULLIF(current_setting('app.user_id', true), '')
  ));
CREATE POLICY app_workspace_members_system ON "app_workspace_members"
  USING ((SELECT app_rls_bypass()));

ALTER TABLE "app_workspace_choices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_workspace_choices_tenant ON "app_workspace_choices"
  USING (EXISTS (
    SELECT 1 FROM "pages" p
    WHERE p."id" = "app_workspace_choices"."pageId"
      AND p."spaceId" = NULLIF(current_setting('app.space_id', true), '')
      AND p."userId" = NULLIF(current_setting('app.user_id', true), '')
  ));
CREATE POLICY app_workspace_choices_system ON "app_workspace_choices"
  USING ((SELECT app_rls_bypass()));
