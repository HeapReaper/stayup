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

// TrailingFailureCount reports how many of a monitor's most recent checks
// failed (status != "Up"), counting back from the newest and stopping at the
// first successful check. It never looks further back than limit checks, so a
// caller asking "were the last N in a row failures?" can compare the result
// against N directly.
func (s *Store) TrailingFailureCount(ctx context.Context, monitorID string, limit int) (int, error) {
	rows, err := s.db.QueryContext(ctx, s.q(`
		SELECT status
		FROM monitor_check
		WHERE "monitorId" = ?
		ORDER BY "checkedAt" DESC
		LIMIT ?
	`), monitorID, limit)
	if err != nil {
		return 0, fmt.Errorf("store: trailing failure count: %w", err)
	}
	defer rows.Close()

	failures := 0
	for rows.Next() {
		var status string
		if err := rows.Scan(&status); err != nil {
			return 0, fmt.Errorf("store: scan monitor check status: %w", err)
		}
		if status == "Up" {
			break
		}
		failures++
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("store: trailing failure count: %w", err)
	}
	return failures, nil
}
