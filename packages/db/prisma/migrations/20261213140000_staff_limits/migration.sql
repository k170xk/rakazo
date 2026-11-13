-- Additive: older releases never read these columns or this table, and nulls follow company limits.
ALTER TABLE "user" ADD COLUMN "routineRunsPerDay" INTEGER;
ALTER TABLE "user" ADD COLUMN "maxActiveRoutines" INTEGER;
ALTER TABLE "user" ADD COLUMN "monthlyBudgetUsd" DOUBLE PRECISION;
ALTER TABLE "user" ADD COLUMN "modelAccess" TEXT;
ALTER TABLE "user" ADD COLUMN "allowedModels" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "deployment_settings" ADD COLUMN "staffLimits" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "routine_firings" (
    "id" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routine_firings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "routine_firings_routineId_firedAt_idx" ON "routine_firings"("routineId", "firedAt");
CREATE INDEX "routine_firings_userId_firedAt_idx" ON "routine_firings"("userId", "firedAt");

-- Only the scheduler, inbound delivery and admin reports touch it, all through system reads.
ALTER TABLE "routine_firings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY routine_firings_system ON "routine_firings"
  USING ((SELECT app_rls_bypass()));

-- Every routine ever created, by any path, kept after the routine is deleted for the admin
-- dashboard. Filled by trigger so app code cannot forget it; existing routines are backfilled.
CREATE TABLE "routine_creations" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "routineId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routine_creations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "routine_creations_routineId_key" ON "routine_creations"("routineId");
CREATE INDEX "routine_creations_createdAt_idx" ON "routine_creations"("createdAt");

ALTER TABLE "routine_creations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY routine_creations_system ON "routine_creations"
  USING ((SELECT app_rls_bypass()));

INSERT INTO "routine_creations" ("routineId", "userId", "createdAt")
SELECT "id", "userId", "createdAt" FROM "routines";

CREATE FUNCTION routine_creation_log() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 INSERT INTO public.routine_creations("routineId","userId","createdAt")
 VALUES (NEW.id, NEW."userId", NEW."createdAt")
 ON CONFLICT ("routineId") DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER routine_creation_log AFTER INSERT ON "routines" FOR EACH ROW EXECUTE FUNCTION routine_creation_log();
