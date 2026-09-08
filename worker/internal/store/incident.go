package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"stayup/worker/internal/db"
	"stayup/worker/internal/ids"
)

// CreateIncidentInput mirrors createIncident()'s input in src/lib/incidents.ts.
type CreateIncidentInput struct {
	Title       string
	Impact      string
	Status      string // always "Investigating" when called from a worker
	Message     string
	MonitorID   *string
	CreatedByID *string // always nil from a worker — set by the dashboard only
}

// CreateIncident inserts the incident row plus its first timeline entry in
// one transaction — mirrors `prisma.incident.create({ ..., updates: {
// create: {...} } })`.
func (s *Store) CreateIncident(ctx context.Context, in CreateIncidentInput) (Incident, error) {
	now := time.Now()
	encoded := s.db.TimeArg(now)
	incidentID := ids.New()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Incident{}, fmt.Errorf("store: create incident: begin tx: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, s.q(`
		INSERT INTO incident (id, title, impact, status, "monitorId", "createdById", "createdAt", "updatedAt")
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`), incidentID, in.Title, in.Impact, in.Status, in.MonitorID, in.CreatedByID, encoded, encoded); err != nil {
		return Incident{}, fmt.Errorf("store: create incident: insert incident: %w", err)
	}

	if _, err := tx.ExecContext(ctx, s.q(`
		INSERT INTO incident_update (id, "incidentId", status, message, "authorId", "createdAt")
		VALUES (?, ?, ?, ?, ?, ?)
	`), ids.New(), incidentID, in.Status, in.Message, in.CreatedByID, encoded); err != nil {
		return Incident{}, fmt.Errorf("store: create incident: insert incident_update: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return Incident{}, fmt.Errorf("store: create incident: commit: %w", err)
	}

	incident := Incident{
		ID:        incidentID,
		Title:     in.Title,
		Status:    in.Status,
		MonitorID: in.MonitorID,
		CreatedAt: now,
	}
	if in.MonitorID != nil {
		ref, err := s.GetMonitorRef(ctx, *in.MonitorID)
		if err != nil {
			return Incident{}, err
		}
		incident.Monitor = ref
	}
	return incident, nil
}

// FindOpenIncidentForMonitor mirrors the `prisma.incident.findFirst({ where:
// { monitorId, status: { not: 'Resolved' } } })` calls in
// ensureIncidentForMonitor()/noteMonitorRecovered().
func (s *Store) FindOpenIncidentForMonitor(ctx context.Context, monitorID string) (*Incident, error) {
	var inc Incident
	var lastEscalatedAt sql.NullTime

	err := s.queryRow(ctx, `
		SELECT id, title, status, "monitorId", "escalationStep", "lastEscalatedAt", "createdAt"
		FROM incident
		WHERE "monitorId" = ? AND status != 'Resolved'
		LIMIT 1
	`, monitorID).Scan(&inc.ID, &inc.Title, &inc.Status, &inc.MonitorID, &inc.EscalationStep, &lastEscalatedAt, &inc.CreatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("store: find open incident for monitor: %w", err)
	}
	if lastEscalatedAt.Valid {
		t := lastEscalatedAt.Time
		inc.LastEscalatedAt = &t
	}
	return &inc, nil
}

// UpdateIncidentStatusInput mirrors postIncidentUpdate()'s input.
type UpdateIncidentStatusInput struct {
	IncidentID string
	Status     string
	Message    string
	AuthorID   *string
}

// UpdateIncidentStatus appends a timeline entry and rolls the incident's
// status forward — mirrors `prisma.incident.update({ data: { status,
// resolvedAt, updates: { create: {...} } } })` in postIncidentUpdate().
func (s *Store) UpdateIncidentStatus(ctx context.Context, in UpdateIncidentStatusInput) (Incident, error) {
	now := time.Now()
	encoded := s.db.TimeArg(now)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Incident{}, fmt.Errorf("store: update incident status: begin tx: %w", err)
	}
	defer tx.Rollback()

	query := `UPDATE incident SET status = ?, "updatedAt" = ?`
	args := []any{in.Status, encoded}
	if in.Status == "Resolved" {
		query += `, "resolvedAt" = ?`
		args = append(args, encoded)
	}
	query += ` WHERE id = ?`
	args = append(args, in.IncidentID)

	if _, err := tx.ExecContext(ctx, s.q(query), args...); err != nil {
		return Incident{}, fmt.Errorf("store: update incident status: update incident: %w", err)
	}

	if _, err := tx.ExecContext(ctx, s.q(`
		INSERT INTO incident_update (id, "incidentId", status, message, "authorId", "createdAt")
		VALUES (?, ?, ?, ?, ?, ?)
	`), ids.New(), in.IncidentID, in.Status, in.Message, in.AuthorID, encoded); err != nil {
		return Incident{}, fmt.Errorf("store: update incident status: insert incident_update: %w", err)
	}

	var incident Incident
	var monitorID sql.NullString
	if err := tx.QueryRowContext(ctx, s.q(`SELECT id, title, status, "monitorId" FROM incident WHERE id = ?`), in.IncidentID).
		Scan(&incident.ID, &incident.Title, &incident.Status, &monitorID); err != nil {
		return Incident{}, fmt.Errorf("store: update incident status: read back: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return Incident{}, fmt.Errorf("store: update incident status: commit: %w", err)
	}

	if monitorID.Valid {
		incident.MonitorID = &monitorID.String
		ref, err := s.GetMonitorRef(ctx, monitorID.String)
		if err != nil {
			return Incident{}, err
		}
		incident.Monitor = ref
	}
	return incident, nil
}

// IncidentSubscriberEmails mirrors `prisma.incidentSubscriber.findMany({
// where: { incidentId } })` in notifySubscribers().
func (s *Store) IncidentSubscriberEmails(ctx context.Context, incidentID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, s.q(`SELECT email FROM incident_subscriber WHERE "incidentId" = ?`), incidentID)
	if err != nil {
		return nil, fmt.Errorf("store: incident subscriber emails: %w", err)
	}
	defer rows.Close()

	var emails []string
	for rows.Next() {
		var email string
		if err := rows.Scan(&email); err != nil {
			return nil, fmt.Errorf("store: scan incident subscriber email: %w", err)
		}
		emails = append(emails, email)
	}
	return emails, rows.Err()
}

// StatusPageSubscribersForMonitor mirrors notifyStatusPageSubscribers()'s
// query in src/lib/incidents.ts: every subscriber of a published status page
// that includes this monitor, de-duplicated by (channel, target).
func (s *Store) StatusPageSubscribersForMonitor(ctx context.Context, monitorID string) ([]StatusPageSubscriber, error) {
	rows, err := s.db.QueryContext(ctx, s.q(`
		SELECT DISTINCT sub.channel, sub.target
		FROM status_page_monitor spm
		JOIN status_page sp ON sp.id = spm."statusPageId"
		JOIN status_page_subscriber sub ON sub."statusPageId" = sp.id
		WHERE spm."monitorId" = ? AND sp."isPublished" = ?
	`), monitorID, s.db.BoolArg(true))
	if err != nil {
		return nil, fmt.Errorf("store: status page subscribers for monitor: %w", err)
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

// OverdueEscalationCandidates mirrors the `prisma.incident.findMany(...)`
// query in escalateOverdueIncidents(): every open, unacknowledged incident
// whose monitor has an escalation policy attached.
func (s *Store) OverdueEscalationCandidates(ctx context.Context) ([]Incident, error) {
	rows, err := s.db.QueryContext(ctx, s.q(`
		SELECT i.id, i.title, i.status, i."escalationStep", i."lastEscalatedAt", i."createdAt",
		       m.id, m.name, m."escalationPolicyId"
		FROM incident i
		JOIN monitor m ON m.id = i."monitorId"
		WHERE i.status != 'Resolved' AND i."acknowledgedAt" IS NULL AND m."escalationPolicyId" IS NOT NULL
	`))
	if err != nil {
		return nil, fmt.Errorf("store: overdue escalation candidates: %w", err)
	}
	defer rows.Close()

	var incidents []Incident
	for rows.Next() {
		var inc Incident
		var lastEscalatedAt sql.NullTime
		var monitorRef IncidentMonitorRef
		var escalationPolicyID sql.NullString

		if err := rows.Scan(&inc.ID, &inc.Title, &inc.Status, &inc.EscalationStep, &lastEscalatedAt, &inc.CreatedAt,
			&monitorRef.ID, &monitorRef.Name, &escalationPolicyID); err != nil {
			return nil, fmt.Errorf("store: scan overdue escalation candidate: %w", err)
		}
		if lastEscalatedAt.Valid {
			t := lastEscalatedAt.Time
			inc.LastEscalatedAt = &t
		}
		if escalationPolicyID.Valid {
			id := escalationPolicyID.String
			monitorRef.EscalationPolicyID = &id
		}
		inc.MonitorID = &monitorRef.ID
		inc.Monitor = &monitorRef
		incidents = append(incidents, inc)
	}
	return incidents, rows.Err()
}

// EscalationSteps mirrors the ordered `escalation_step` (joined with
// `integration`) include in escalateOverdueIncidents().
func (s *Store) EscalationSteps(ctx context.Context, policyID string) ([]EscalationStep, error) {
	rows, err := s.db.QueryContext(ctx, s.q(`
		SELECT es."order", es."delayMinutes", es."integrationId",
		       integ.name, integ.type, integ.target, integ.secret, integ.enabled
		FROM escalation_step es
		JOIN integration integ ON integ.id = es."integrationId"
		WHERE es."escalationPolicyId" = ?
		ORDER BY es."order" ASC
	`), policyID)
	if err != nil {
		return nil, fmt.Errorf("store: escalation steps: %w", err)
	}
	defer rows.Close()

	var steps []EscalationStep
	for rows.Next() {
		var step EscalationStep
		var secret sql.NullString
		var enabled db.Bool
		if err := rows.Scan(&step.Order, &step.DelayMinutes, &step.IntegrationID,
			&step.Integration.Name, &step.Integration.Type, &step.Integration.Target, &secret, &enabled); err != nil {
			return nil, fmt.Errorf("store: scan escalation step: %w", err)
		}
		step.Integration.ID = step.IntegrationID
		if secret.Valid {
			step.Integration.Secret = &secret.String
		}
		step.Integration.Enabled = bool(enabled)
		steps = append(steps, step)
	}
	return steps, rows.Err()
}

// RecordEscalation mirrors the `prisma.incident.update({ data: {
// escalationStep: { increment: 1 }, lastEscalatedAt } })` call in
// escalateOverdueIncidents().
func (s *Store) RecordEscalation(ctx context.Context, incidentID string, now time.Time) error {
	encoded := s.db.TimeArg(now)
	_, err := s.db.ExecContext(ctx, s.q(`
		UPDATE incident SET "escalationStep" = "escalationStep" + 1, "lastEscalatedAt" = ?, "updatedAt" = ? WHERE id = ?
	`), encoded, encoded, incidentID)
	if err != nil {
		return fmt.Errorf("store: record escalation: %w", err)
	}
	return nil
}

// AlertForIncident loads one incident joined with its monitor — the detail a
// Discord embed renders beside the message (internal/notify's
// BuildAlertEmbed). Returns (nil, nil) when the incident is gone, which is
// normal: a queued delivery outlives the incident it describes if someone
// deletes it, and an alert without fields is still worth sending.
//
// The monitor is a LEFT JOIN because an incident created by hand from the
// dashboard needn't be attached to one.
func (s *Store) AlertForIncident(ctx context.Context, incidentID string) (*IncidentAlert, error) {
	var alert IncidentAlert
	var monitorName, monitorType, monitorURL, monitorStatus sql.NullString
	var responseTime sql.NullInt64
	var uptime sql.NullFloat64
	var lastCheckedAt sql.NullTime

	err := s.queryRow(ctx, `
		SELECT i.id, i.status, i.impact,
		       m.name, m.type, m.url, m.status, m."responseTime", m.uptime, m."lastCheckedAt"
		FROM incident i
		LEFT JOIN monitor m ON m.id = i."monitorId"
		WHERE i.id = ?
	`, incidentID).Scan(&alert.IncidentID, &alert.IncidentStatus, &alert.IncidentImpact,
		&monitorName, &monitorType, &monitorURL, &monitorStatus, &responseTime, &uptime, &lastCheckedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("store: alert for incident: %w", err)
	}

	alert.MonitorName = nullString(monitorName)
	alert.MonitorType = nullString(monitorType)
	alert.MonitorURL = nullString(monitorURL)
	alert.MonitorStatus = nullString(monitorStatus)
	if responseTime.Valid {
		ms := int(responseTime.Int64)
		alert.ResponseTimeMs = &ms
	}
	if uptime.Valid {
		pct := uptime.Float64
		alert.Uptime = &pct
	}
	if lastCheckedAt.Valid {
		t := lastCheckedAt.Time
		alert.LastCheckedAt = &t
	}
	return &alert, nil
}
