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
	"stayup/worker/internal/procstat"
	"stayup/worker/internal/region"
	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
	"stayup/worker/internal/version"
)

// How far back to look when recomputing the uptime percentage shown in the UI.
const uptimeWindow = 30 * 24 * time.Hour

const defaultTickInterval = 5 * time.Second

// How long a claimed monitor stays claimed. Long enough that no ordinary
// check outruns it (the per-monitor HTTP timeout tops out at 300s), short
// enough that a worker killed mid-check frees it within a couple of
// intervals rather than stranding it until someone notices.
const leaseDuration = 10 * time.Minute

// How stale a region's last verdict may be and still count towards consensus.
// Three intervals with a two-minute floor, the same shape as the dashboard's
// worker-staleness rule: a region that has gone quiet stops voting instead of
// holding whatever it happened to see when it died.
func opinionWindow(interval time.Duration) time.Duration {
	if window := interval * 3; window > 2*time.Minute {
		return window
	}
	return 2 * time.Minute
}

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
func (o Options) listMonitors(ctx context.Context, s *store.Store, region string) ([]store.Monitor, error) {
	if len(o.MonitorTypes) > 0 {
		return s.ListByTypes(ctx, region, o.MonitorTypes)
	}
	return s.ListByType(ctx, region, o.MonitorType)
}

func tick(ctx context.Context, s *store.Store, opts Options, startedAt time.Time, interval time.Duration) {
	// First thing in the tick, before any work that can fail: this answers
	// "is this process still ticking", which is a different question from
	// "are its checks succeeding".
	if err := s.RecordHeartbeat(ctx, store.Heartbeat{
		// The row is keyed on the binary's name, not the log label.
		Worker:          strings.TrimSuffix(opts.WorkerLabel, "-worker"),
		Region:          region.Current(),
		IntervalSeconds: int(interval.Seconds()),
		StartedAt:       startedAt,
		LastSeenAt:      time.Now(),
		Version:         version.Current(),
		Revision:        version.Revision(),
		MemoryKB:        procstat.ResidentKB(),
	}); err != nil {
		logging.Error(fmt.Sprintf("[%s] Failed to record heartbeat", opts.WorkerLabel), err)
	}

	here := region.Current()

	monitors, err := opts.listMonitors(ctx, s, here)
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

			// Claim before checking. Two replicas of this worker will both see
			// the monitor as due — the lease is what stops them both checking
			// it, doubling the load on the target and writing two rows for one
			// interval. Losing the race is the normal, quiet outcome.
			claimed, err := s.ClaimMonitor(ctx, m.ID, here, region.InstanceID(), time.Now(), time.Now().Add(leaseDuration))
			if err != nil {
				logging.Error(fmt.Sprintf("[%s] Failed to claim monitor %q", opts.WorkerLabel, m.Name), err)
				return
			}
			if !claimed {
				return
			}

			if err := checkOne(ctx, s, opts, cfg, m, here); err != nil {
				logging.Error(fmt.Sprintf("[%s] Failed to check monitor %q", opts.WorkerLabel, m.Name), err)
			}
		}(m)
	}
	wg.Wait()
}

