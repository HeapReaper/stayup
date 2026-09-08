-- AlterTable
--
-- Plain ADD COLUMNs rather than the table rebuild Prisma normally emits for
-- SQLite: every new column is either nullable or has a constant default, which
-- is exactly the case SQLite's ALTER TABLE supports, and a rebuild of
-- app_settings would needlessly rewrite the API key and VAPID keys.
ALTER TABLE "app_settings" ADD COLUMN "updateCheckEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "app_settings" ADD COLUMN "latestVersion" TEXT;
ALTER TABLE "app_settings" ADD COLUMN "latestVersionUrl" TEXT;
ALTER TABLE "app_settings" ADD COLUMN "latestVersionPublishedAt" DATETIME;
ALTER TABLE "app_settings" ADD COLUMN "lastUpdateCheckAt" DATETIME;
ALTER TABLE "app_settings" ADD COLUMN "lastUpdateCheckError" TEXT;
