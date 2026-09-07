package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"stayup/worker/internal/db"
)

// GetSettings mirrors `prisma.appSettings.findUnique({ where: { id:
// 'singleton' } })`. Returns (nil, nil) if the row doesn't exist yet.
func (s *Store) GetSettings(ctx context.Context) (*AppSettings, error) {
	var settings AppSettings
	var supportEmail, vapidPub, vapidPriv sql.NullString
	var sslCheckEnabled, certExpiryWarningEnabled db.Bool

	err := s.queryRow(ctx, `
		SELECT id, "supportEmail", "httpTimeoutSeconds", "failedAttemptsThreshold", "latencyThresholdMs",
		       "sslCheckEnabled", "certExpiryWarningEnabled", "certExpiryWarningDays",
		       "checkRetentionDays", "deliveryRetentionDays", "vapidPublicKey", "vapidPrivateKey"
		FROM app_settings
		WHERE id = 'singleton'
	`).Scan(&settings.ID, &supportEmail, &settings.HTTPTimeoutSecs, &settings.FailedAttemptsThreshold, &settings.LatencyThreshold,
		&sslCheckEnabled, &certExpiryWarningEnabled, &settings.CertExpiryWarningDays,
		&settings.CheckRetentionDays, &settings.DeliveryRetentionDays, &vapidPub, &vapidPriv)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("store: get settings: %w", err)
	}

	settings.SSLCheckEnabled = bool(sslCheckEnabled)
	settings.CertExpiryWarningEnabled = bool(certExpiryWarningEnabled)

	if supportEmail.Valid {
		settings.SupportEmail = &supportEmail.String
	}
	if vapidPub.Valid {
		settings.VapidPublicKey = &vapidPub.String
	}
	if vapidPriv.Valid {
		settings.VapidPrivateKey = &vapidPriv.String
	}
	return &settings, nil
}

// CreateSettingsInput is everything CreateSettings needs to insert the
// singleton row on first use — mirrors the `prisma.appSettings.create(...)`
// call in getSettings() (src/lib/settings.ts).
type CreateSettingsInput struct {
	APIKey               string
	WebhookSigningSecret string
	VapidPublicKey       string
	VapidPrivateKey      string
	Now                  time.Time
}

// CreateSettings inserts the singleton `app_settings` row if it doesn't
// already exist (lost races are expected — a concurrent worker/the Next.js
// app may have just created it — so this uses INSERT ... ON CONFLICT/OR
// IGNORE rather than erroring). Callers should always follow up with
// GetSettings to read back whichever row actually won.
func (s *Store) CreateSettings(ctx context.Context, in CreateSettingsInput) error {
	var query string
	switch s.db.Provider {
	case db.Postgres:
		query = `
			INSERT INTO app_settings (id, "apiKey", "webhookSigningSecret", "vapidPublicKey", "vapidPrivateKey", "updatedAt")
			VALUES ('singleton', ?, ?, ?, ?, ?)
			ON CONFLICT (id) DO NOTHING
		`
	default:
		query = `
			INSERT OR IGNORE INTO app_settings (id, "apiKey", "webhookSigningSecret", "vapidPublicKey", "vapidPrivateKey", "updatedAt")
			VALUES ('singleton', ?, ?, ?, ?, ?)
		`
	}

	_, err := s.db.ExecContext(ctx, s.q(query), in.APIKey, in.WebhookSigningSecret, in.VapidPublicKey, in.VapidPrivateKey, s.db.TimeArg(in.Now))
	if err != nil {
		return fmt.Errorf("store: create settings: %w", err)
	}
	return nil
}

// BackfillVapidKeys mirrors backfillVapidKeys() in src/lib/settings.ts —
// persists a freshly generated VAPID key pair onto the singleton row for
// settings created before the Push integration channel existed.
func (s *Store) BackfillVapidKeys(ctx context.Context, publicKey, privateKey string, now time.Time) error {
	_, err := s.db.ExecContext(ctx, s.q(`
		UPDATE app_settings SET "vapidPublicKey" = ?, "vapidPrivateKey" = ?, "updatedAt" = ? WHERE id = 'singleton'
	`), publicKey, privateKey, s.db.TimeArg(now))
	if err != nil {
		return fmt.Errorf("store: backfill vapid keys: %w", err)
	}
	return nil
}
