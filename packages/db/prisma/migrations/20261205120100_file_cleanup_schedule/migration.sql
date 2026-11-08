-- When scheduled file cleanup last ran, what it removed, and a pending "run now" request.
ALTER TABLE "deployment_settings" ADD COLUMN "fileCleanupLastRunAt" TIMESTAMP(3);
ALTER TABLE "deployment_settings" ADD COLUMN "fileCleanupLastResult" JSONB;
ALTER TABLE "deployment_settings" ADD COLUMN "fileCleanupRequestedAt" TIMESTAMP(3);
