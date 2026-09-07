package checkers

import (
	"context"
	"strings"
	"time"

	probing "github.com/prometheus-community/pro-bing"

	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
)

const (
	// Echo requests per check, and the gap between them. Three packets 200ms
	// apart stays well inside the shortest (15s) check interval.
	pingPacketCount    = 3
	pingPacketInterval = 200 * time.Millisecond
)

// Ping sends a short burst of ICMP echo requests — mirrors performCheck() in
// src/workers/ping.ts, but natively rather than shelling out to the OS
// `ping` binary: pro-bing opens a raw ICMP socket directly (needs
// CAP_NET_RAW, already granted to the ping worker container — see
// the compose files), so there's no process-spawn per check and no
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
	// Send a small burst rather than a single packet: ICMP is lossy by
	// design, and one dropped packet on an otherwise healthy host is the
	// classic false "down". The host counts as reachable if *any* echo comes
	// back, so ordinary packet loss no longer reads as an outage.
	pinger.Count = pingPacketCount
	pinger.Interval = pingPacketInterval
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
		// Every packet in the burst was lost.
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
