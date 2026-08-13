package checkers

import (
	"context"
	"strings"
	"time"

	probing "github.com/prometheus-community/pro-bing"

	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
)

// Ping sends a single ICMP echo request — mirrors performCheck() in
// src/workers/ping.ts, but natively rather than shelling out to the OS
// `ping` binary: pro-bing opens a raw ICMP socket directly (needs
// CAP_NET_RAW, already granted to the ping worker container — see
// docker-compose.yml), so there's no process-spawn per check and no
// locale-dependent output to avoid parsing.
func Ping(ctx context.Context, cfg settings.Settings, monitor store.Monitor) store.CheckResult {
	host := strings.TrimSpace(monitor.URL)
	if host == "" {
		msg := "Invalid host"
		return store.CheckResult{Status: "Down", ResponseTime: 0, Message: &msg}
	}

	pinger, err := probing.NewPinger(host)
	if err != nil {
		msg := err.Error()
		return store.CheckResult{Status: "Down", ResponseTime: 0, Message: &msg}
	}
	pinger.Count = 1
	pinger.Timeout = time.Duration(cfg.HTTPTimeoutSecs) * time.Second
	pinger.SetPrivileged(true)

	started := time.Now()
	err = pinger.RunWithContext(ctx)
	responseTime := elapsedMs(started)
	if err != nil {
		return downResult(started, err)
	}

	stats := pinger.Statistics()
	if stats.PacketsRecv == 0 {
		msg := "Host unreachable"
		return store.CheckResult{Status: "Down", ResponseTime: responseTime, Message: &msg}
	}

	rtt := int(stats.AvgRtt.Milliseconds())
	status := "Up"
	if rtt > cfg.LatencyThreshold {
		status = "Degraded"
	}
	return store.CheckResult{Status: status, ResponseTime: rtt}
}
