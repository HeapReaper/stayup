package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"stayup/worker/internal/db"
)

// ListByType mirrors `prisma.monitor.findMany({ where: { type, enabled: true } })`
// in src/lib/monitor-worker.ts's tick(). Paused monitors (enabled = false) are
// filtered out here rather than in the runner, so no worker ever has to think
// about them — a pause takes effect on the next tick, at most a few seconds.
func (s *Store) ListByType(ctx context.Context, monitorType string) ([]Monitor, error) {
	return s.listMonitors(ctx, `WHERE type = ? AND enabled = ?`, monitorType, s.db.BoolArg(true))
}

// ListByTypes is ListByType for a worker that owns more than one monitor type
// — cmd/probes handles the whole family of connection-level checks (Postgres,
// MySQL, Redis, SMTP, IMAP, gRPC, WebSocket, Domain) from one binary rather
// than shipping eight near-identical containers.
func (s *Store) ListByTypes(ctx context.Context, monitorTypes []string) ([]Monitor, error) {
	if len(monitorTypes) == 0 {
		return nil, nil
	}

	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(monitorTypes)), ",")
	args := make([]any, 0, len(monitorTypes)+1)
	for _, t := range monitorTypes {
		args = append(args, t)
	}
	args = append(args, s.db.BoolArg(true))

	return s.listMonitors(ctx, fmt.Sprintf(`WHERE type IN (%s) AND enabled = ?`, placeholders), args...)
}

func (s *Store) listMonitors(ctx context.Context, where string, args ...any) ([]Monitor, error) {
	rows, err := s.db.QueryContext(ctx, s.q(`
		SELECT id, name, url, type, status, interval, port, enabled, "lastCheckedAt", "escalationPolicyId",
		       method, "requestHeaders", "requestBody", "followRedirects", "expectedStatusCodes", keyword, "keywordInverted",
		       "assertionType", "jsonPath", credential, "flappingSince"
		FROM monitor
		`+where), args...)
	if err != nil {
		return nil, fmt.Errorf("store: list monitors by type: %w", err)
	}
	defer rows.Close()

	var monitors []Monitor
	for rows.Next() {
		var m Monitor
		var port sql.NullInt64
		var enabled, followRedirects, keywordInverted db.Bool
		var lastCheckedAt, flappingSince sql.NullTime
		var escalationPolicyID, requestHeaders, requestBody, expectedStatusCodes, keyword sql.NullString
		var jsonPath, credential sql.NullString

		if err := rows.Scan(
			&m.ID, &m.Name, &m.URL, &m.Type, &m.Status, &m.Interval, &port, &enabled, &lastCheckedAt, &escalationPolicyID,
			&m.Method, &requestHeaders, &requestBody, &followRedirects, &expectedStatusCodes, &keyword, &keywordInverted,
			&m.AssertionType, &jsonPath, &credential, &flappingSince,
		); err != nil {
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
		if flappingSince.Valid {
			t := flappingSince.Time
			m.FlappingSince = &t
		}
		if escalationPolicyID.Valid {
			id := escalationPolicyID.String
			m.EscalationPolicyID = &id
		}
		m.Enabled = bool(enabled)
		m.FollowRedirects = bool(followRedirects)
		m.KeywordInverted = bool(keywordInverted)
		m.RequestHeaders = nullString(requestHeaders)
		m.RequestBody = nullString(requestBody)
		m.ExpectedStatusCodes = nullString(expectedStatusCodes)
		m.Keyword = nullString(keyword)
		m.JSONPath = nullString(jsonPath)
		m.Credential = nullString(credential)
		monitors = append(monitors, m)
	}
	return monitors, rows.Err()
}

func nullString(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	s := v.String
	return &s
}

// UpdateCheckResult mirrors the `prisma.monitor.update({ data: { status,
// responseTime, uptime, lastCheckedAt, certExpiresAt } })` call in checkOne().
func (s *Store) UpdateCheckResult(ctx context.Context, monitorID, status string, responseTime int, uptime float64, checkedAt time.Time, certExpiresAt, domainExpiresAt *time.Time) error {
	encoded := s.db.TimeArg(checkedAt)
	_, err := s.db.ExecContext(ctx, s.q(`
		UPDATE monitor
		SET status = ?, "responseTime" = ?, uptime = ?, "lastCheckedAt" = ?, "certExpiresAt" = ?, "domainExpiresAt" = ?, "updatedAt" = ?
		WHERE id = ?
	`), status, responseTime, uptime, encoded, s.db.NullTimeArg(certExpiresAt), s.db.NullTimeArg(domainExpiresAt), encoded, monitorID)
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
