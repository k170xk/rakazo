-- Company-wide feature switches and when the company model last changed, both set by an admin.
ALTER TABLE "deployment_settings" ADD COLUMN "companyFeatures" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "deployment_settings" ADD COLUMN "companyModelUpdatedAt" TIMESTAMP(3);
