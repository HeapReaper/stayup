-- Per-monitor switch for automatic incident creation. Default true, so every
-- existing monitor keeps behaving exactly as it did; false means the workers
-- record the checks and flip the status but never open an incident for it —
-- and therefore never alert, since every notification hangs off an incident.
ALTER TABLE "monitor" ADD COLUMN "autoIncidents" BOOLEAN NOT NULL DEFAULT true;
