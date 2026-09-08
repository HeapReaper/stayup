package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"stayup/worker/internal/ids"
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

// MaintenanceWindowAnnouncement is one window as the announcement path needs
// it — mirrors the shape announceMaintenance() loads in
// src/lib/maintenance-notify.ts.
type MaintenanceWindowAnnouncement struct {
	ID           string
	Title        string
	Message      *string
	StartsAt     time.Time
	EndsAt       time.Time
	MonitorIDs   []string
	MonitorNames []string
}

// MaintenanceNotifyPhase is which of the two clock-driven announcements is
// being asked about. The other two phases (Scheduled, Cancelled) are sent by
// the dashboard, because a person triggers them.
type MaintenanceNotifyPhase string

const (
	MaintenanceStarted MaintenanceNotifyPhase = "Started"
	MaintenanceEnded   MaintenanceNotifyPhase = "Ended"
)

// notifiedColumn is the send-once mark for a phase. Kept private so the only
// way to name a column is through the two constants above — this string is
// interpolated straight into SQL.
func (p MaintenanceNotifyPhase) notifiedColumn() string {
	if p == MaintenanceEnded {
		return "notifiedEndedAt"
	}
	return "notifiedStartedAt"
}

// MaintenanceWindowsDueFor lists windows that have just crossed into `phase`
// and haven't been announced yet.
//
// `cutoff` is what keeps an upgrade — or a worker that was down for a day —
// from blasting out a backlog of announcements for windows that came and went
// while nobody was listening. A transition older than the cutoff is simply
// never announced; it is not news any more, and its send-once mark stays null
// forever, which costs one row in a filtered scan.
func (s *Store) MaintenanceWindowsDueFor(ctx context.Context, phase MaintenanceNotifyPhase, now, cutoff time.Time) ([]MaintenanceWindowAnnouncement, error) {
	// A start is due once startsAt has passed; an end once endsAt has. Both
	// are additionally bounded below by the cutoff.
	boundary := `mw."startsAt"`
	if phase == MaintenanceEnded {
		boundary = `mw."endsAt"`
	}

	query := fmt.Sprintf(`
		SELECT mw.id, mw.title, mw.message, mw."startsAt", mw."endsAt"
		FROM maintenance_window mw
		WHERE mw."cancelledAt" IS NULL
		  AND mw."notifySubscribers" = ?
		  AND mw.%q IS NULL
		  AND %s <= ?
		  AND %s >= ?
		ORDER BY %s ASC
	`, phase.notifiedColumn(), boundary, boundary, boundary)

	rows, err := s.db.QueryContext(ctx, s.q(query), s.db.BoolArg(true), s.db.TimeArg(now), s.db.TimeArg(cutoff))
	if err != nil {
		return nil, fmt.Errorf("store: maintenance windows due for %s: %w", phase, err)
	}
	defer rows.Close()

	var out []MaintenanceWindowAnnouncement
	for rows.Next() {
		var w MaintenanceWindowAnnouncement
		var message sql.NullString
		if err := rows.Scan(&w.ID, &w.Title, &message, &w.StartsAt, &w.EndsAt); err != nil {
			return nil, fmt.Errorf("store: scan maintenance window: %w", err)
		}
		if message.Valid {
			w.Message = &message.String
		}
		out = append(out, w)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// The monitors per window, one query each. There are never many windows
	// in flight at once (this only ever returns the ones that just started or
	// just ended), so a join with a second result shape isn't worth it.
	for i := range out {
		ids, names, err := s.maintenanceWindowMonitors(ctx, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].MonitorIDs, out[i].MonitorNames = ids, names
	}
	return out, nil
}

func (s *Store) maintenanceWindowMonitors(ctx context.Context, windowID string) ([]string, []string, error) {
	rows, err := s.db.QueryContext(ctx, s.q(`
		SELECT m.id, m.name
		FROM maintenance_window_monitor mwm
		JOIN monitor m ON m.id = mwm."monitorId"
		WHERE mwm."maintenanceWindowId" = ?
		ORDER BY m.name ASC
	`), windowID)
	if err != nil {
		return nil, nil, fmt.Errorf("store: maintenance window monitors: %w", err)
	}
	defer rows.Close()

	var ids, names []string
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, nil, fmt.Errorf("store: scan maintenance window monitor: %w", err)
		}
		ids = append(ids, id)
		names = append(names, name)
	}
	return ids, names, rows.Err()
}

