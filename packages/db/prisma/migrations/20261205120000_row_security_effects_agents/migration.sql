-- Row-level security for the remaining tables that hold what a person's bots did or kept:
-- tool requests and results, cloud agent prompts, Evolve chat links and pinned files.
-- Space-owned rows follow the Space set by the app; person-owned rows follow the user.

ALTER TABLE "external_effects" ENABLE ROW LEVEL SECURITY;
CREATE POLICY external_effects_tenant ON "external_effects"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY external_effects_system ON "external_effects"
  USING ((SELECT app_rls_bypass()));

ALTER TABLE "cloud_agents" ENABLE ROW LEVEL SECURITY;
CREATE POLICY cloud_agents_tenant ON "cloud_agents"
  USING ("spaceId" = NULLIF(current_setting('app.space_id', true), ''));
CREATE POLICY cloud_agents_system ON "cloud_agents"
  USING ((SELECT app_rls_bypass()));

ALTER TABLE "evolve_conversation_links" ENABLE ROW LEVEL SECURITY;
CREATE POLICY evolve_conversation_links_tenant ON "evolve_conversation_links"
  USING ("userId" = NULLIF(current_setting('app.user_id', true), ''));
CREATE POLICY evolve_conversation_links_system ON "evolve_conversation_links"
  USING ((SELECT app_rls_bypass()));

ALTER TABLE "kept_files" ENABLE ROW LEVEL SECURITY;
CREATE POLICY kept_files_tenant ON "kept_files"
  USING ("userId" = NULLIF(current_setting('app.user_id', true), ''));
CREATE POLICY kept_files_system ON "kept_files"
  USING ((SELECT app_rls_bypass()));
