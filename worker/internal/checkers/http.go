// Package checkers implements the "how do I check one monitor" half of each
// monitor-check worker — one performCheck-equivalent function per monitor
// type, run by internal/runner. Mirrors src/workers/{https,port,ping,dns}.ts.
package checkers

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"stayup/worker/internal/logging"
	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
)

// How much of the response body is read when a monitor has a keyword
// assertion. Bodies are otherwise drained and discarded — a monitored page
// that streams megabytes shouldn't cost the worker memory, and a marker
// string that isn't in the first megabyte isn't a useful assertion anyway.
const maxKeywordBodyBytes = 1 << 20

// Two transports rather than two clients: the transport owns the connection
// pool, so building a fresh *http.Client per check (which the redirect policy
// forces — it's a client-level setting) stays free.
var (
	verifyingTransport = transportWith(false)
	insecureTransport  = transportWith(true)
)

func transportWith(skipVerify bool) *http.Transport {
	t := http.DefaultTransport.(*http.Transport).Clone()
	if skipVerify {
		// Deliberate, and off by default: this is the Settings page's
		// "SSL/TLS Certificate Check" switch turned off, which is how you
		// monitor a host with a self-signed or internal-CA certificate
		// without every check reporting Down.
		t.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} // #nosec G402
	}
	return t
}

func clientFor(cfg settings.Settings, monitor store.Monitor) *http.Client {
	client := &http.Client{Transport: verifyingTransport}
	if !cfg.SSLCheckEnabled {
		client.Transport = insecureTransport
	}
	if !monitor.FollowRedirects {
		// Return the redirect itself instead of following it, so a monitor
		// can assert on the 301/302 (via expectedStatusCodes) rather than on
		// wherever it points.
		client.CheckRedirect = func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}
	}
	return client
}

// HTTP performs one HTTP(s) check — mirrors performCheck() in
// src/workers/https.ts, plus the per-monitor request options (method,
// headers, body, redirect policy, accepted status codes, keyword assertion)
// and the TLS certificate expiry warning.
func HTTP(ctx context.Context, cfg settings.Settings, monitor store.Monitor) store.CheckResult {
	timeout := time.Duration(cfg.HTTPTimeoutSecs) * time.Second
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	started := time.Now()

	req, err := buildRequest(reqCtx, monitor)
	if err != nil {
		return downResult(started, err)
	}

	resp, err := clientFor(cfg, monitor).Do(req)
	responseTime := elapsedMs(started)
	if err != nil {
		return downResult(started, err)
	}
	defer resp.Body.Close()

	statusCode := resp.StatusCode
	certExpiresAt := peerCertExpiry(resp)

	body, err := readBodyFor(monitor, resp)
	if err != nil {
		msg := fmt.Sprintf("Failed to read response body: %s", err)
		return store.CheckResult{Status: "Down", StatusCode: &statusCode, ResponseTime: responseTime, Message: &msg, CertExpiresAt: certExpiresAt}
	}

	down := func(message string) store.CheckResult {
		return store.CheckResult{Status: "Down", StatusCode: &statusCode, ResponseTime: responseTime, Message: &message, CertExpiresAt: certExpiresAt}
	}

	if !statusCodeAccepted(monitor.ExpectedStatusCodes, resp.StatusCode) {
		return down(unexpectedStatusMessage(monitor.ExpectedStatusCodes, resp.StatusCode))
	}

	if failure := assertionFailure(monitor.AssertionType, deref(monitor.Keyword), deref(monitor.JSONPath), monitor.KeywordInverted, body); failure != "" {
		return down(failure)
	}

	// Everything the monitor asserts on passed; what's left can only downgrade
	// it to Degraded, never to Down.
	status := "Up"
	var message *string

	if warning := certExpiryWarning(cfg, certExpiresAt); warning != "" {
		status = "Degraded"
		message = &warning
	} else if responseTime > cfg.LatencyThreshold {
		status = "Degraded"
	}

	return store.CheckResult{Status: status, StatusCode: &statusCode, ResponseTime: responseTime, Message: message, CertExpiresAt: certExpiresAt}
}

