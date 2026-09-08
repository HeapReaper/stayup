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
--
-- IF NOT EXISTS throughout, for the same reason as the previous migration:
-- Prisma does not wrap a migration file in a transaction, so a failure part
-- way through leaves the earlier statements applied and this file has to be
-- safe to re-run.

CREATE TABLE IF NOT EXISTS "monitor_lease" (
    "monitorId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "lockedBy" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitor_lease_pkey" PRIMARY KEY ("monitorId", "region")
);

CREATE INDEX IF NOT EXISTS "monitor_lease_region_lastCheckedAt_idx" ON "monitor_lease"("region", "lastCheckedAt");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'monitor_lease_monitorId_fkey') THEN
        ALTER TABLE "monitor_lease" ADD CONSTRAINT "monitor_lease_monitorId_fkey"
            FOREIGN KEY ("monitorId") REFERENCES "monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "monitor_check" ADD COLUMN IF NOT EXISTS "region" TEXT;

ALTER TABLE "worker_heartbeat" ADD COLUMN IF NOT EXISTS "worker" TEXT;
ALTER TABLE "worker_heartbeat" ADD COLUMN IF NOT EXISTS "region" TEXT;

ALTER TABLE "monitor" ADD COLUMN IF NOT EXISTS "confirmationRegions" INTEGER;
ALTER TABLE "monitor" ADD COLUMN IF NOT EXISTS "cpuThresholdPercent" INTEGER;
ALTER TABLE "monitor" ADD COLUMN IF NOT EXISTS "memoryThresholdPercent" INTEGER;
ALTER TABLE "monitor" ADD COLUMN IF NOT EXISTS "diskThresholdPercent" INTEGER;
ALTER TABLE "monitor" ADD COLUMN IF NOT EXISTS "lastServerMetrics" TEXT;
