// Package runner is the shared scheduling/persistence loop for monitor-check
// workers (internal/checkers + cmd/https, cmd/port, cmd/ping, cmd/dns) —
// mirrors src/lib/monitor-worker.ts. Each checker only implements "how do I
// check one monitor" — this handles due-monitor polling, writing the
// MonitorCheck ("ping") row, rolling the result up onto the Monitor, incident
// sync, logging, and graceful shutdown, so every worker behaves consistently.
package runner

import (
	"context"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"stayup/worker/internal/flapping"
	"stayup/worker/internal/incidents"
	"stayup/worker/internal/logging"
	"stayup/worker/internal/maintenance"
	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
	"stayup/worker/internal/version"
)

// How far back to look when recomputing the uptime percentage shown in the UI.
const uptimeWindow = 30 * 24 * time.Hour

const defaultTickInterval = 5 * time.Second

// PerformCheck performs a single check. Should not return an error for an
// expected failure (target down, timed out, refused, ...) — represent that as
// a CheckResult with Status "Down" and a Message, so a failed check still
// gets recorded as a ping instead of silently dropping the tick.
type PerformCheck func(ctx context.Context, cfg settings.Settings, monitor store.Monitor) store.CheckResult

type Options struct {
	// Log line prefix, e.g. "https-worker" or "port-worker".
	WorkerLabel string
	// Which Monitor.Type this worker is responsible for. Exactly one of
	// MonitorType and MonitorTypes is set — the single-type workers name one,
	// cmd/probes names the whole connection-level family.
	MonitorType  string
	MonitorTypes []string
	PerformCheck PerformCheck
	// How often to poll for due monitors. Defaults to 5s.
	TickInterval time.Duration
}

// Run polls/checks/persists until ctx is cancelled (SIGINT/SIGTERM via
// signal.NotifyContext in cmd/*/main.go) — mirrors runMonitorWorker().
func Run(ctx context.Context, s *store.Store, opts Options) {
	interval := opts.TickInterval
	if interval == 0 {
		interval = defaultTickInterval
	}

	logging.Info(fmt.Sprintf("[%s] Started (%s) — polling every %ds", opts.WorkerLabel, version.Current(), int(interval.Seconds())))

	// Captured once: the heartbeat row's startedAt is what makes a
	// crash-looping container distinguishable from a healthy one — it keeps
	// moving forward on every restart, while lastSeenAt would look fine
	// either way.
	startedAt := time.Now()

	for {
		// A tick already in flight when the shutdown signal arrives runs to
		// completion — same as the TS loop's `while(running)`, which only
		// stops scheduling the *next* iteration. Deliberately not `ctx` here:
		// once cancelled, it would abort this tick's DB writes/HTTP calls
		// mid-flight instead of letting them finish.
		tick(context.Background(), s, opts, startedAt, interval)

		select {
		case <-ctx.Done():
			logging.Info(fmt.Sprintf("[%s] Received shutdown signal, shutting down...", opts.WorkerLabel))
			return
		case <-time.After(interval):
		}
	}
}

// listMonitors reads this worker's due-monitor candidates, for whichever of
// the two type shapes it was configured with.
func (o Options) listMonitors(ctx context.Context, s *store.Store) ([]store.Monitor, error) {
	if len(o.MonitorTypes) > 0 {
		return s.ListByTypes(ctx, o.MonitorTypes)
	}
	return s.ListByType(ctx, o.MonitorType)
}

func tick(ctx context.Context, s *store.Store, opts Options, startedAt time.Time, interval time.Duration) {
	// First thing in the tick, before any work that can fail: this answers
	// "is this process still ticking", which is a different question from
	// "are its checks succeeding".
	if err := s.RecordHeartbeat(ctx, store.Heartbeat{
		// The row is keyed on the binary's name, not the log label.
		Worker:          strings.TrimSuffix(opts.WorkerLabel, "-worker"),
		IntervalSeconds: int(interval.Seconds()),
		StartedAt:       startedAt,
		LastSeenAt:      time.Now(),
		Version:         version.Current(),
		Revision:        version.Revision(),
	}); err != nil {
		logging.Error(fmt.Sprintf("[%s] Failed to record heartbeat", opts.WorkerLabel), err)
	}

	monitors, err := opts.listMonitors(ctx, s)
	if err != nil {
		logging.Error(fmt.Sprintf("[%s] Tick failed", opts.WorkerLabel), err)
		return
	}

	now := time.Now()
	var due []store.Monitor
	for _, m := range monitors {
		if m.IsDue(now) {
			due = append(due, m)
		}
	}
	if len(due) == 0 {
		return
	}

	// Read once per tick rather than once per monitor (the TS worker reads it
	// per-check) — same values throughout, fewer round trips.
	cfg, err := settings.Get(ctx, s)
	if err != nil {
		logging.Error(fmt.Sprintf("[%s] Tick failed: could not load settings", opts.WorkerLabel), err)
		return
	}

	var wg sync.WaitGroup
	for _, m := range due {
		wg.Add(1)
		go func(m store.Monitor) {
			defer wg.Done()
			if err := checkOne(ctx, s, opts, cfg, m); err != nil {
				logging.Error(fmt.Sprintf("[%s] Failed to check monitor %q", opts.WorkerLabel, m.Name), err)
			}
		}(m)
	}
	wg.Wait()
}

