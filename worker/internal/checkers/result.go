package checkers

import (
	"time"

	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
)

// Shared result helpers for the connection-level checkers. Every one of them
// ends the same way — "it answered, was it fast enough" — and grading that
// identically is what keeps the Degraded threshold meaning the same thing
// across monitor types.

// gradeLatency applies the instance-wide latency threshold to a successful
// check.
func gradeLatency(cfg settings.Settings, responseTime int) string {
	if responseTime > cfg.LatencyThreshold {
		return "Degraded"
	}
	return "Up"
}

// gradedResult is the success path: measure, then grade on latency.
func gradedResult(cfg settings.Settings, started time.Time) store.CheckResult {
	responseTime := elapsedMs(started)
	return store.CheckResult{Status: gradeLatency(cfg, responseTime), ResponseTime: responseTime}
}

// downMessage is a failed check whose reason is ours to phrase, rather than
// an error from the network stack (that's downResult).
func downMessage(started time.Time, message string) store.CheckResult {
	return store.CheckResult{Status: "Down", ResponseTime: elapsedMs(started), Message: &message}
}

func strPtr(value string) *string { return &value }
