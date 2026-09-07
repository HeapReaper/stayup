// Package settings mirrors src/lib/settings.ts: fetches the single
// instance-wide `app_settings` row, creating it (with a generated API key,
// webhook secret, and VAPID key pair) on first use, and lazily backfilling
// VAPID keys onto rows created before the Push integration channel existed.
package settings

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"stayup/worker/internal/store"
)

type Settings struct {
	SupportEmail    *string
	HTTPTimeoutSecs int
	// How many checks in a row must fail before a monitor is reported as
	// Down/Degraded — the Settings page's "Failed Attempts Before Alert".
	// Always >= 1; 1 means "alert on the first failed check".
	FailedAttemptsThreshold int
	LatencyThreshold        int
	// SSLCheckEnabled off tells the HTTP checker to skip TLS verification
	// entirely, so a self-signed or expired certificate no longer fails the
	// check by itself (internal/checkers/http.go).
	SSLCheckEnabled bool
	// CertExpiryWarningEnabled on makes an HTTPS monitor report Degraded once
	// its certificate is within CertExpiryWarningDays of expiring.
	CertExpiryWarningEnabled bool
	CertExpiryWarningDays    int
	// Retention windows enforced by cmd/janitor, in days.
	CheckRetentionDays    int
	DeliveryRetentionDays int
	VapidPublicKey        string
	VapidPrivateKey       string
}

// atLeast returns value when it's >= min, and fallback otherwise.
func atLeast(value, min, fallback int) int {
	if value < min {
		return fallback
	}
	return value
}

func generateAPIKey() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "up_live_" + hex.EncodeToString(b), nil
}

func generateWebhookSecret() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "whsec_" + hex.EncodeToString(b), nil
}

// Get returns the singleton app_settings row, creating it (and/or
// backfilling its VAPID keys) if needed — mirrors getSettings() +
// backfillVapidKeys() in src/lib/settings.ts.
func Get(ctx context.Context, s *store.Store) (Settings, error) {
	row, err := s.GetSettings(ctx)
	if err != nil {
		return Settings{}, err
	}

	if row == nil {
		row, err = create(ctx, s)
		if err != nil {
			return Settings{}, err
		}
	}

	if row.VapidPublicKey == nil || row.VapidPrivateKey == nil {
		privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
		if err != nil {
			return Settings{}, fmt.Errorf("settings: generate vapid keys: %w", err)
		}
		if err := s.BackfillVapidKeys(ctx, publicKey, privateKey, time.Now()); err != nil {
			return Settings{}, err
		}
		row.VapidPublicKey = &publicKey
		row.VapidPrivateKey = &privateKey
	}

	// Rows written before the column had a default (or hand-edited to 0)
	// would otherwise disable checking entirely, so floor it at 1.
	threshold := row.FailedAttemptsThreshold
	if threshold < 1 {
		threshold = 1
	}

	return Settings{
		SupportEmail:            row.SupportEmail,
		HTTPTimeoutSecs:         row.HTTPTimeoutSecs,
		FailedAttemptsThreshold: threshold,
		LatencyThreshold:        row.LatencyThreshold,
		SSLCheckEnabled:         row.SSLCheckEnabled,
		// Same floor-it reasoning as the threshold above: a 0 here would mean
		// "warn about every certificate" / "delete everything", so fall back
		// to the schema defaults rather than trusting a hand-edited row.
		CertExpiryWarningEnabled: row.CertExpiryWarningEnabled,
		CertExpiryWarningDays:    atLeast(row.CertExpiryWarningDays, 1, 14),
		CheckRetentionDays:       atLeast(row.CheckRetentionDays, 1, 90),
		DeliveryRetentionDays:    atLeast(row.DeliveryRetentionDays, 1, 30),
		VapidPublicKey:           *row.VapidPublicKey,
		VapidPrivateKey:          *row.VapidPrivateKey,
	}, nil
}

// create inserts the singleton row, tolerating a lost race against another
// worker/the Next.js app doing the same thing — mirrors getSettings()'s
// try/catch-and-reread fallback.
func create(ctx context.Context, s *store.Store) (*store.AppSettings, error) {
	apiKey, err := generateAPIKey()
	if err != nil {
		return nil, fmt.Errorf("settings: generate api key: %w", err)
	}
	webhookSecret, err := generateWebhookSecret()
	if err != nil {
		return nil, fmt.Errorf("settings: generate webhook secret: %w", err)
	}
	privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		return nil, fmt.Errorf("settings: generate vapid keys: %w", err)
	}

	if err := s.CreateSettings(ctx, store.CreateSettingsInput{
		APIKey:               apiKey,
		WebhookSigningSecret: webhookSecret,
		VapidPublicKey:       publicKey,
		VapidPrivateKey:      privateKey,
		Now:                  time.Now(),
	}); err != nil {
		return nil, err
	}

	row, err := s.GetSettings(ctx)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, fmt.Errorf("settings: failed to load or create app settings")
	}
	return row, nil
}
