package checkers

import (
	"bytes"
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"golang.org/x/net/http2"

	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
)

// The standard gRPC health-checking service every serious gRPC server
// registers. Asking it is the closest thing gRPC has to a health endpoint.
const grpcHealthPath = "/grpc.health.v1.Health/Check"

// An empty HealthCheckRequest — the protobuf encoding of a message with no
// fields set is zero bytes, so the whole gRPC frame is its 5-byte header: one
// "not compressed" flag plus a four-byte big-endian length of zero. That's
// why this checker needs no protobuf dependency.
var emptyHealthCheckRequest = []byte{0, 0, 0, 0, 0}

// GRPC calls the standard health service over HTTP/2 and reads the gRPC
// status code back. A server whose TCP port is open but whose health service
// reports NOT_SERVING — draining, or a failed dependency it knows about —
// fails here and passes a port check.
//
// `grpc-status` 0 is healthy. Anything else, including a well-formed HTTP 200
// carrying a non-zero status, is the server telling us it is not serving.
func GRPC(ctx context.Context, cfg settings.Settings, monitor store.Monitor) store.CheckResult {
	timeout := time.Duration(cfg.HTTPTimeoutSecs) * time.Second
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	started := time.Now()

	target, plaintext := grpcTarget(monitor)
	scheme := "https"
	if plaintext {
		scheme = "http"
	}

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost,
		fmt.Sprintf("%s://%s%s", scheme, target, grpcHealthPath), bytes.NewReader(emptyHealthCheckRequest))
	if err != nil {
		return downResult(started, err)
	}
	req.Header.Set("Content-Type", "application/grpc")
	req.Header.Set("User-Agent", "StayUp-Monitor/1.0 grpc-go/stayup")
	// Required by the gRPC HTTP/2 mapping; without it a conforming server may
	// refuse to send trailers, which is where the status usually arrives.
	req.Header.Set("TE", "trailers")

	resp, err := grpcClient(cfg, plaintext, timeout).Do(req)
	responseTime := elapsedMs(started)
	if err != nil {
		return downResult(started, err)
	}
	defer resp.Body.Close()

	// The status can arrive as a header (a "trailers-only" response, which is
	// how most servers report an error) or as an actual trailer after the
	// body, so the body has to be drained before the trailers are readable.
	status := resp.Header.Get("grpc-status")
	message := resp.Header.Get("grpc-message")
	if _, err := io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16)); err != nil {
		return downResult(started, err)
	}
	if status == "" {
		status = resp.Trailer.Get("grpc-status")
		message = resp.Trailer.Get("grpc-message")
	}

	if resp.StatusCode != http.StatusOK {
		return downMessage(started, fmt.Sprintf("gRPC endpoint returned HTTP %d", resp.StatusCode))
	}
	if status == "" {
		return downMessage(started, "No grpc-status in the response — is this a gRPC server?")
	}
	if status != "0" {
		detail := grpcStatusName(status)
		if message != "" {
			detail += ": " + message
		}
		return downMessage(started, "gRPC health check returned "+detail)
	}

	return store.CheckResult{Status: gradeLatency(cfg, responseTime), ResponseTime: responseTime}
}

// grpcTarget splits the monitor's target into an authority and whether to
// speak plaintext h2c. `grpc://` (or a bare host) means plaintext; `grpcs://`
// and `https://` mean TLS, as does the conventional 443.
func grpcTarget(monitor store.Monitor) (string, bool) {
	raw := strings.TrimSpace(monitor.URL)
	plaintext := true

	switch {
	case strings.HasPrefix(raw, "grpcs://"), strings.HasPrefix(raw, "https://"):
		plaintext = false
	case strings.HasPrefix(raw, "grpc://"), strings.HasPrefix(raw, "http://"):
		plaintext = true
	}

	host := hostOf(raw)
	port := 443
	if monitor.Port != nil && *monitor.Port > 0 {
		port = *monitor.Port
	}
	if port == 443 && strings.HasPrefix(raw, "grpc://") {
		plaintext = true
	} else if port == 443 && !strings.Contains(raw, "://") {
		plaintext = false
	}

	return net.JoinHostPort(host, fmt.Sprint(port)), plaintext
}

// grpcClient builds an HTTP/2 client. gRPC is HTTP/2-only, and Go's default
// transport only negotiates h2 over TLS — a plaintext gRPC server (the norm
// inside a cluster) needs h2c, which means driving http2.Transport directly.
func grpcClient(cfg settings.Settings, plaintext bool, timeout time.Duration) *http.Client {
	transport := &http2.Transport{
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: !cfg.SSLCheckEnabled, // #nosec G402 — see settings.SSLCheckEnabled
		},
	}

	if plaintext {
		transport.AllowHTTP = true
		// With AllowHTTP the transport still calls DialTLS for an "https"
		// scheme it constructed internally; returning a plain connection here
		// is the documented way to speak h2c.
		transport.DialTLSContext = func(ctx context.Context, network, addr string, _ *tls.Config) (net.Conn, error) {
			return (&net.Dialer{Timeout: timeout}).DialContext(ctx, network, addr)
		}
	}

	return &http.Client{Transport: transport, Timeout: timeout}
}

// grpcStatusName renders the numeric status the way gRPC tooling does, since
// "14" in an alert is meaningless and "UNAVAILABLE" is not.
func grpcStatusName(status string) string {
	names := map[string]string{
		"1": "CANCELLED", "2": "UNKNOWN", "3": "INVALID_ARGUMENT", "4": "DEADLINE_EXCEEDED",
		"5": "NOT_FOUND", "6": "ALREADY_EXISTS", "7": "PERMISSION_DENIED", "8": "RESOURCE_EXHAUSTED",
		"9": "FAILED_PRECONDITION", "10": "ABORTED", "11": "OUT_OF_RANGE", "12": "UNIMPLEMENTED",
		"13": "INTERNAL", "14": "UNAVAILABLE", "15": "DATA_LOSS", "16": "UNAUTHENTICATED",
	}
	if name, ok := names[status]; ok {
		return name + " (" + status + ")"
	}
	return "status " + status
}
