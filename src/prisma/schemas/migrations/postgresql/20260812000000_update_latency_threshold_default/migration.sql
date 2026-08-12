-- AlterTable
ALTER TABLE "app_settings" ALTER COLUMN "latencyThresholdMs" SET DEFAULT 2000;

-- Bump any row still sitting on the old default; leaves rows an admin has
-- deliberately customized untouched.
UPDATE "app_settings" SET "latencyThresholdMs" = 2000 WHERE "latencyThresholdMs" = 800;
