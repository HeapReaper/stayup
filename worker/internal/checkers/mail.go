package checkers

import (
	"bufio"
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"

	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
)

// Implicit-TLS ports: the connection is TLS from the first byte on these,
// while every other port starts in the clear.
const (
	smtpsPort  = 465
	imapsPort  = 993
	smtpPort   = 25
	imapPort   = 143
	tlsTimeout = 10 * time.Second
)

// SMTP completes a real SMTP conversation: greeting, EHLO, NOOP, QUIT. A mail
// server that accepts the TCP connection but never issues a 220 greeting —
// the usual shape of an overloaded or half-started MTA — fails here and would
// pass a port check.
func SMTP(ctx context.Context, cfg settings.Settings, monitor store.Monitor) store.CheckResult {
	started := time.Now()

	port := portOr(monitor, smtpPort)
	conn, err := dialFor(ctx, cfg, monitor, smtpPort, port == smtpsPort)
	if err != nil {
		return downResult(started, err)
	}
	defer conn.Close()

	_ = conn.SetDeadline(time.Now().Add(time.Duration(cfg.HTTPTimeoutSecs) * time.Second))

	// smtp.NewClient reads and validates the 220 greeting itself.
	client, err := smtp.NewClient(conn, hostOf(monitor.URL))
	if err != nil {
		return downResult(started, err)
	}
	defer client.Close()

	if err := client.Hello("stayup-monitor"); err != nil {
		return downResult(started, err)
	}
	if err := client.Noop(); err != nil {
		return downResult(started, err)
	}
	_ = client.Quit()

	return gradedResult(cfg, started)
}

// IMAP reads the server's untagged greeting and logs out again. As with
// MySQL, no credentials: an IMAP server announces itself before it asks who
// you are, and "did it announce itself" is the uptime question.
func IMAP(ctx context.Context, cfg settings.Settings, monitor store.Monitor) store.CheckResult {
	started := time.Now()

	port := portOr(monitor, imapPort)
	conn, err := dialFor(ctx, cfg, monitor, imapPort, port == imapsPort)
	if err != nil {
		return downResult(started, err)
	}
	defer conn.Close()

	_ = conn.SetDeadline(time.Now().Add(time.Duration(cfg.HTTPTimeoutSecs) * time.Second))

	greeting, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil {
		return downResult(started, fmt.Errorf("no IMAP greeting: %w", err))
	}

	trimmed := strings.TrimSpace(greeting)
	switch {
	case strings.HasPrefix(trimmed, "* OK"):
		// Nothing to do — this is the healthy greeting.
	case strings.HasPrefix(trimmed, "* BYE"):
		// A server that greets and immediately hangs up (connection limit,
		// shutting down) is not serving mail.
		return downMessage(started, "IMAP server refused the connection: "+trimmed)
	default:
		return downMessage(started, "Unexpected IMAP greeting: "+trimmed)
	}

	_, _ = conn.Write([]byte("a001 LOGOUT\r\n"))
	return gradedResult(cfg, started)
}

func portOr(monitor store.Monitor, fallback int) int {
	if monitor.Port != nil && *monitor.Port > 0 {
		return *monitor.Port
	}
	return fallback
}

// tlsDial opens a TLS connection, honouring the Settings page's "SSL/TLS
// Certificate Check" switch the same way the HTTP checker does — off is how
// you monitor an internal host with a self-signed certificate.
func tlsDial(ctx context.Context, dialer *net.Dialer, address string, cfg settings.Settings) (net.Conn, error) {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		host = address
	}

	tlsDialer := &tls.Dialer{
		NetDialer: dialer,
		Config: &tls.Config{
			ServerName:         host,
			InsecureSkipVerify: !cfg.SSLCheckEnabled, // #nosec G402 — deliberate, see settings.SSLCheckEnabled
		},
	}
	return tlsDialer.DialContext(ctx, "tcp", address)
}