// MarkMaintenanceNotified stamps the send-once mark for a phase — mirrors the
// PHASE_MARKS update in announceMaintenance(). This is the only thing
// standing between a five-second poll loop and announcing the same window
// every tick, so it is written even when some of the sends failed: a partial
// announcement is better than a repeating one.
func (s *Store) MarkMaintenanceNotified(ctx context.Context, windowID string, phase MaintenanceNotifyPhase, now time.Time) error {
	query := fmt.Sprintf(`UPDATE maintenance_window SET %q = ?, "updatedAt" = ? WHERE id = ?`, phase.notifiedColumn())
	encoded := s.db.TimeArg(now)
	if _, err := s.db.ExecContext(ctx, s.q(query), encoded, encoded, windowID); err != nil {
		return fmt.Errorf("store: mark maintenance notified: %w", err)
	}
	return nil
}

// StatusPageSubscribersForMonitors is StatusPageSubscribersForMonitor for the
// several monitors one maintenance window covers, de-duplicated across all of
// them so nobody is mailed once per affected service.
func (s *Store) StatusPageSubscribersForMonitors(ctx context.Context, monitorIDs []string) ([]StatusPageSubscriber, error) {
	if len(monitorIDs) == 0 {
		return nil, nil
	}

	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(monitorIDs)), ",")
	args := make([]any, 0, len(monitorIDs)+1)
	for _, id := range monitorIDs {
		args = append(args, id)
	}
	args = append(args, s.db.BoolArg(true))

	rows, err := s.db.QueryContext(ctx, s.q(fmt.Sprintf(`
		SELECT DISTINCT sub.channel, sub.target
		FROM status_page_component spc
		JOIN status_page sp ON sp.id = spc."statusPageId"
		JOIN status_page_subscriber sub ON sub."statusPageId" = sp.id
		WHERE spc."monitorId" IN (%s) AND sp."isPublished" = ?
	`, placeholders)), args...)
	if err != nil {
		return nil, fmt.Errorf("store: status page subscribers for monitors: %w", err)
	}
	defer rows.Close()

	var subs []StatusPageSubscriber
	for rows.Next() {
		var sub StatusPageSubscriber
		if err := rows.Scan(&sub.Channel, &sub.Target); err != nil {
			return nil, fmt.Errorf("store: scan status page subscriber: %w", err)
		}
		subs = append(subs, sub)
	}
	return subs, rows.Err()
}

// CreateBroadcastDeliveries is CreateDeliveries for a notification that isn't
// about an incident — a maintenance announcement. The incidentId column stays
// NULL, which is what tells cmd/integrations there is no incident detail to
// join in for a Discord embed.
func (s *Store) CreateBroadcastDeliveries(ctx context.Context, integrationIDs []string, event, message string) error {
	if len(integrationIDs) == 0 {
		return nil
	}

	now := s.db.TimeArg(time.Now())
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: create broadcast deliveries: begin tx: %w", err)
	}
	defer tx.Rollback()

	for _, integrationID := range integrationIDs {
		if _, err := tx.ExecContext(ctx, s.q(`
			INSERT INTO integration_delivery (id, "integrationId", "incidentId", event, message, status, attempts, "createdAt")
			VALUES (?, ?, NULL, ?, ?, 'Pending', 0, ?)
		`), ids.New(), integrationID, event, message, now); err != nil {
			return fmt.Errorf("store: create broadcast deliveries: insert: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("store: create broadcast deliveries: commit: %w", err)
	}
	return nil
}