func checkOne(ctx context.Context, s *store.Store, opts Options, cfg settings.Settings, monitor store.Monitor) error {
	result := opts.PerformCheck(ctx, cfg, monitor)
	checkedAt := time.Now()

	responseTime := result.ResponseTime
	if err := s.CreateCheck(ctx, monitor.ID, result.Status, result.StatusCode, &responseTime, result.Message, checkedAt); err != nil {
		return err
	}

	total, up, err := s.UptimeCounts(ctx, monitor.ID, checkedAt.Add(-uptimeWindow))
	if err != nil {
		return err
	}
	uptime := 100.0
	if total > 0 {
		uptime = math.Round(float64(up)/float64(total)*10_000) / 100
	}

	// One failed probe is not proof of an outage — a dropped ICMP packet, a
	// DNS hiccup, a dropped keep-alive or a momentary 502 mid-deploy all look
	// identical to a real failure from a single check. Roll up the *confirmed*
	// status instead, so a blip no longer flips the monitor to Down and pages
	// everyone.
	reported, err := confirmedStatus(ctx, s, cfg, monitor, result.Status)
	if err != nil {
		return err
	}

	if err := s.UpdateCheckResult(ctx, monitor.ID, reported, result.ResponseTime, uptime, checkedAt, result.CertExpiresAt, result.DomainExpiresAt); err != nil {
		return err
	}

	logResult(opts.WorkerLabel, monitor, result)
	if reported != result.Status {
		logging.Info(fmt.Sprintf("[%s] %s: %s check not yet confirmed (fewer than %d failures in a row) — holding status at %s",
			opts.WorkerLabel, monitor.Name, strings.ToLower(result.Status), cfg.FailedAttemptsThreshold, reported))
		return nil
	}

	// The threshold above debounces one dip; this catches the opposite
	// failure, a monitor that keeps changing its mind. While it's flapping,
	// its incidents are suppressed exactly the way a maintenance window
	// suppresses them — one standing incident instead of a storm.
	flap, err := flapping.Sync(ctx, s, cfg, monitor, checkedAt)
	if err != nil {
		return err
	}
	if flap.Started {
		noteFlappingStarted(ctx, s, opts.WorkerLabel, monitor, cfg, flap)
	}
	if flap.Stopped {
		logging.Info(fmt.Sprintf("[%s] %s has settled (%d transitions in the last %d minutes) — resuming normal incident handling",
			opts.WorkerLabel, monitor.Name, flap.Transitions, cfg.FlappingWindowMinutes))
	}
	if flap.Flapping {
		logging.Info(fmt.Sprintf("[%s] %s is flapping (%d transitions in the last %d minutes) — skipping incident sync",
			opts.WorkerLabel, monitor.Name, flap.Transitions, cfg.FlappingWindowMinutes))
		return nil
	}

	syncIncidentForResult(ctx, s, opts.WorkerLabel, monitor, reported, result.Message)
	return nil
}

// noteFlappingStarted opens the one standing incident that stands in for the
// storm — it goes through the same EnsureIncidentForMonitor path as any other
// automatic incident, so it pages, appears on status pages and escalates
// exactly like the incidents it replaces.
func noteFlappingStarted(ctx context.Context, s *store.Store, workerLabel string, monitor store.Monitor, cfg settings.Settings, flap flapping.State) {
	logging.Warn(fmt.Sprintf("[%s] %s is flapping: %d transitions in the last %d minutes",
		workerLabel, monitor.Name, flap.Transitions, cfg.FlappingWindowMinutes))

	underMaintenance, err := maintenance.IsMonitorUnderMaintenance(ctx, s, monitor.ID)
	if err != nil {
		logging.Error(fmt.Sprintf("[%s] Failed to open flapping incident for %q", workerLabel, monitor.Name), err)
		return
	}
	if underMaintenance {
		return
	}

	message := fmt.Sprintf(
		"Automatically detected: %s is flapping — it changed between up and down %d times in the last %d minutes. Further incidents for this monitor are suppressed until it settles.",
		monitor.Name, flap.Transitions, cfg.FlappingWindowMinutes)

	if _, err := incidents.EnsureIncidentForMonitor(ctx, s, incidents.MonitorRef{ID: monitor.ID, Name: monitor.Name}, "Degraded", message); err != nil {
		logging.Error(fmt.Sprintf("[%s] Failed to open flapping incident for %q", workerLabel, monitor.Name), err)
	}
}

