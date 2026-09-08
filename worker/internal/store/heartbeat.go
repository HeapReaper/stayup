package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"stayup/worker/internal/db"
)

// HeartbeatMonitor is a push monitor as cmd/heartbeat needs it: enough to
// work out whether its report is overdue, and enough to open the incident if
// it is.
//
// Covers both push types. A Heartbeat monitor is a job saying "I ran"; a
// Server monitor is an agent saying "here is how the machine is doing". The
// payload differs and so does what the Next.js side records, but the failure
// is identical — nothing arrived in time — so one sweep handles both rather
// than two loops that would drift apart.
//
// Deliberately not the full Monitor shape: a push monitor has no URL, no port,
// no request options and no credentials — none of the columns the listMonitors
// query exists to carry — but it *does* need CreatedAt, which that query
// doesn't select. A monitor that has never reported has no lastCheckedAt, and
// without a creation time the only two options are calling it Down the second
// it is created or never calling it Down at all.
type HeartbeatMonitor struct {
	ID   string
	Name string
	// Heartbeat | Server — only used to word the failure, since the deadline
	// and the incident path are the same for both.
	Type     string
	Status   string
	Interval string
	// Nil means "use the default grace period" (see cmd/heartbeat).
	GraceSeconds  *int
	LastCheckedAt *time.Time
	CreatedAt     time.Time
	AutoIncidents bool
	ParentID      *string
}

// Deadline is the moment this monitor's next ping stops being late and starts
// being an outage: one interval, plus the grace period, after the last ping —
// or after the monitor was created, if it has never been pinged at all.
//
// The grace period matters more here than a `failedAttemptsThreshold` does
// elsewhere: a job scheduled hourly does not run at exactly :00 every hour —
// it queues, it retries, the box is busy — so a deadline of exactly
// `interval` would page on the first slow night.
func (m HeartbeatMonitor) Deadline(defaultGrace time.Duration) time.Time {
	since := m.CreatedAt
	if m.LastCheckedAt != nil {
		since = *m.LastCheckedAt
	}

	grace := defaultGrace
	if m.GraceSeconds != nil {
		grace = time.Duration(*m.GraceSeconds) * time.Second
	}

	return since.Add(intervalDuration(m.Interval) + grace)
}

// ListHeartbeatMonitors reads every enabled push monitor — Heartbeat and
// Server. Paused ones are filtered out here, the same way ListByType does it
// for the dialling workers, and for the same reason: pausing has to mean "stop
// watching this", including stopping the clock that would otherwise declare it
// down.
func (s *Store) ListHeartbeatMonitors(ctx context.Context) ([]HeartbeatMonitor, error) {
	rows, err := s.db.QueryContext(ctx, s.q(`
		SELECT id, name, type, status, interval, "heartbeatGraceSeconds", "lastCheckedAt", "createdAt",
		       "autoIncidents", "parentId"
		FROM monitor
		WHERE type IN ('Heartbeat', 'Server') AND enabled = ?
	`), s.db.BoolArg(true))
	if err != nil {
		return nil, fmt.Errorf("store: list heartbeat monitors: %w", err)
	}
	defer rows.Close()

	var out []HeartbeatMonitor
	for rows.Next() {
		var m HeartbeatMonitor
		var grace sql.NullInt64
		var lastCheckedAt sql.NullTime
		var parentID sql.NullString
		var autoIncidents db.Bool

		if err := rows.Scan(&m.ID, &m.Name, &m.Type, &m.Status, &m.Interval, &grace, &lastCheckedAt, &m.CreatedAt,
			&autoIncidents, &parentID); err != nil {
			return nil, fmt.Errorf("store: scan heartbeat monitor: %w", err)
		}
		m.GraceSeconds = nullInt(grace)
		if lastCheckedAt.Valid {
			t := lastCheckedAt.Time
			m.LastCheckedAt = &t
		}
		m.AutoIncidents = bool(autoIncidents)
		m.ParentID = nullString(parentID)
		out = append(out, m)
	}
	return out, rows.Err()
}
