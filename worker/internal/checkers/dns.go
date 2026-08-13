package checkers

import (
	"context"
	"net"
	"strings"
	"time"

	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
)

var dnsResolver = &net.Resolver{PreferGo: true}

// DNS performs one A-record lookup — mirrors performCheck() in
// src/workers/dns.ts.
func DNS(ctx context.Context, cfg settings.Settings, monitor store.Monitor) store.CheckResult {
	host := strings.TrimSpace(monitor.URL)
	if host == "" {
		msg := "No hostname configured"
		return store.CheckResult{Status: "Down", ResponseTime: 0, Message: &msg}
	}

	timeout := time.Duration(cfg.HTTPTimeoutSecs) * time.Second
	lookupCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	started := time.Now()
	addrs, err := dnsResolver.LookupIP(lookupCtx, "ip4", host)
	responseTime := elapsedMs(started)
	if err != nil {
		return downResult(started, err)
	}
	if len(addrs) == 0 {
		msg := "No DNS records returned"
		return store.CheckResult{Status: "Down", ResponseTime: responseTime, Message: &msg}
	}

	status := "Up"
	if responseTime > cfg.LatencyThreshold {
		status = "Degraded"
	}
	return store.CheckResult{Status: status, ResponseTime: responseTime}
}
