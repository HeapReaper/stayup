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
	var smtpHost, smtpUser, smtpPass, smtpFromEmail, smtpFromName sql.NullString
	var smtpPort sql.NullInt64
	var sslCheckEnabled, certExpiryWarningEnabled, updateCheckEnabled, smtpUseTLS db.Bool
	var domainExpiryWarningEnabled, flappingEnabled db.Bool

	err := s.queryRow(ctx, `
		SELECT id, timezone, "supportEmail", "httpTimeoutSeconds", "failedAttemptsThreshold", "latencyThresholdMs",
		       "sslCheckEnabled", "certExpiryWarningEnabled", "certExpiryWarningDays",
		       "checkRetentionDays", "deliveryRetentionDays", "vapidPublicKey", "vapidPrivateKey",
		       "updateCheckEnabled",
		       "smtpHost", "smtpPort", "smtpUser", "smtpPass", "smtpFromEmail", "smtpFromName", "smtpUseTls",
		       "domainExpiryWarningEnabled", "domainExpiryWarningDays",
		       "flappingEnabled", "flappingWindowMinutes", "flappingThreshold"
		FROM app_settings
		WHERE id = 'singleton'
	`).Scan(&settings.ID, &settings.Timezone, &supportEmail, &settings.HTTPTimeoutSecs, &settings.FailedAttemptsThreshold, &settings.LatencyThreshold,
		&sslCheckEnabled, &certExpiryWarningEnabled, &settings.CertExpiryWarningDays,
		&settings.CheckRetentionDays, &settings.DeliveryRetentionDays, &vapidPub, &vapidPriv,
		&updateCheckEnabled,
		&smtpHost, &smtpPort, &smtpUser, &smtpPass, &smtpFromEmail, &smtpFromName, &smtpUseTLS,
		&domainExpiryWarningEnabled, &settings.DomainExpiryWarningDays,
		&flappingEnabled, &settings.FlappingWindowMinutes, &settings.FlappingThreshold)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("store: get settings: %w", err)
	}

	settings.SSLCheckEnabled = bool(sslCheckEnabled)
	settings.CertExpiryWarningEnabled = bool(certExpiryWarningEnabled)
	settings.UpdateCheckEnabled = bool(updateCheckEnabled)
	settings.SMTPUseTLS = bool(smtpUseTLS)
	settings.DomainExpiryWarningEnabled = bool(domainExpiryWarningEnabled)
	settings.FlappingEnabled = bool(flappingEnabled)

	if supportEmail.Valid {
		settings.SupportEmail = &supportEmail.String
	}
	if vapidPub.Valid {
		settings.VapidPublicKey = &vapidPub.String
	}
	if vapidPriv.Valid {
		settings.VapidPrivateKey = &vapidPriv.String
	}
	settings.SMTPHost = nullString(smtpHost)
	settings.SMTPUser = nullString(smtpUser)
	settings.SMTPPass = nullString(smtpPass)
	settings.SMTPFromEmail = nullString(smtpFromEmail)
	settings.SMTPFromName = nullString(smtpFromName)
	if smtpPort.Valid {
		port := int(smtpPort.Int64)
		settings.SMTPPort = &port
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

// UpdateCheck is one successful update check's findings, as written by
// SaveUpdateCheck.
type UpdateCheck struct {
	LatestVersion string
	URL           *string
	PublishedAt   *time.Time
	CheckedAt     time.Time
}

// SaveUpdateCheck records what the newest published version is and clears any
// previous failure — mirrors the success branch of checkForUpdates() in
// src/lib/updates.ts. `updatedAt` is bumped because Prisma's @updatedAt does
// the same on the TypeScript side, and the two must not diverge.
func (s *Store) SaveUpdateCheck(ctx context.Context, in UpdateCheck) error {
	_, err := s.db.ExecContext(ctx, s.q(`
		UPDATE app_settings
		SET "latestVersion" = ?, "latestVersionUrl" = ?, "latestVersionPublishedAt" = ?,
		    "lastUpdateCheckAt" = ?, "lastUpdateCheckError" = NULL, "updatedAt" = ?
		WHERE id = 'singleton'
	`), in.LatestVersion, in.URL, s.db.NullTimeArg(in.PublishedAt), s.db.TimeArg(in.CheckedAt), s.db.TimeArg(in.CheckedAt))
	if err != nil {
		return fmt.Errorf("store: save update check: %w", err)
	}
	return nil
}

// SaveUpdateCheckError records that a check ran and failed, deliberately
// leaving the last known latestVersion in place — mirrors the catch branch of
// checkForUpdates(). Without the timestamp+reason pair the Updates tab would
// present stale data as if it were current.
func (s *Store) SaveUpdateCheckError(ctx context.Context, message string, checkedAt time.Time) error {
	_, err := s.db.ExecContext(ctx, s.q(`
		UPDATE app_settings
		SET "lastUpdateCheckAt" = ?, "lastUpdateCheckError" = ?, "updatedAt" = ?
		WHERE id = 'singleton'
	`), s.db.TimeArg(checkedAt), message, s.db.TimeArg(checkedAt))
	if err != nil {
		return fmt.Errorf("store: save update check error: %w", err)
	}
	return nil
}
