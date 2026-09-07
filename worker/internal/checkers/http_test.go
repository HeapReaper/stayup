package checkers

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
)

func testSettings() settings.Settings {
	return settings.Settings{
		HTTPTimeoutSecs:          5,
		FailedAttemptsThreshold:  1,
		LatencyThreshold:         60_000, // high enough that timing never makes a test flaky
		SSLCheckEnabled:          true,
		CertExpiryWarningEnabled: true,
		CertExpiryWarningDays:    14,
	}
}

func httpMonitor(url string) store.Monitor {
	return store.Monitor{
		ID: "mon", Name: "test", URL: url, Type: "HTTP", Status: "Up", Interval: "60s",
		Enabled: true, Method: "GET", FollowRedirects: true,
	}
}

func ptr[T any](v T) *T { return &v }

func TestStatusCodeAccepted(t *testing.T) {
	cases := []struct {
		spec string
		code int
		want bool
	}{
		{"", 200, true},
		{"", 204, true},
		{"", 301, false},
		{"", 500, false},
		{"200", 200, true},
		{"200", 201, false},
		{"200,201", 201, true},
		{"200-204", 203, true},
		{"200-204", 205, false},
		{"200-204,301", 301, true},
		{" 200 , 301 ", 301, true}, // whitespace tolerated
		{"nonsense", 200, false},   // unparseable entries match nothing
		{"nonsense,200", 200, true},
	}

	for _, c := range cases {
		var spec *string
		if c.spec != "" {
			spec = &c.spec
		}
		if got := statusCodeAccepted(spec, c.code); got != c.want {
			t.Errorf("statusCodeAccepted(%q, %d) = %v, want %v", c.spec, c.code, got, c.want)
		}
	}
}

func TestHTTPExpectedStatusCodes(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	monitor := httpMonitor(server.URL)
	if result := HTTP(context.Background(), testSettings(), monitor); result.Status != "Down" {
		t.Errorf("404 with no spec: got %s, want Down", result.Status)
	}

	monitor.ExpectedStatusCodes = ptr("404")
	if result := HTTP(context.Background(), testSettings(), monitor); result.Status != "Up" {
		t.Errorf("404 with spec 404: got %s (%v), want Up", result.Status, result.Message)
	}
}

func TestHTTPKeyword(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"status":"healthy"}`)
	}))
	defer server.Close()

	monitor := httpMonitor(server.URL)
	monitor.Keyword = ptr("healthy")
	if result := HTTP(context.Background(), testSettings(), monitor); result.Status != "Up" {
		t.Errorf("keyword present: got %s, want Up", result.Status)
	}

	monitor.Keyword = ptr("unhealthy")
	result := HTTP(context.Background(), testSettings(), monitor)
	if result.Status != "Down" {
		t.Errorf("keyword absent: got %s, want Down", result.Status)
	}
	if result.Message == nil {
		t.Fatal("keyword absent: expected a failure message")
	}

	// Inverted: the marker being present is what fails the check.
	monitor.Keyword = ptr("healthy")
	monitor.KeywordInverted = true
	if result := HTTP(context.Background(), testSettings(), monitor); result.Status != "Down" {
		t.Errorf("inverted keyword present: got %s, want Down", result.Status)
	}
}

func TestHTTPRedirectPolicy(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()

	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	defer redirector.Close()

	monitor := httpMonitor(redirector.URL)
	result := HTTP(context.Background(), testSettings(), monitor)
	if result.Status != "Up" || *result.StatusCode != http.StatusOK {
		t.Errorf("following redirects: got %s/%d, want Up/200", result.Status, *result.StatusCode)
	}

	monitor.FollowRedirects = false
	result = HTTP(context.Background(), testSettings(), monitor)
	if *result.StatusCode != http.StatusFound {
		t.Errorf("not following redirects: got status code %d, want 302", *result.StatusCode)
	}
	if result.Status != "Down" {
		t.Errorf("302 with no spec: got %s, want Down", result.Status)
	}

	monitor.ExpectedStatusCodes = ptr("302")
	if result := HTTP(context.Background(), testSettings(), monitor); result.Status != "Up" {
		t.Errorf("302 with spec 302: got %s, want Up", result.Status)
	}
}

func TestHTTPRequestShape(t *testing.T) {
	var gotMethod, gotHeader, gotBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotHeader = r.Header.Get("X-Api-Key")
		body, _ := io.ReadAll(r.Body)
		gotBody = string(body)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	monitor := httpMonitor(server.URL)
	monitor.Method = "POST"
	monitor.RequestHeaders = ptr(`{"X-Api-Key": "secret"}`)
	monitor.RequestBody = ptr(`{"ping":true}`)

	if result := HTTP(context.Background(), testSettings(), monitor); result.Status != "Up" {
		t.Fatalf("got %s, want Up", result.Status)
	}
	if gotMethod != "POST" || gotHeader != "secret" || gotBody != `{"ping":true}` {
		t.Errorf("request was %s, header %q, body %q", gotMethod, gotHeader, gotBody)
	}
}

func TestHTTPSCertExpiry(t *testing.T) {
	// httptest's TLS server generates a certificate valid for years, so a
	// live check should never warn — and it proves the expiry actually gets
	// read off the connection.
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	cfg := testSettings()
	cfg.SSLCheckEnabled = false // httptest's CA isn't in the system trust store

	result := HTTP(context.Background(), cfg, httpMonitor(server.URL))
	if result.Status != "Up" {
		t.Fatalf("got %s (%v), want Up", result.Status, result.Message)
	}
	if result.CertExpiresAt == nil {
		t.Fatal("expected the TLS certificate's expiry to be recorded")
	}

	// And with verification on, the untrusted certificate fails the check.
	cfg.SSLCheckEnabled = true
	if result := HTTP(context.Background(), cfg, httpMonitor(server.URL)); result.Status != "Down" {
		t.Errorf("untrusted certificate with SSL check on: got %s, want Down", result.Status)
	}
}

func TestCertExpiryWarning(t *testing.T) {
	cfg := testSettings()
	now := time.Now()

	if got := certExpiryWarning(cfg, nil); got != "" {
		t.Errorf("no certificate: got %q, want no warning", got)
	}
	if got := certExpiryWarning(cfg, ptr(now.AddDate(0, 0, 90))); got != "" {
		t.Errorf("90 days out: got %q, want no warning", got)
	}
	if got := certExpiryWarning(cfg, ptr(now.AddDate(0, 0, 3))); got == "" {
		t.Error("3 days out: expected a warning")
	}
	if got := certExpiryWarning(cfg, ptr(now.AddDate(0, 0, -1))); got == "" {
		t.Error("already expired: expected a warning")
	}

	cfg.CertExpiryWarningEnabled = false
	if got := certExpiryWarning(cfg, ptr(now.AddDate(0, 0, 1))); got != "" {
		t.Errorf("warnings disabled: got %q, want no warning", got)
	}
}