func checkOne(ctx context.Context, s *store.Store, opts Options, cfg settings.Settings, monitor store.Monitor, here string) error {
	// Per-monitor overrides land here, once, so every checker and every
	// threshold below reads one already-resolved Settings value.
	cfg = settings.ForMonitor(cfg, monitor)

	result := opts.PerformCheck(ctx, cfg, monitor)
	checkedAt := time.Now()

	responseTime := result.ResponseTime
	if err := s.CreateCheck(ctx, monitor.ID, result.Status, result.StatusCode, &responseTime, result.Message, here, checkedAt); err != nil {
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
	local, err := confirmedStatus(ctx, s, cfg, monitor, result.Status)
	if err != nil {
		return err
	}

	// Release before asking for consensus, so this region's own verdict is one
	// of the votes counted rather than a result the query can't see yet. It
	// also drops the lock the moment the check is done, instead of holding it
	// for the rest of the lease.
	if err := s.ReleaseLease(ctx, monitor.ID, here, local, checkedAt); err != nil {
		return err
	}

	reported, consensus, err := agreedStatus(ctx, s, monitor, local, checkedAt)
	if err != nil {
		return err
	}

	if err := s.UpdateCheckResult(ctx, monitor.ID, reported, result.ResponseTime, uptime, checkedAt, result.CertExpiresAt, result.DomainExpiresAt); err != nil {
		return err
	}

	logResult(opts.WorkerLabel, monitor, result)
	if local != result.Status {
		logging.Info(fmt.Sprintf("[%s] %s: %s check not yet confirmed (fewer than %d failures in a row) — holding status at %s",
			opts.WorkerLabel, monitor.Name, strings.ToLower(result.Status), cfg.FailedAttemptsThreshold, local))
		return nil
	}
	if reported != local {
		logging.Info(fmt.Sprintf("[%s] %s looks %s from %s, but only %d of %d reporting region(s) agree (%d required) — holding status at %s",
			opts.WorkerLabel, monitor.Name, strings.ToLower(local), here,
			consensus.Failing, consensus.Reporting, consensus.Required, reported))
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

	// Same gate as syncIncidentForResult: a monitor with automatic incidents
	// switched off gets no standing flapping incident either. The flapping
	// state itself is still recorded (flapping.Sync ran before this), so the
	// dashboard still shows it — it just doesn't page anyone.
	if !monitor.AutoIncidents {
		logging.Info(fmt.Sprintf("[%s] %s has automatic incidents switched off — not opening a flapping incident", workerLabel, monitor.Name))
		return
	}

	suppressed, _, err := incidents.Suppressed(ctx, s, monitor.ID, monitor.ParentID)
	if err != nil {
		logging.Error(fmt.Sprintf("[%s] Failed to open flapping incident for %q", workerLabel, monitor.Name), err)
		return
	}
	if suppressed {
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

// consensus is what the region vote decided, for the log line that explains a
// failure that was seen but not reported.
type consensus struct {
	Reporting int
	Failing   int
	Required  int
}

// agreedStatus applies Monitor.confirmationRegions: a failure one region can
// see is only reported once that many regions see it too.
//
// This is the check that failedAttemptsThreshold cannot do. That one debounces
// a monitor over *time*, so it catches a dropped packet but not a bad transit
// route — and a broken path between one probe and the target looks exactly
// like an outage from that probe, however long you wait. Asking a second
// region is the only thing that tells them apart, and it is the single biggest
// source of false pages in uptime monitoring.
//
// Two deliberate softenings, both erring towards alerting, because the failure
// mode of getting this wrong is silence:
//
//   - The requirement is capped at the number of regions actually reporting.
//     Configure three, run two, and you get two — rather than a monitor that
//     can never alert because the third region was never deployed.
//   - Recovery is never gated. One region seeing the monitor back up reports
//     it up, so a monitor cannot get stuck Down because the region that saw
//     the outage has since stopped reporting.
func agreedStatus(ctx context.Context, s *store.Store, monitor store.Monitor, local string, now time.Time) (string, consensus, error) {
	required := 1
	if monitor.ConfirmationRegions != nil && *monitor.ConfirmationRegions > 1 {
		required = *monitor.ConfirmationRegions
	}
	if local == "Up" || required == 1 {
		return local, consensus{}, nil
	}

	reporting, failing, err := s.RegionOpinions(ctx, monitor.ID, now.Add(-opinionWindow(monitor.IntervalDuration())))
	if err != nil {
		return "", consensus{}, err
	}

	status, agreed := decideConsensus(local, required, reporting, failing)
	return status, agreed, nil
}

// decideConsensus is the vote itself, split out from the query so the rule can
// be tested without a database — it is the part with the edge cases.
func decideConsensus(local string, required, reporting, failing int) (string, consensus) {
	// Cap at what is actually deployed. Configure three, run two, and you get
	// two — rather than a monitor that can never alert because the third region
	// was never brought up.
	if reporting > 0 && required > reporting {
		required = reporting
	}

	agreed := consensus{Reporting: reporting, Failing: failing, Required: required}
	if failing >= required {
		return local, agreed
	}
	return "Up", agreed
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
		// Monitor.autoIncidents off: watch it, chart it, don't page for it.
		// Checked before the maintenance window because it is the cheaper
		// question (a column already in hand, versus a query) and answers the
		// same way regardless of what maintenance says.
		if !monitor.AutoIncidents {
			logging.Info(fmt.Sprintf("[%s] %s is %s but has automatic incidents switched off — no incident, no alert",
				workerLabel, monitor.Name, strings.ToLower(status)))
			return
		}

		suppressed, reason, err := incidents.Suppressed(ctx, s, monitor.ID, monitor.ParentID)
		if err != nil {
			logging.Error(fmt.Sprintf("[%s] Failed to sync incident for %q", workerLabel, monitor.Name), err)
			return
		}
		if suppressed {
			logging.Info(fmt.Sprintf("[%s] %s is %s but %s — skipping incident", workerLabel, monitor.Name, strings.ToLower(status), reason))
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

	// Recovery is deliberately *not* gated on autoIncidents: the switch only
	// suppresses opening incidents. An incident that is already open — opened
	// before the switch was flipped, or by a human — must still be moved to
	// "Monitoring" when the monitor comes back, or flipping the switch
	// mid-outage would strand it as permanently investigating.
	incident, err := incidents.NoteMonitorRecovered(ctx, s, ref)
	if err != nil {
		logging.Error(fmt.Sprintf("[%s] Failed to sync incident for %q", workerLabel, monitor.Name), err)
		return
	}
	if incident != nil {
		logging.Info(fmt.Sprintf("[%s] Incident %s moved to Monitoring after recovery", workerLabel, incident.ID))
	}
}
