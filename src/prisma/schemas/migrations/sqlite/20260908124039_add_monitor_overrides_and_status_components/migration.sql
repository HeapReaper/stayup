-- Per-monitor overrides of the instance-wide monitoring defaults. Null keeps
-- the AppSettings value, so every existing monitor is unaffected.
ALTER TABLE "monitor" ADD COLUMN "httpTimeoutSeconds" INTEGER;
ALTER TABLE "monitor" ADD COLUMN "failedAttemptsThreshold" INTEGER;
ALTER TABLE "monitor" ADD COLUMN "latencyThresholdMs" INTEGER;

-- status_page_monitor becomes status_page_component: the same rows, plus the
-- ability to describe something no monitor checks.
--
-- Hand-written rather than what `prisma migrate dev` generated, which was a
-- DROP TABLE + CREATE TABLE — that would empty every status page's component
-- list on upgrade. Copying through a new table (rather than ALTER TABLE
-- RENAME) is the SQLite idiom for also relaxing monitorId to nullable, which
-- ALTER TABLE cannot do.
PRAGMA foreign_keys=OFF;

CREATE TABLE "status_page_component" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "statusPageId" TEXT NOT NULL,
    "monitorId" TEXT,
    "groupId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT,
    "description" TEXT,
    "manualStatus" TEXT,
    CONSTRAINT "status_page_component_statusPageId_fkey" FOREIGN KEY ("statusPageId") REFERENCES "status_page" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "status_page_component_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "status_page_component_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "status_page_group" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- name/description/manualStatus stay NULL: an existing row is a
-- monitor-backed component, which shows the monitor's own name and status.
INSERT INTO "status_page_component" ("id", "statusPageId", "monitorId", "groupId", "order")
SELECT "id", "statusPageId", "monitorId", "groupId", "order" FROM "status_page_monitor";

DROP TABLE "status_page_monitor";

PRAGMA foreign_keys=ON;

CREATE INDEX "status_page_component_statusPageId_idx" ON "status_page_component"("statusPageId");
CREATE INDEX "status_page_component_groupId_idx" ON "status_page_component"("groupId");
CREATE UNIQUE INDEX "status_page_component_statusPageId_monitorId_key" ON "status_page_component"("statusPageId", "monitorId");
