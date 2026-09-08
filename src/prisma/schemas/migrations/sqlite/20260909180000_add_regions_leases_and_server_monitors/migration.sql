-- Three features, one migration:
--
--   1. Multi-region checking — monitor_lease, monitor_check.region,
--      worker_heartbeat.worker/region, monitor.confirmationRegions
--   2. Server monitors      — monitor.{cpu,memory,disk}ThresholdPercent and
--      monitor.lastServerMetrics
--   3. (No schema change for private status pages — requireLogin already
--      exists; that fix is in the proxy and the status page route.)
--
-- monitor_lease is the load-bearing one. Due-ness used to live on
-- monitor.lastCheckedAt, which cannot survive regions: a check from Frankfurt
-- would make the monitor look "not due" to the worker in Virginia and only
-- one region would ever check anything. It also gives the check workers the
-- lease they never had, so two replicas stop checking everything twice.
--
-- No backfill: a monitor with no lease row for a region reads as "never
-- checked there", which is due, so the first tick after this migration claims
-- everything once and settles into the normal cadence.

CREATE TABLE "monitor_lease" (
    "monitorId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "lockedBy" TEXT,
    "lockedUntil" DATETIME,
    "lastCheckedAt" DATETIME,
    "lastStatus" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "monitor_lease_pkey" PRIMARY KEY ("monitorId", "region"),
    CONSTRAINT "monitor_lease_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "monitor_lease_region_lastCheckedAt_idx" ON "monitor_lease"("region", "lastCheckedAt");

ALTER TABLE "monitor_check" ADD COLUMN "region" TEXT;

ALTER TABLE "worker_heartbeat" ADD COLUMN "worker" TEXT;
ALTER TABLE "worker_heartbeat" ADD COLUMN "region" TEXT;

ALTER TABLE "monitor" ADD COLUMN "confirmationRegions" INTEGER;
ALTER TABLE "monitor" ADD COLUMN "cpuThresholdPercent" INTEGER;
ALTER TABLE "monitor" ADD COLUMN "memoryThresholdPercent" INTEGER;
ALTER TABLE "monitor" ADD COLUMN "diskThresholdPercent" INTEGER;
ALTER TABLE "monitor" ADD COLUMN "lastServerMetrics" TEXT;
