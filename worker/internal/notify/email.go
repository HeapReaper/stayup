// Package notify sends outbound notifications: email (SMTP), Discord
// webhooks, and browser push — mirrors src/lib/email.ts, src/lib/discord.ts,
// and src/lib/push.ts.
package notify

import (
	"crypto/tls"
	"fmt"
	"html/template"
	"strings"

	mail "github.com/wneessen/go-mail"

	"stayup/worker/internal/logging"
)

// The one port that speaks TLS from the first byte; every other port starts
// in the clear and upgrades with STARTTLS.
const implicitTLSPort = 465

// SMTPConfig is the resolved mail server for one send — the Settings page's
// SMTP block merged over the SMTP_* environment variables. Built by
// internal/settings (Settings.SMTP), mirroring resolveSmtpConfig() in
// src/lib/email.ts so the workers and the dashboard mail through the same
// server with the same TLS posture.
type SMTPConfig struct {
	Host      string
	Port      int
	User      string
	Pass      string
	FromEmail string
	FromName  string
	// UseTLS makes STARTTLS mandatory rather than best-effort. Off is what a
	// plain internal relay that doesn't offer it needs.
	UseTLS bool
}

// SendEmail renders `tmpl` with `data` and sends it through `cfg` — mirrors
// sendEmail() in src/lib/email.ts.
func SendEmail(cfg SMTPConfig, to, subject string, tmpl *template.Template, data any) error {
	if cfg.Host == "" {
		err := fmt.Errorf("no SMTP host configured — set one under Settings → SMTP, or SMTP_HOST in .env")
		logging.Error(fmt.Sprintf("[Mail] Email to %s not sent", to), err)
		return err
	}
	if cfg.FromEmail == "" {
		err := fmt.Errorf("no sender address configured — set one under Settings → SMTP, or SMTP_FROM in .env")
		logging.Error(fmt.Sprintf("[Mail] Email to %s not sent", to), err)
		return err
	}

	var body strings.Builder
	if err := tmpl.Execute(&body, data); err != nil {
		return fmt.Errorf("notify: render email: %w", err)
	}

	msg := mail.NewMsg()
	if cfg.FromName != "" {
		if err := msg.FromFormat(cfg.FromName, cfg.FromEmail); err != nil {
			return fmt.Errorf("notify: invalid sender address: %w", err)
		}
	} else if err := msg.From(cfg.FromEmail); err != nil {
		return fmt.Errorf("notify: invalid sender address: %w", err)
	}
	if err := msg.To(to); err != nil {
		return fmt.Errorf("notify: invalid recipient: %w", err)
	}
	msg.Subject(subject)
	msg.SetBodyString(mail.TypeTextHTML, body.String())

	client, err := mail.NewClient(cfg.Host, clientOptions(cfg)...)
	if err != nil {
		return fmt.Errorf("notify: smtp client: %w", err)
	}

	if err := client.DialAndSend(msg); err != nil {
		logging.Error(fmt.Sprintf("[Mail] Email to %s via %s:%d failed", to, cfg.Host, cfg.Port), err)
		return err
	}

	logging.Info(fmt.Sprintf("[Mail] Email successfully sent to %s via %s:%d!", to, cfg.Host, cfg.Port))
	return nil
}

func clientOptions(cfg SMTPConfig) []mail.Option {
	opts := []mail.Option{
		mail.WithPort(cfg.Port),
		// Deliberately lenient, and mirrored by rejectUnauthorized: false in
		// src/lib/email.ts: self-hosted installs commonly relay through an
		// internal-CA or self-signed mail server.
		mail.WithTLSConfig(&tls.Config{InsecureSkipVerify: true}), //nolint:gosec // mirrors the TS side
	}

	if cfg.Port == implicitTLSPort {
		opts = append(opts, mail.WithSSL())
	} else if cfg.UseTLS {
		// Refuse to send rather than silently falling back to an unencrypted
		// session when the server doesn't offer STARTTLS.
		opts = append(opts, mail.WithTLSPolicy(mail.TLSMandatory))
	} else {
		opts = append(opts, mail.WithTLSPolicy(mail.TLSOpportunistic))
	}

	// Skipped entirely for an unauthenticated relay — AUTH with empty
	// credentials fails outright on most servers.
	if cfg.User != "" || cfg.Pass != "" {
		opts = append(opts,
			mail.WithSMTPAuth(mail.SMTPAuthAutoDiscover),
			mail.WithUsername(cfg.User),
			mail.WithPassword(cfg.Pass),
		)
	}

	return opts
}
