package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"stayup/worker/internal/db"
	"stayup/worker/internal/ids"
)

// ListEnabledIntegrations mirrors `prisma.integration.findMany({ where: {
// enabled: true } })` in queueIntegrationDeliveries().
func (s *Store) ListEnabledIntegrations(ctx context.Context) ([]Integration, error) {
	rows, err := s.db.QueryContext(ctx, s.q(`
		SELECT id, name, type, target, secret, enabled FROM integration WHERE enabled = ?
	`), s.db.BoolArg(true))
	if err != nil {
		return nil, fmt.Errorf("store: list enabled integrations: %w", err)
	}
	defer rows.Close()

	var out []Integration
	for rows.Next() {
		var integ Integration
		var secret sql.NullString
		var enabled db.Bool
		if err := rows.Scan(&integ.ID, &integ.Name, &integ.Type, &integ.Target, &secret, &enabled); err != nil {
			return nil, fmt.Errorf("store: scan integration: %w", err)
		}
		if secret.Valid {
			integ.Secret = &secret.String
		}
		integ.Enabled = bool(enabled)
		out = append(out, integ)
	}
	return out, rows.Err()
}

// CreateDeliveries mirrors `prisma.integrationDelivery.createMany(...)` in
// queueIntegrationDeliveries() — one Pending row per integration, all
// broadcasting the same incident/event/message.
func (s *Store) CreateDeliveries(ctx context.Context, integrationIDs []string, incidentID, event, message string) error {
	if len(integrationIDs) == 0 {
		return nil
	}

	now := s.db.TimeArg(time.Now())
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: create deliveries: begin tx: %w", err)
	}
	defer tx.Rollback()

	for _, integrationID := range integrationIDs {
		if _, err := tx.ExecContext(ctx, s.q(`
			INSERT INTO integration_delivery (id, "integrationId", "incidentId", event, message, status, attempts, "createdAt")
			VALUES (?, ?, ?, ?, ?, 'Pending', 0, ?)
		`), ids.New(), integrationID, incidentID, event, message, now); err != nil {
			return fmt.Errorf("store: create deliveries: insert: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("store: create deliveries: commit: %w", err)
	}
	return nil
}

// CreateEscalationDelivery mirrors the single `prisma.integrationDelivery.create(...)`
// call in escalateOverdueIncidents().
func (s *Store) CreateEscalationDelivery(ctx context.Context, integrationID, incidentID, event, message string) error {
	_, err := s.db.ExecContext(ctx, s.q(`
		INSERT INTO integration_delivery (id, "integrationId", "incidentId", event, message, status, attempts, "createdAt")
		VALUES (?, ?, ?, ?, ?, 'Pending', 0, ?)
	`), ids.New(), integrationID, incidentID, event, message, s.db.TimeArg(time.Now()))
	if err != nil {
		return fmt.Errorf("store: create escalation delivery: %w", err)
	}
	return nil
}

// ListPendingDeliveries mirrors the `prisma.integrationDelivery.findMany({
// where: { status: 'Pending' }, orderBy: { createdAt: 'asc' }, take,
// include: { integration: true } })` call in the integrations worker's tick().
func (s *Store) ListPendingDeliveries(ctx context.Context, limit int) ([]IntegrationDelivery, error) {
	rows, err := s.db.QueryContext(ctx, s.q(`
		SELECT d.id, d."integrationId", d.event, d.message, d.attempts,
		       integ.id, integ.name, integ.type, integ.target, integ.secret, integ.enabled
		FROM integration_delivery d
		JOIN integration integ ON integ.id = d."integrationId"
		WHERE d.status = 'Pending'
		ORDER BY d."createdAt" ASC
		LIMIT ?
	`), limit)
	if err != nil {
		return nil, fmt.Errorf("store: list pending deliveries: %w", err)
	}
	defer rows.Close()

	var out []IntegrationDelivery
	for rows.Next() {
		var d IntegrationDelivery
		var secret sql.NullString
		var enabled db.Bool
		if err := rows.Scan(&d.ID, &d.IntegrationID, &d.Event, &d.Message, &d.Attempts,
			&d.Integration.ID, &d.Integration.Name, &d.Integration.Type, &d.Integration.Target, &secret, &enabled); err != nil {
			return nil, fmt.Errorf("store: scan pending delivery: %w", err)
		}
		if secret.Valid {
			d.Integration.Secret = &secret.String
		}
		d.Integration.Enabled = bool(enabled)
		out = append(out, d)
	}
	return out, rows.Err()
}

// MarkDeliverySent mirrors the "success" branch of processDelivery() in
// src/workers/integrations.ts.
func (s *Store) MarkDeliverySent(ctx context.Context, deliveryID string, attempts int) error {
	now := s.db.TimeArg(time.Now())
	_, err := s.db.ExecContext(ctx, s.q(`
		UPDATE integration_delivery SET status = 'Sent', attempts = ?, "sentAt" = ?, error = NULL WHERE id = ?
	`), attempts, now, deliveryID)
	if err != nil {
		return fmt.Errorf("store: mark delivery sent: %w", err)
	}
	return nil
}

// MarkDeliveryFailed mirrors the "gave up after MAX_ATTEMPTS" branch.
func (s *Store) MarkDeliveryFailed(ctx context.Context, deliveryID string, attempts int, errMsg string) error {
	_, err := s.db.ExecContext(ctx, s.q(`
		UPDATE integration_delivery SET status = 'Failed', attempts = ?, error = ? WHERE id = ?
	`), attempts, errMsg, deliveryID)
	if err != nil {
		return fmt.Errorf("store: mark delivery failed: %w", err)
	}
	return nil
}

// RecordDeliveryAttempt mirrors the "still Pending, will retry" branch —
// bumps attempts/error without changing status.
func (s *Store) RecordDeliveryAttempt(ctx context.Context, deliveryID string, attempts int, errMsg string) error {
	_, err := s.db.ExecContext(ctx, s.q(`
		UPDATE integration_delivery SET attempts = ?, error = ? WHERE id = ?
	`), attempts, errMsg, deliveryID)
	if err != nil {
		return fmt.Errorf("store: record delivery attempt: %w", err)
	}
	return nil
}
