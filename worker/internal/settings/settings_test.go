package settings

import (
	"testing"

	"stayup/worker/internal/store"
)

func strPtr(s string) *string { return &s }
func intPtr(i int) *int       { return &i }

// The precedence resolveSMTP implements is the whole point of the Settings
// page's SMTP tab: what's stored there wins, field by field, and anything
// left blank falls back to the SMTP_* environment. It has to stay identical
// to resolveSmtpConfig() in src/lib/email.ts.
func TestResolveSMTPPrefersStoredOverEnv(t *testing.T) {
	t.Setenv("SMTP_HOST", "env.example.com")
	t.Setenv("SMTP_PORT", "25")
	t.Setenv("SMTP_USER", "env-user")
	t.Setenv("SMTP_PASS", "env-pass")
	t.Setenv("SMTP_FROM", "env@example.com")

	cfg := resolveSMTP(&store.AppSettings{
		SMTPHost:      strPtr("smtp.mailgun.org"),
		SMTPPort:      intPtr(587),
		SMTPUser:      strPtr("db-user"),
		SMTPPass:      strPtr("db-pass"),
		SMTPFromEmail: strPtr("alerts@acme.com"),
		SMTPFromName:  strPtr("Acme Status"),
		SMTPUseTLS:    true,
	})

	if cfg.Host != "smtp.mailgun.org" {
		t.Errorf("Host = %q, want the stored host", cfg.Host)
	}
	if cfg.Port != 587 {
		t.Errorf("Port = %d, want 587", cfg.Port)
	}
	if cfg.User != "db-user" || cfg.Pass != "db-pass" {
		t.Errorf("credentials = %q/%q, want the stored pair", cfg.User, cfg.Pass)
	}
	if cfg.FromEmail != "alerts@acme.com" || cfg.FromName != "Acme Status" {
		t.Errorf("sender = %q <%q>, want the stored pair", cfg.FromName, cfg.FromEmail)
	}
	if !cfg.UseTLS {
		t.Error("UseTLS = false, want true")
	}
}

// A row with the SMTP tab left untouched must behave exactly like the
// pre-settings install did: everything comes from .env.
func TestResolveSMTPFallsBackToEnv(t *testing.T) {
	t.Setenv("SMTP_HOST", "env.example.com")
	t.Setenv("SMTP_PORT", "2525")
	t.Setenv("SMTP_USER", "env-user")
	t.Setenv("SMTP_PASS", "env-pass")
	t.Setenv("SMTP_FROM", "env@example.com")

	cfg := resolveSMTP(&store.AppSettings{})

	if cfg.Host != "env.example.com" {
		t.Errorf("Host = %q, want the env host", cfg.Host)
	}
	if cfg.Port != 2525 {
		t.Errorf("Port = %d, want 2525", cfg.Port)
	}
	if cfg.User != "env-user" || cfg.Pass != "env-pass" {
		t.Errorf("credentials = %q/%q, want the env pair", cfg.User, cfg.Pass)
	}
	if cfg.FromEmail != "env@example.com" {
		t.Errorf("FromEmail = %q, want the env sender", cfg.FromEmail)
	}
	if cfg.FromName != "" {
		t.Errorf("FromName = %q, want empty — there is no env var for it", cfg.FromName)
	}
}

// Blank is not a value: an empty string in the column means "not configured",
// same as pick() treating a whitespace-only setting as unset on the TS side.
func TestResolveSMTPTreatsBlankStoredFieldsAsUnset(t *testing.T) {
	t.Setenv("SMTP_HOST", "env.example.com")
	t.Setenv("SMTP_USER", "env-user")

	cfg := resolveSMTP(&store.AppSettings{
		SMTPHost: strPtr("   "),
		SMTPUser: strPtr(""),
	})

	if cfg.Host != "env.example.com" {
		t.Errorf("Host = %q, want the env host to win over a blank setting", cfg.Host)
	}
	if cfg.User != "env-user" {
		t.Errorf("User = %q, want the env user to win over a blank setting", cfg.User)
	}
}

func TestResolveSMTPPortDefault(t *testing.T) {
	t.Setenv("SMTP_PORT", "")

	if got := resolveSMTP(&store.AppSettings{}).Port; got != defaultSMTPPort {
		t.Errorf("Port = %d, want the %d default when neither the row nor the env sets one", got, defaultSMTPPort)
	}

	// A hand-edited 0 in the column is not a port either.
	if got := resolveSMTP(&store.AppSettings{SMTPPort: intPtr(0)}).Port; got != defaultSMTPPort {
		t.Errorf("Port = %d, want the %d default for a zero column", got, defaultSMTPPort)
	}
}
