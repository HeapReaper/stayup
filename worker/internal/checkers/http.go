// Package checkers implements the "how do I check one monitor" half of each
// monitor-check worker — one performCheck-equivalent function per monitor
// type, run by internal/runner. Mirrors src/workers/{https,port,ping,dns}.ts.
package checkers

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"time"

	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
)

var httpClient = &http.Client{}

// HTTP performs one HTTP(s) check — mirrors performCheck() in
// src/workers/https.ts.
func HTTP(ctx context.Context, cfg settings.Settings, monitor store.Monitor) store.CheckResult {
	timeout := time.Duration(cfg.HTTPTimeoutSecs) * time.Second
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	started := time.Now()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, monitor.URL, nil)
	if err != nil {
		return downResult(started, err)
	}
	req.Header.Set("User-Agent", "StayUp-Monitor/1.0")

	resp, err := httpClient.Do(req)
	responseTime := elapsedMs(started)
	if err != nil {
		return downResult(started, err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body) // drain so the connection can be reused

	statusCode := resp.StatusCode

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		status := "Up"
		if responseTime > cfg.LatencyThreshold {
			status = "Degraded"
		}
		return store.CheckResult{Status: status, StatusCode: &statusCode, ResponseTime: responseTime}
	}

	msg := fmt.Sprintf("Unexpected status code %d", resp.StatusCode)
	return store.CheckResult{Status: "Down", StatusCode: &statusCode, ResponseTime: responseTime, Message: &msg}
}

func elapsedMs(since time.Time) int {
	return int(time.Since(since).Milliseconds())
}

func downResult(started time.Time, err error) store.CheckResult {
	msg := err.Error()
	return store.CheckResult{Status: "Down", ResponseTime: elapsedMs(started), Message: &msg}
}
