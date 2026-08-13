package checkers

import (
	"context"
	"fmt"
	"net"
	"time"

	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
)

// Port performs one raw TCP connect check — mirrors performCheck() in
// src/workers/port.ts.
func Port(ctx context.Context, cfg settings.Settings, monitor store.Monitor) store.CheckResult {
	if monitor.Port == nil {
		msg := "No port configured for this monitor"
		return store.CheckResult{Status: "Down", ResponseTime: 0, Message: &msg}
	}

	timeout := time.Duration(cfg.HTTPTimeoutSecs) * time.Second
	address := fmt.Sprintf("%s:%d", monitor.URL, *monitor.Port)

	started := time.Now()
	dialer := net.Dialer{Timeout: timeout}
	conn, err := dialer.DialContext(ctx, "tcp", address)
	responseTime := elapsedMs(started)
	if err != nil {
		return downResult(started, err)
	}
	_ = conn.Close()

	status := "Up"
	if responseTime > cfg.LatencyThreshold {
		status = "Degraded"
	}
	return store.CheckResult{Status: status, ResponseTime: responseTime}
}
