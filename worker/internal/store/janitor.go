package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"stayup/worker/internal/db"
	"stayup/worker/internal/ids"
)

// Package-level note: everything in this file backs cmd/janitor, the
// retention/rollup worker. It has no TypeScript counterpart — the dashboard
// never prunes or aggregates anything.

// dayExpr is the SQL expression that truncates a check's timestamp to its UTC
// day, in the representation that provider stores DateTime columns in:
// Postgres has a real timestamp type to date_trunc, while Prisma writes
// SQLite DateTimes as ISO-8601 text, so slicing off the date part and pasting
// midnight back on produces a value that's still comparable and still parses.
func (s *Store) dayExpr(column string) string {
	if s.db.Provider == db.Postgres {
		return fmt.Sprintf(`date_trunc('day', %s)`, column)
	}
	return fmt.Sprintf(`substr(%s, 1, 10) || 'T00:00:00.000Z'`, column)
}

// parseDay normalizes whatever the driver hands back for a day/timestamp
// column: pgx returns time.Time, while a SQLite expression (no declared
// column type to convert from) comes back as text.
func parseDay(value any) (time.Time, error) {
	switch v := value.(type) {
	case time.Time:
		return v.UTC(), nil
	case string:
		return parseDayString(v)
	case []byte:
		return parseDayString(string(v))
	case nil:
		return time.Time{}, nil
	default:
		return time.Time{}, fmt.Errorf("store: unsupported day value %T", value)
	}
}

