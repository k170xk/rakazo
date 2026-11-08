-- Built-in skills and company tools an admin switched off for every account.
ALTER TABLE "deployment_settings" ADD COLUMN "companyTools" JSONB NOT NULL DEFAULT '{}';
