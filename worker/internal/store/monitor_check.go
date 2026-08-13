package store

import (
	"context"
	"fmt"
	"time"

	"stayup/worker/internal/ids"
)

// CreateCheck mirrors `prisma.monitorCheck.create(...)` in checkOne().
func (s *Store) CreateCheck(ctx context.Context, monitorID, status string, statusCode, responseTime *int, message *string, checkedAt time.Time) error {
	_, err := s.db.ExecContext(ctx, s.q(`
		INSERT INTO monitor_check (id, "monitorId", status, "statusCode", "responseTime", message, "checkedAt")
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`), ids.New(), monitorID, status, statusCode, responseTime, message, s.db.TimeArg(checkedAt))
	if err != nil {
		return fmt.Errorf("store: create monitor check: %w", err)
	}
	return nil
}

// UptimeCounts mirrors the two `prisma.monitorCheck.count(...)` calls in
// recomputeUptime() — total checks in the window, and how many were "Up".
func (s *Store) UptimeCounts(ctx context.Context, monitorID string, windowStart time.Time) (total, up int, err error) {
	err = s.queryRow(ctx, `
		SELECT COUNT(*), COUNT(CASE WHEN status = 'Up' THEN 1 END)
		FROM monitor_check
		WHERE "monitorId" = ? AND "checkedAt" >= ?
	`, monitorID, s.db.TimeArg(windowStart)).Scan(&total, &up)
	if err != nil {
		return 0, 0, fmt.Errorf("store: uptime counts: %w", err)
	}
	return total, up, nil
}
