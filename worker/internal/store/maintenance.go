package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// IsMonitorUnderMaintenance mirrors isMonitorUnderMaintenance() in
// src/lib/maintenance.ts: true if `monitorId` is covered by a maintenance
// window that's active right now (not cancelled, startsAt <= now <= endsAt).
func (s *Store) IsMonitorUnderMaintenance(ctx context.Context, monitorID string, now time.Time) (bool, error) {
	encoded := s.db.TimeArg(now)
	var exists int
	err := s.queryRow(ctx, `
		SELECT 1
		FROM maintenance_window_monitor mwm
		JOIN maintenance_window mw ON mw.id = mwm."maintenanceWindowId"
		WHERE mwm."monitorId" = ?
		  AND mw."cancelledAt" IS NULL
		  AND mw."startsAt" <= ?
		  AND mw."endsAt" >= ?
		LIMIT 1
	`, monitorID, encoded, encoded).Scan(&exists)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("store: is monitor under maintenance: %w", err)
	}
	return true, nil
}