// confirmedStatus applies the instance-wide "Failed Attempts Before Alert"
// threshold (AppSettings.failedAttemptsThreshold) to a fresh check result: a
// Down/Degraded result is only reported as such once that many checks in a row
// have failed, and is otherwise held at "Up". The check row itself is always
// written verbatim, so the ping history and the uptime percentage still count
// every individual failure — only the monitor's rolled-up status and its
// incident are debounced.
//
// The default threshold is 1, which reports every failure immediately.
func confirmedStatus(ctx context.Context, s *store.Store, cfg settings.Settings, monitor store.Monitor, status string) (string, error) {
	if status == "Up" || cfg.FailedAttemptsThreshold <= 1 {
		return status, nil
	}

	// Runs after this tick's CreateCheck, so the current result is included.
	failures, err := s.TrailingFailureCount(ctx, monitor.ID, cfg.FailedAttemptsThreshold)
	if err != nil {
		return "", err
	}
	if failures < cfg.FailedAttemptsThreshold {
		return "Up", nil
	}
	return status, nil
}

func logResult(workerLabel string, monitor store.Monitor, result store.CheckResult) {
	target := monitor.URL
	if monitor.Port != nil {
		target = fmt.Sprintf("%s:%d", target, *monitor.Port)
	}
	label := fmt.Sprintf("%s (%s)", monitor.Name, target)

	details := result.Status
	if result.StatusCode != nil {
		details += fmt.Sprintf(" [%d]", *result.StatusCode)
	}
	details += fmt.Sprintf(" in %dms", result.ResponseTime)
	if result.Message != nil {
		details += " — " + *result.Message
	}

	switch result.Status {
	case "Down":
		logging.Warn(fmt.Sprintf("[%s] ✗ %s -> %s", workerLabel, label, details))
	case "Degraded":
		logging.Warn(fmt.Sprintf("[%s] ⚠ %s -> %s", workerLabel, label, details))
	default:
		logging.Info(fmt.Sprintf("[%s] ✓ %s -> %s", workerLabel, label, details))
	}
}

// syncIncidentForResult opens/updates the monitor's incident to reflect the
// check result — mirrors syncIncidentForResult() in monitor-worker.ts.
func syncIncidentForResult(ctx context.Context, s *store.Store, workerLabel string, monitor store.Monitor, status string, failureMessage *string) {
	ref := incidents.MonitorRef{ID: monitor.ID, Name: monitor.Name}

	if status == "Down" || status == "Degraded" {
		underMaintenance, err := maintenance.IsMonitorUnderMaintenance(ctx, s, monitor.ID)
		if err != nil {
			logging.Error(fmt.Sprintf("[%s] Failed to sync incident for %q", workerLabel, monitor.Name), err)
			return
		}
		if underMaintenance {
			logging.Info(fmt.Sprintf("[%s] %s is %s but under maintenance — skipping incident", workerLabel, monitor.Name, strings.ToLower(status)))
			return
		}

		detail := ""
		if failureMessage != nil {
			detail = fmt.Sprintf(" (%s)", *failureMessage)
		}
		message := fmt.Sprintf("Automatically detected: %s is %s%s.", monitor.Name, strings.ToLower(status), detail)

		incident, err := incidents.EnsureIncidentForMonitor(ctx, s, ref, status, message)
		if err != nil {
			logging.Error(fmt.Sprintf("[%s] Failed to sync incident for %q", workerLabel, monitor.Name), err)
			return
		}
		logging.Warn(fmt.Sprintf("[%s] Incident open for %s: %s (%s)", workerLabel, monitor.Name, incident.Title, incident.ID))
		return
	}

	incident, err := incidents.NoteMonitorRecovered(ctx, s, ref)
	if err != nil {
		logging.Error(fmt.Sprintf("[%s] Failed to sync incident for %q", workerLabel, monitor.Name), err)
		return
	}
	if incident != nil {
		logging.Info(fmt.Sprintf("[%s] Incident %s moved to Monitoring after recovery", workerLabel, incident.ID))
	}
}
