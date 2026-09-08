-- Each worker's resident set size at its last tick. Nullable: a heartbeat
-- written by an older worker image carries no figure, and the dashboard shows
-- nothing rather than 0 MB for it.
ALTER TABLE "worker_heartbeat" ADD COLUMN "memoryKb" INTEGER;
