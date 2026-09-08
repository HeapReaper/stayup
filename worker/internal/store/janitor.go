package store

import (
	"context"
	"database/sql"
	"fmt"
	"math"
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
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Percentiles need the distribution, not an aggregate, and only Postgres
	// can do them in SQL (percentile_disc ... WITHIN GROUP; SQLite has no
	// equivalent). Streaming the ordered response times and picking by rank
	// in Go is the one implementation that works on both.
	distribution, err := s.responseTimeDistribution(ctx, from, to)
	if err != nil {
		return nil, err
	}
	for i := range stats {
		if p, ok := distribution[statKey{stats[i].MonitorID, stats[i].Day.Unix()}]; ok {
			stats[i].P50ResponseTime = p.p50
			stats[i].P95ResponseTime = p.p95
			stats[i].P99ResponseTime = p.p99
			stats[i].MaxResponseTime = p.max
		}
	}
	return stats, nil
}

type statKey struct {
	monitorID string
	day       int64
}

type percentiles struct{ p50, p95, p99, max *int }

// responseTimeDistribution streams every recorded response time in the window,
// ordered so that each (monitor, day) group arrives together and already
// sorted — so one group can be reduced to its percentiles and released before
// the next begins, instead of holding the whole window in memory.
func (s *Store) responseTimeDistribution(ctx context.Context, from, to time.Time) (map[statKey]percentiles, error) {
	day := s.dayExpr(`"checkedAt"`)

	rows, err := s.db.QueryContext(ctx, s.q(fmt.Sprintf(`
		SELECT "monitorId", %s AS day, "responseTime"
		FROM monitor_check
		WHERE "checkedAt" >= ? AND "checkedAt" < ? AND "responseTime" IS NOT NULL
		ORDER BY "monitorId", %s, "responseTime"
	`, day, day)), s.db.TimeArg(from), s.db.TimeArg(to))
	if err != nil {
		return nil, fmt.Errorf("store: response time distribution: %w", err)
	}
	defer rows.Close()

	result := map[statKey]percentiles{}
	var current statKey
	var haveCurrent bool
	var values []int

	flush := func() {
		if haveCurrent && len(values) > 0 {
			result[current] = percentilesOf(values)
		}
		values = values[:0]
	}

	for rows.Next() {
		var monitorID string
		var rawDay any
		var responseTime int

		if err := rows.Scan(&monitorID, &rawDay, &responseTime); err != nil {
			return nil, fmt.Errorf("store: scan response time: %w", err)
		}
		parsed, err := parseDay(rawDay)
		if err != nil {
			return nil, err
		}

		key := statKey{monitorID, parsed.Unix()}
		if !haveCurrent || key != current {
			flush()
			current, haveCurrent = key, true
		}
		values = append(values, responseTime)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	flush()

	return result, nil
}

// percentilesOf picks nearest-rank percentiles out of an ascending slice.
// Nearest-rank rather than interpolated: every value it reports is a response
// time that was actually observed, which is what makes "p95 was 840ms"
// defensible in front of the customer the SLA is with.
func percentilesOf(sorted []int) percentiles {
	pick := func(p float64) *int {
		if len(sorted) == 0 {
			return nil
		}
		index := int(math.Ceil(p/100*float64(len(sorted)))) - 1
		if index < 0 {
			index = 0
		}
		if index >= len(sorted) {
			index = len(sorted) - 1
		}
		value := sorted[index]
		return &value
	}

	max := sorted[len(sorted)-1]
	return percentiles{p50: pick(50), p95: pick(95), p99: pick(99), max: &max}
}

// UpsertDailyStat writes one rollup row, replacing an existing one for the
// same (monitor, day) — re-running a day is always safe. ON CONFLICT ... DO
// UPDATE is one of the few upsert forms both providers spell identically.
func (s *Store) UpsertDailyStat(ctx context.Context, stat DailyStat) error {
	_, err := s.db.ExecContext(ctx, s.q(`
		INSERT INTO monitor_daily_stat
			(id, "monitorId", day, "totalChecks", "upChecks", "degradedChecks", "downChecks", "avgResponseTime",
			 "p50ResponseTime", "p95ResponseTime", "p99ResponseTime", "maxResponseTime", uptime, "createdAt")
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT ("monitorId", day) DO UPDATE SET
			"totalChecks" = excluded."totalChecks",
			"upChecks" = excluded."upChecks",
			"degradedChecks" = excluded."degradedChecks",
			"downChecks" = excluded."downChecks",
			"avgResponseTime" = excluded."avgResponseTime",
			"p50ResponseTime" = excluded."p50ResponseTime",
			"p95ResponseTime" = excluded."p95ResponseTime",
			"p99ResponseTime" = excluded."p99ResponseTime",
			"maxResponseTime" = excluded."maxResponseTime",
			uptime = excluded.uptime
	`), ids.New(), stat.MonitorID, s.db.TimeArg(stat.Day), stat.TotalChecks, stat.UpChecks, stat.DegradedChecks,
		stat.DownChecks, stat.AvgResponseTime, stat.P50ResponseTime, stat.P95ResponseTime, stat.P99ResponseTime,
		stat.MaxResponseTime, stat.Uptime, s.db.TimeArg(time.Now()))
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

// PruneOrphanFiles deletes uploaded files (stored_file — status page logos and
// profile pictures, see src/lib/stored-files.ts) that nothing points at any
// more and that are older than cutoff.
//
// Why this exists: the upload endpoint has to store the bytes *before* the form
// they belong to is submitted — a status page being created has no id yet — so
// abandoning that form leaves a row nobody references. Replacing or deleting an
// owner is handled on the TypeScript side (forgetStoredFile), which leaves
// exactly this case: uploaded, never attached.
//
// The reference test is a URL suffix rather than a foreign key because both
// columns hold a URL: User.image is better-auth's own column, and
// StatusPage.logoUrl has always accepted any public address. LIKE '%<prefix>'
// || id matches both the relative form the app writes and an absolute one
// somebody pasted back, and a cuid contains no LIKE wildcards to escape.
//
// The cutoff is what makes it safe: a file uploaded seconds ago, while its form
// is still open, is far younger than any window cmd/janitor passes in.
func (s *Store) PruneOrphanFiles(ctx context.Context, cutoff time.Time, batchSize int) (int64, error) {
	return s.pruneInBatches(ctx, `
		DELETE FROM stored_file
		WHERE id IN (
			SELECT f.id FROM stored_file f
			WHERE f."createdAt" < ?
			  AND NOT EXISTS (SELECT 1 FROM "user" u WHERE u.image LIKE '%/api/files/' || f.id)
			  AND NOT EXISTS (SELECT 1 FROM status_page p WHERE p."logoUrl" LIKE '%/api/files/' || f.id)
			LIMIT ?
		)
	`, cutoff, batchSize, "prune orphan files")
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

// Heartbeat is one worker's liveness row — see RecordHeartbeat.
type Heartbeat struct {
	// Worker is the binary's own name ("https", "janitor", ...) and the row's
	// primary key, so a worker has exactly one row however often it restarts.
	Worker          string
	IntervalSeconds int
	StartedAt       time.Time
	LastSeenAt      time.Time
	Version         string
	Revision        string
	// Resident set size in KiB (internal/procstat). Zero means "couldn't
	// tell", and is written as NULL so the dashboard can leave it blank
	// instead of claiming this worker uses no memory.
	MemoryKB int
}

// RecordHeartbeat upserts this worker's liveness row. It has no TypeScript
// counterpart — like the rollup/retention SQL above it, this is one of the
// few places where the Go side is the only writer; the dashboard and
// /api/health only ever read it.
//
// Called at the top of every tick, before the tick's real work, so a worker
// that is running but failing (unreachable target, bad credentials) still
// reports as alive — "is this process ticking" and "is its work succeeding"
// are different questions, and the Logs page already answers the second.
func (s *Store) RecordHeartbeat(ctx context.Context, in Heartbeat) error {
	var query string
	switch s.db.Provider {
	case db.Postgres:
		query = `
			INSERT INTO worker_heartbeat (id, "lastSeenAt", "intervalSeconds", "startedAt", version, revision, "memoryKb")
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (id) DO UPDATE SET
				"lastSeenAt" = EXCLUDED."lastSeenAt",
				"intervalSeconds" = EXCLUDED."intervalSeconds",
				"startedAt" = EXCLUDED."startedAt",
				version = EXCLUDED.version,
				revision = EXCLUDED.revision,
				"memoryKb" = EXCLUDED."memoryKb"
		`
	default:
		// Every column is written on every tick, so a full row replace is
		// equivalent to the upsert above.
		query = `
			INSERT OR REPLACE INTO worker_heartbeat (id, "lastSeenAt", "intervalSeconds", "startedAt", version, revision, "memoryKb")
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`
	}

	_, err := s.db.ExecContext(ctx, s.q(query),
		in.Worker, s.db.TimeArg(in.LastSeenAt), in.IntervalSeconds, s.db.TimeArg(in.StartedAt),
		nullIfEmpty(in.Version), nullIfEmpty(in.Revision), nullIfZero(in.MemoryKB))
	if err != nil {
		return fmt.Errorf("store: record heartbeat: %w", err)
	}
	return nil
}

func nullIfZero(value int) any {
	if value == 0 {
		return nil
	}
	return value
}

func nullIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}
