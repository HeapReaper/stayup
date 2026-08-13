// Package notify sends outbound notifications: email (SMTP), Discord
// webhooks, and browser push — mirrors src/lib/email.ts, src/lib/discord.ts,
// and src/lib/push.ts.
package notify

import (
	"crypto/tls"
	"fmt"
	"html/template"
	"os"
	"strconv"
	"strings"

	mail "github.com/wneessen/go-mail"

	"stayup/worker/internal/logging"
)

// SendEmail renders `tmpl` with `data` and sends it via the SMTP server
// configured through SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM —
// mirrors sendEmail() in src/lib/email.ts (same envs, same
// secure:false+opportunistic-STARTTLS+skip-cert-verification posture).
func SendEmail(to, subject string, tmpl *template.Template, data any) error {
	var body strings.Builder
	if err := tmpl.Execute(&body, data); err != nil {
		return fmt.Errorf("notify: render email: %w", err)
	}

	msg := mail.NewMsg()
	if err := msg.From(os.Getenv("SMTP_FROM")); err != nil {
		return fmt.Errorf("notify: invalid SMTP_FROM: %w", err)
	}
	if err := msg.To(to); err != nil {
		return fmt.Errorf("notify: invalid recipient: %w", err)
	}
	msg.Subject(subject)
	msg.SetBodyString(mail.TypeTextHTML, body.String())

	port, _ := strconv.Atoi(os.Getenv("SMTP_PORT"))
	if port == 0 {
		port = 587
	}

	client, err := mail.NewClient(os.Getenv("SMTP_HOST"),
		mail.WithPort(port),
		mail.WithTLSPolicy(mail.TLSOpportunistic),
		mail.WithTLSConfig(&tls.Config{InsecureSkipVerify: true}), //nolint:gosec // mirrors the TS side's rejectUnauthorized: false
		mail.WithSMTPAuth(mail.SMTPAuthAutoDiscover),
		mail.WithUsername(os.Getenv("SMTP_USER")),
		mail.WithPassword(os.Getenv("SMTP_PASS")),
	)
	if err != nil {
		return fmt.Errorf("notify: smtp client: %w", err)
	}

	if err := client.DialAndSend(msg); err != nil {
		logging.Error(fmt.Sprintf("[Mail] Email to %s failed", to), err)
		return err
	}

	logging.Info(fmt.Sprintf("[Mail] Email successfully sent to %s!", to))
	return nil
}
