-- The app version people are shown while the assistant's newer saves still crash.
ALTER TABLE "pages" ADD COLUMN "goodVersion" INTEGER;