func buildRequest(ctx context.Context, monitor store.Monitor) (*http.Request, error) {
	method := strings.ToUpper(strings.TrimSpace(monitor.Method))
	if method == "" {
		method = http.MethodGet
	}

	var body io.Reader
	if monitor.RequestBody != nil && *monitor.RequestBody != "" {
		body = strings.NewReader(*monitor.RequestBody)
	}

	req, err := http.NewRequestWithContext(ctx, method, monitor.URL, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "StayUp-Monitor/1.0")

	// Validated as a JSON object by the monitor router before it's ever
	// stored, so a parse failure here means someone edited the row by hand —
	// worth a log line, but not worth failing an otherwise fine check over.
	if monitor.RequestHeaders != nil && strings.TrimSpace(*monitor.RequestHeaders) != "" {
		headers := map[string]string{}
		if err := json.Unmarshal([]byte(*monitor.RequestHeaders), &headers); err != nil {
			logging.Warn(fmt.Sprintf("[https-worker] Ignoring unparseable requestHeaders on monitor %q: %s", monitor.Name, err))
		}
		for name, value := range headers {
			req.Header.Set(name, value)
		}
	}

	return req, nil
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// bodyIsAsserted reports whether this monitor has a content assertion at all.
// A JsonPath assertion is driven by the path, not the keyword — asserting
// only that a path resolves is a valid check with a blank keyword.
func bodyIsAsserted(monitor store.Monitor) bool {
	if monitor.AssertionType == AssertJSONPath {
		return deref(monitor.JSONPath) != ""
	}
	return deref(monitor.Keyword) != ""
}

// readBodyFor reads what the content assertion needs and discards the rest.
// With no assertion configured it drains the body without buffering it, so
// the connection can go back to the pool.
func readBodyFor(monitor store.Monitor, resp *http.Response) (string, error) {
	if !bodyIsAsserted(monitor) {
		_, _ = io.Copy(io.Discard, resp.Body)
		return "", nil
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxKeywordBodyBytes))
	if err != nil {
		return "", err
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	return string(body), nil
}

// peerCertExpiry returns the NotAfter of the certificate the server presented,
// or nil for a plain-HTTP response. On a redirect chain this is the last hop's
// certificate — the one actually serving the content.
func peerCertExpiry(resp *http.Response) *time.Time {
	if resp.TLS == nil || len(resp.TLS.PeerCertificates) == 0 {
		return nil
	}
	notAfter := resp.TLS.PeerCertificates[0].NotAfter
	return &notAfter
}

// certExpiryWarning returns the Degraded message for a certificate that's
// within the configured warning window, or "" when there's nothing to warn
// about. An expired certificate only reaches this point when SSL verification
// is switched off — with it on, the handshake already failed the check.
func certExpiryWarning(cfg settings.Settings, expiresAt *time.Time) string {
	if !cfg.CertExpiryWarningEnabled || expiresAt == nil {
		return ""
	}

	remaining := time.Until(*expiresAt)
	if remaining <= 0 {
		return fmt.Sprintf("TLS certificate expired on %s", expiresAt.UTC().Format("2006-01-02"))
	}

	days := int(remaining.Hours() / 24)
	if days > cfg.CertExpiryWarningDays {
		return ""
	}
	if days == 0 {
		return fmt.Sprintf("TLS certificate expires today (%s)", expiresAt.UTC().Format("2006-01-02 15:04 UTC"))
	}
	return fmt.Sprintf("TLS certificate expires in %d day(s), on %s", days, expiresAt.UTC().Format("2006-01-02"))
}

// statusCodeAccepted applies a monitor's expectedStatusCodes spec —
// comma-separated codes and/or inclusive ranges ("200", "200,201",
// "200-204,301"). An empty spec keeps the original rule: any 2xx is up.
// Unparseable entries are skipped rather than failing the check, on the same
// reasoning as the headers above.
func statusCodeAccepted(spec *string, code int) bool {
	if spec == nil || strings.TrimSpace(*spec) == "" {
		return code >= 200 && code < 300
	}

	for _, part := range strings.Split(*spec, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}

		if from, to, ok := strings.Cut(part, "-"); ok {
			low, errLow := strconv.Atoi(strings.TrimSpace(from))
			high, errHigh := strconv.Atoi(strings.TrimSpace(to))
			if errLow == nil && errHigh == nil && code >= low && code <= high {
				return true
			}
			continue
		}

		if exact, err := strconv.Atoi(part); err == nil && code == exact {
			return true
		}
	}
	return false
}

func unexpectedStatusMessage(spec *string, code int) string {
	if spec == nil || strings.TrimSpace(*spec) == "" {
		return fmt.Sprintf("Unexpected status code %d", code)
	}
	return fmt.Sprintf("Unexpected status code %d (expected %s)", code, strings.TrimSpace(*spec))
}

func elapsedMs(since time.Time) int {
	return int(time.Since(since).Milliseconds())
}

func downResult(started time.Time, err error) store.CheckResult {
	msg := err.Error()
	return store.CheckResult{Status: "Down", ResponseTime: elapsedMs(started), Message: &msg}
}
