-- Per-monitor overrides of the instance-wide monitoring defaults. Null keeps
-- the AppSettings value, so every existing monitor is unaffected.
ALTER TABLE "monitor" ADD COLUMN     "httpTimeoutSeconds" INTEGER,
ADD COLUMN     "failedAttemptsThreshold" INTEGER,
ADD COLUMN     "latencyThresholdMs" INTEGER;

-- status_page_monitor becomes status_page_component: the same rows, plus the
-- ability to describe something no monitor checks.
--
-- Hand-written rather than what Prisma generated for this model rename, which
-- was a DROP TABLE + CREATE TABLE — that would empty every status page's
-- component list on upgrade. Postgres can rename in place, so the rows never
-- move.
ALTER TABLE "status_page_monitor" RENAME TO "status_page_component";

-- Null monitorId is what makes a manual component possible.
ALTER TABLE "status_page_component" ALTER COLUMN "monitorId" DROP NOT NULL;

ALTER TABLE "status_page_component" ADD COLUMN     "name" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "manualStatus" TEXT;

-- Constraints and indexes carry the old table's name after a RENAME; bring
-- them along so the schema matches what Prisma expects to find.
ALTER TABLE "status_page_component" RENAME CONSTRAINT "status_page_monitor_pkey" TO "status_page_component_pkey";
ALTER TABLE "status_page_component" RENAME CONSTRAINT "status_page_monitor_statusPageId_fkey" TO "status_page_component_statusPageId_fkey";
ALTER TABLE "status_page_component" RENAME CONSTRAINT "status_page_monitor_monitorId_fkey" TO "status_page_component_monitorId_fkey";
ALTER TABLE "status_page_component" RENAME CONSTRAINT "status_page_monitor_groupId_fkey" TO "status_page_component_groupId_fkey";

ALTER INDEX "status_page_monitor_statusPageId_idx" RENAME TO "status_page_component_statusPageId_idx";
ALTER INDEX "status_page_monitor_groupId_idx" RENAME TO "status_page_component_groupId_idx";
ALTER INDEX "status_page_monitor_statusPageId_monitorId_key" RENAME TO "status_page_component_statusPageId_monitorId_key";
