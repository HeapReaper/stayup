package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// ListByType mirrors `prisma.monitor.findMany({ where: { type } })` in
// src/lib/monitor-worker.ts's tick().
func (s *Store) ListByType(ctx context.Context, monitorType string) ([]Monitor, error) {
	rows, err := s.db.QueryContext(ctx, s.q(`
		SELECT id, name, url, type, status, interval, port, "lastCheckedAt", "escalationPolicyId"
		FROM monitor
		WHERE type = ?
	`), monitorType)
	if err != nil {
		return nil, fmt.Errorf("store: list monitors by type: %w", err)
	}
	defer rows.Close()

	var monitors []Monitor
	for rows.Next() {
		var m Monitor
		var port sql.NullInt64
		var lastCheckedAt sql.NullTime
		var escalationPolicyID sql.NullString

		if err := rows.Scan(&m.ID, &m.Name, &m.URL, &m.Type, &m.Status, &m.Interval, &port, &lastCheckedAt, &escalationPolicyID); err != nil {
			return nil, fmt.Errorf("store: scan monitor: %w", err)
		}
		if port.Valid {
			p := int(port.Int64)
			m.Port = &p
		}
		if lastCheckedAt.Valid {
			t := lastCheckedAt.Time
			m.LastCheckedAt = &t
		}
		if escalationPolicyID.Valid {
			id := escalationPolicyID.String
			m.EscalationPolicyID = &id
		}
		monitors = append(monitors, m)
	}
	return monitors, rows.Err()
}

// UpdateCheckResult mirrors the `prisma.monitor.update({ data: { status,
// responseTime, uptime, lastCheckedAt } })` call in checkOne().
func (s *Store) UpdateCheckResult(ctx context.Context, monitorID, status string, responseTime int, uptime float64, checkedAt time.Time) error {
	encoded := s.db.TimeArg(checkedAt)
	_, err := s.db.ExecContext(ctx, s.q(`
		UPDATE monitor
		SET status = ?, "responseTime" = ?, uptime = ?, "lastCheckedAt" = ?, "updatedAt" = ?
		WHERE id = ?
	`), status, responseTime, uptime, encoded, encoded, monitorID)
	if err != nil {
		return fmt.Errorf("store: update monitor check result: %w", err)
	}
	return nil
}

// GetMonitorRef fetches the minimal (id, name, escalationPolicyId) shape used
// by incident notification routing.
func (s *Store) GetMonitorRef(ctx context.Context, monitorID string) (*IncidentMonitorRef, error) {
	var ref IncidentMonitorRef
	var escalationPolicyID sql.NullString

	err := s.queryRow(ctx, `SELECT id, name, "escalationPolicyId" FROM monitor WHERE id = ?`, monitorID).
		Scan(&ref.ID, &ref.Name, &escalationPolicyID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("store: get monitor ref: %w", err)
	}
	if escalationPolicyID.Valid {
		id := escalationPolicyID.String
		ref.EscalationPolicyID = &id
	}
	return &ref, nil
}
