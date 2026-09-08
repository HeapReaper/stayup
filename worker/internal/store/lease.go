package store

import (
	"context"
	"fmt"
	"time"
)

// The `monitor_lease` table does two jobs, both of which arrived with regions.
//
// It is the lock the check workers never had: `runner.tick` used to select
// every due monitor with no lease at all, so a second replica of the same
// worker checked everything twice — twice the load on the target, two check
// rows per interval, and two shots at opening the same incident.
//
// It is also where per-region due-ness lives. That could not stay on
// `monitor.lastCheckedAt`: a check from Frankfurt would make the monitor look
// "not due" to the worker in Virginia, and whichever region ticked first would
// end up being the only one that ever checked anything.

// ClaimMonitor takes this region's lease on a monitor until `until`, and
// reports whether it got it.
//
// A lease is time-bounded rather than released by the caller's defer, because
// the failure that matters is the one where the caller never runs again: a
// worker killed mid-check must free the monitor by itself, and an expiry does
// that where an unlock cannot.
//
// The whole decision is one statement — insert the row, or take it over only
// if the existing lease has expired — so two workers racing for the same
// monitor are resolved by the database rather than by a read-then-write that
// both of them win.
func (s *Store) ClaimMonitor(ctx context.Context, monitorID, region, lockedBy string, now, until time.Time) (bool, error) {
	result, err := s.db.ExecContext(ctx, s.q(`
		INSERT INTO monitor_lease ("monitorId", region, "lockedBy", "lockedUntil", "updatedAt")
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT ("monitorId", region) DO UPDATE
		SET "lockedBy" = excluded."lockedBy",
		    "lockedUntil" = excluded."lockedUntil",
		    "updatedAt" = excluded."updatedAt"
		WHERE monitor_lease."lockedUntil" IS NULL OR monitor_lease."lockedUntil" <= ?
	`), monitorID, region, lockedBy, s.db.TimeArg(until), s.db.TimeArg(now), s.db.TimeArg(now))
	if err != nil {
		return false, fmt.Errorf("store: claim monitor: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("store: claim monitor: %w", err)
	}
	return affected > 0, nil
}

// ReleaseLease records the finished check and drops the lock.
//
// `status` is this region's own verdict *after* its failed-attempts threshold
// has been applied, not the raw result — so each region debounces its own
// blips first and the consensus rule below counts settled opinions rather
// than single dropped packets.
func (s *Store) ReleaseLease(ctx context.Context, monitorID, region, status string, checkedAt time.Time) error {
	_, err := s.db.ExecContext(ctx, s.q(`
		UPDATE monitor_lease
		SET "lockedBy" = NULL, "lockedUntil" = NULL,
		    "lastCheckedAt" = ?, "lastStatus" = ?, "updatedAt" = ?
		WHERE "monitorId" = ? AND region = ?
	`), s.db.TimeArg(checkedAt), status, s.db.TimeArg(checkedAt), monitorID, region)
	if err != nil {
		return fmt.Errorf("store: release lease: %w", err)
	}
	return nil
}

// RegionOpinions counts how many regions have reported on this monitor
// recently, and how many of those currently see it failing.
//
// `since` excludes regions that have gone quiet. Without it a worker that was
// shut down while its region happened to be seeing an outage would keep
// voting "down" forever from a row nobody is updating any more.
func (s *Store) RegionOpinions(ctx context.Context, monitorID string, since time.Time) (reporting, failing int, err error) {
	err = s.queryRow(ctx, `
		SELECT COUNT(*), COUNT(CASE WHEN "lastStatus" IN ('Down', 'Degraded') THEN 1 END)
		FROM monitor_lease
		WHERE "monitorId" = ? AND "lastCheckedAt" IS NOT NULL AND "lastCheckedAt" >= ?
	`, monitorID, s.db.TimeArg(since)).Scan(&reporting, &failing)
	if err != nil {
		return 0, 0, fmt.Errorf("store: region opinions: %w", err)
	}
	return reporting, failing, nil
}
