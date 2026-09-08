-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN     "lastUpdateCheckAt" TIMESTAMP(3),
ADD COLUMN     "lastUpdateCheckError" TEXT,
ADD COLUMN     "latestVersion" TEXT,
ADD COLUMN     "latestVersionPublishedAt" TIMESTAMP(3),
ADD COLUMN     "latestVersionUrl" TEXT,
ADD COLUMN     "updateCheckEnabled" BOOLEAN NOT NULL DEFAULT true;