func parseDayString(value string) (time.Time, error) {
	for _, layout := range []string{
		"2006-01-02T15:04:05.000Z", // what db.TimeArg writes for SQLite
		time.RFC3339Nano,           // anything else ISO-8601-ish
		"2006-01-02 15:04:05.999-07:00",
		"2006-01-02 15:04:05",
		"2006-01-02",
	} {
		if t, err := time.Parse(layout, value); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("store: unrecognized day format %q", value)
}

// AggregateChecksByDay groups every monitor_check row in [from, to) by monitor
// and UTC day — the raw material for the monitor_daily_stat rollups.
func (s *Store) AggregateChecksByDay(ctx context.Context, from, to time.Time) ([]DailyStat, error) {
	day := s.dayExpr(`"checkedAt"`)

	rows, err := s.db.QueryContext(ctx, s.q(fmt.Sprintf(`
		SELECT "monitorId",
		       %s AS day,
		       COUNT(*),
		       COUNT(CASE WHEN status = 'Up' THEN 1 END),
		       COUNT(CASE WHEN status = 'Degraded' THEN 1 END),
		       COUNT(CASE WHEN status = 'Down' THEN 1 END),
		       AVG("responseTime")
		FROM monitor_check
		WHERE "checkedAt" >= ? AND "checkedAt" < ?
		GROUP BY "monitorId", %s
	`, day, day)), s.db.TimeArg(from), s.db.TimeArg(to))
	if err != nil {
		return nil, fmt.Errorf("store: aggregate checks by day: %w", err)
	}
	defer rows.Close()

	var stats []DailyStat
	for rows.Next() {
		var stat DailyStat
		var rawDay any
		var avgResponseTime sql.NullFloat64

		if err := rows.Scan(&stat.MonitorID, &rawDay, &stat.TotalChecks, &stat.UpChecks, &stat.DegradedChecks, &stat.DownChecks, &avgResponseTime); err != nil {
			return nil, fmt.Errorf("store: scan daily stat: %w", err)
		}

		parsed, err := parseDay(rawDay)
		if err != nil {
			return nil, err
		}
		stat.Day = parsed

		if avgResponseTime.Valid {
			rounded := int(avgResponseTime.Float64 + 0.5)
			stat.AvgResponseTime = &rounded
		}
		// Same definition of uptime the runner uses for a monitor's rolling
		// percentage: Up over total, so a Degraded check counts against it.
		if stat.TotalChecks > 0 {
			stat.Uptime = float64(int(float64(stat.UpChecks)/float64(stat.TotalChecks)*10_000+0.5)) / 100
		}
		stats = append(stats, stat)
	}
	return stats, rows.Err()
}

// UpsertDailyStat writes one rollup row, replacing an existing one for the
// same (monitor, day) — re-running a day is always safe. ON CONFLICT ... DO
// UPDATE is one of the few upsert forms both providers spell identically.
func (s *Store) UpsertDailyStat(ctx context.Context, stat DailyStat) error {
	_, err := s.db.ExecContext(ctx, s.q(`
		INSERT INTO monitor_daily_stat
			(id, "monitorId", day, "totalChecks", "upChecks", "degradedChecks", "downChecks", "avgResponseTime", uptime, "createdAt")
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT ("monitorId", day) DO UPDATE SET
			"totalChecks" = excluded."totalChecks",
			"upChecks" = excluded."upChecks",
			"degradedChecks" = excluded."degradedChecks",
			"downChecks" = excluded."downChecks",
			"avgResponseTime" = excluded."avgResponseTime",
			uptime = excluded.uptime
	`), ids.New(), stat.MonitorID, s.db.TimeArg(stat.Day), stat.TotalChecks, stat.UpChecks, stat.DegradedChecks,
		stat.DownChecks, stat.AvgResponseTime, stat.Uptime, s.db.TimeArg(time.Now()))
	if err != nil {
		return fmt.Errorf("store: upsert daily stat: %w", err)
	}
	return nil
}

// LatestRollupDay returns the most recent day that already has rollups, or
// nil when there are none yet — the janitor resumes from the day after.
func (s *Store) LatestRollupDay(ctx context.Context) (*time.Time, error) {
	return s.scanOptionalDay(ctx, `SELECT MAX(day) FROM monitor_daily_stat`, "latest rollup day")
}

// OldestCheckDay returns the timestamp of the oldest raw check, or nil when
// there are none — where the janitor starts on a database that has never been
// rolled up.
func (s *Store) OldestCheckDay(ctx context.Context) (*time.Time, error) {
	return s.scanOptionalDay(ctx, `SELECT MIN("checkedAt") FROM monitor_check`, "oldest check day")
}

func (s *Store) scanOptionalDay(ctx context.Context, query, label string) (*time.Time, error) {
	var raw any
	if err := s.queryRow(ctx, query).Scan(&raw); err != nil {
		return nil, fmt.Errorf("store: %s: %w", label, err)
	}
	if raw == nil {
		return nil, nil
	}

	parsed, err := parseDay(raw)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

// PruneChecksBefore deletes raw checks older than cutoff, in batches, and
// returns how many rows went. Batching keeps each statement's transaction
// short: the first run after enabling a short retention can face millions of
// rows, and one giant DELETE would hold locks (and, on SQLite, the single
// write connection) for the whole thing.
func (s *Store) PruneChecksBefore(ctx context.Context, cutoff time.Time, batchSize int) (int64, error) {
	return s.pruneInBatches(ctx, `
		DELETE FROM monitor_check
		WHERE id IN (SELECT id FROM monitor_check WHERE "checkedAt" < ? LIMIT ?)
	`, cutoff, batchSize, "prune checks")
}

// PruneDeliveriesBefore deletes finished (Sent/Failed) notification rows older
// than cutoff. Pending ones are never touched, however old — those are still
// owed to someone, and cmd/integrations is still retrying them.
func (s *Store) PruneDeliveriesBefore(ctx context.Context, cutoff time.Time, batchSize int) (int64, error) {
	return s.pruneInBatches(ctx, `
		DELETE FROM integration_delivery
		WHERE id IN (
			SELECT id FROM integration_delivery
			WHERE "createdAt" < ? AND status IN ('Sent', 'Failed')
			LIMIT ?
		)
	`, cutoff, batchSize, "prune deliveries")
}

func (s *Store) pruneInBatches(ctx context.Context, query string, cutoff time.Time, batchSize int, label string) (int64, error) {
	var total int64
	for {
		result, err := s.db.ExecContext(ctx, s.q(query), s.db.TimeArg(cutoff), batchSize)
		if err != nil {
			return total, fmt.Errorf("store: %s: %w", label, err)
		}

		affected, err := result.RowsAffected()
		if err != nil {
			return total, fmt.Errorf("store: %s: %w", label, err)
		}

		total += affected
		if affected < int64(batchSize) {
			return total, nil
		}

		// Don't keep hammering a database that's shutting down.
		if err := ctx.Err(); err != nil {
			return total, nil
		}
	}
}
