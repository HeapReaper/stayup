// Command heartbeat is the worker for the two push monitor types — the dead
// man's switch. It is the only worker that checks monitors by *not* being
// called: the thing on the other end reports in (a cron job to
// /api/heartbeat/<token>, a server agent to /api/agent/<token>, both recorded
// by the Next.js app), and this binary notices when that stops arriving.
//
// That inversion is why it doesn't build on internal/runner. The runner's
// whole shape is "poll for due monitors, perform a check, persist the
// result"; here there is no check to perform and nothing to dial. What it
// shares with every other worker is everything after the result: the same
// MonitorCheck row, the same rolled-up status, the same incident path
// (internal/incidents), so a silent cron job pages exactly like a dead web
// server.
package main

import (
	"context"
	"fmt"
	"math"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"stayup/worker/internal/db"
	"stayup/worker/internal/incidents"
	"stayup/worker/internal/logging"
	"stayup/worker/internal/procstat"
	"stayup/worker/internal/region"
	"stayup/worker/internal/store"
	"stayup/worker/internal/version"
)

const (
	// The tightest heartbeat a monitor can be set to is 15s, so looking twice
	// per shortest interval is all the resolution this can use — and half the
	// polling of a table that, by definition, mostly doesn't change.
	tickInterval = 10 * time.Second

	// How late a ping may be, on top of the monitor's interval, before it
	// counts as missed — for monitors that don't set their own. Must stay in
	// step with DEFAULT_HEARTBEAT_GRACE_SECONDS in src/lib/monitor-types.ts.
	defaultGrace = 60 * time.Second

	// Same window internal/runner recomputes uptime over.
	uptimeWindow = 30 * 24 * time.Hour
)

// sweep records a missed heartbeat for every monitor whose deadline has
// passed, and opens its incident.
//
// A monitor that is already Down is deliberately swept again rather than
// skipped: its deadline has moved forward by one interval (the check row this
// writes updates lastCheckedAt), so a job that stays silent keeps producing
// check rows at the cadence it would have produced them at if it were
// healthy. Without that, a week-long outage would be one Down row against
// thousands of Up ones and the uptime percentage would barely move.
func sweep(ctx context.Context, s *store.Store) {
	monitors, err := s.ListHeartbeatMonitors(ctx)
	if err != nil {
		logging.Error("[heartbeat-worker] Tick failed", err)
		return
	}

	now := time.Now()
	for _, monitor := range monitors {
		deadline := monitor.Deadline(defaultGrace)
		if now.Before(deadline) {
			continue
		}
		if err := recordMissed(ctx, s, monitor, now, deadline); err != nil {
			logging.Error(fmt.Sprintf("[heartbeat-worker] Failed to record missed %s for %q", noun(monitor.Type), monitor.Name), err)
		}
	}
}

// noun is what stopped arriving, so the check message and the incident read
// naturally for both push types rather than telling an operator their server
// "missed a heartbeat".
func noun(monitorType string) string {
	if monitorType == "Server" {
		return "agent report"
	}
	return "heartbeat"
}

func recordMissed(ctx context.Context, s *store.Store, monitor store.HeartbeatMonitor, now, deadline time.Time) error {
	late := now.Sub(deadline).Round(time.Second)
	message := fmt.Sprintf("No %s received — %s past the deadline", noun(monitor.Type), late)
	zero := 0

	// The raw row first, and unconditionally: check history records what
	// actually happened (invariant 8 in AGENTS.md), and "nothing happened" is
	// the whole signal for this monitor type.
	// No region: nothing performed this check. A heartbeat monitor fails by
	// nobody calling in, which happens everywhere and nowhere.
	if err := s.CreateCheck(ctx, monitor.ID, "Down", nil, &zero, &message, "", now); err != nil {
		return err
	}

	total, up, err := s.UptimeCounts(ctx, monitor.ID, now.Add(-uptimeWindow))
	if err != nil {
		return err
	}
	uptime := 100.0
	if total > 0 {
		uptime = math.Round(float64(up)/float64(total)*10_000) / 100
	}

	// Writing lastCheckedAt = now is what moves the deadline forward, which
	// is what keeps this from firing again on the next tick ten seconds from
	// now. There is no confirmedStatus debounce here on purpose: the grace
	// period already is the debounce, and it is expressed in the unit that
	// makes sense for a scheduled job (seconds late) rather than in checks.
	if err := s.UpdateCheckResult(ctx, monitor.ID, "Down", 0, uptime, now, nil, nil); err != nil {
		return err
	}

	if monitor.Status != "Down" {
		logging.Warn(fmt.Sprintf("[heartbeat-worker] ✗ %s has not checked in (%s past its deadline)", monitor.Name, late))
	}

	syncIncident(ctx, s, monitor, late)
	return nil
}

// syncIncident opens the monitor's incident, applying the same three gates
// internal/runner applies to a failing check — a monitor with automatic
// incidents switched off, one under maintenance and one whose parent is
// already Down all page nobody, and have to behave identically here or the
// two paths would drift.
//
// Recovery is not handled here at all: a heartbeat recovers by *arriving*,
// which happens in the Next.js ping endpoint, so noteMonitorRecovered lives
// on that side (src/lib/heartbeat.ts).
func syncIncident(ctx context.Context, s *store.Store, monitor store.HeartbeatMonitor, late time.Duration) {
	if !monitor.AutoIncidents {
		return
	}

	suppressed, reason, err := incidents.Suppressed(ctx, s, monitor.ID, monitor.ParentID)
	if err != nil {
		logging.Error(fmt.Sprintf("[heartbeat-worker] Failed to sync incident for %q", monitor.Name), err)
		return
	}
	if suppressed {
		logging.Info(fmt.Sprintf("[heartbeat-worker] %s missed its %s but %s — skipping incident", monitor.Name, noun(monitor.Type), reason))
		return
	}

	message := fmt.Sprintf(
		"Automatically detected: %s has not checked in. Its last %s is %s past the deadline (expected every %s).",
		monitor.Name, noun(monitor.Type), late, monitor.Interval)

	incident, err := incidents.EnsureIncidentForMonitor(ctx, s, incidents.MonitorRef{ID: monitor.ID, Name: monitor.Name}, "Down", message)
	if err != nil {
		logging.Error(fmt.Sprintf("[heartbeat-worker] Failed to sync incident for %q", monitor.Name), err)
		return
	}
	logging.Warn(fmt.Sprintf("[heartbeat-worker] Incident open for %s: %s (%s)", monitor.Name, incident.Title, incident.ID))
}

func tick(ctx context.Context, s *store.Store, startedAt time.Time) {
	// First thing in the tick, before any work that can fail — same contract
	// as internal/runner: "is this process still ticking" is a different
	// question from "is anything checking in".
	if err := s.RecordHeartbeat(ctx, store.Heartbeat{
		Worker:          "heartbeat",
		Region:          region.Current(),
		IntervalSeconds: int(tickInterval.Seconds()),
		StartedAt:       startedAt,
		LastSeenAt:      time.Now(),
		Version:         version.Current(),
		Revision:        version.Revision(),
		MemoryKB:        procstat.ResidentKB(),
	}); err != nil {
		logging.Error("[heartbeat-worker] Failed to record heartbeat", err)
	}

	sweep(ctx, s)
}

func main() {
	_ = godotenv.Load()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	conn, err := db.Open()
	if err != nil {
		logging.Error("[heartbeat-worker] Fatal error", err)
		os.Exit(1)
	}
	defer conn.Close()

	s := store.New(conn)

	logging.Info(fmt.Sprintf("[heartbeat-worker] Started (%s) — polling every %ds", version.Current(), int(tickInterval.Seconds())))

	startedAt := time.Now()

	for {
		// A tick already in flight when the shutdown signal arrives runs to
		// completion — see the matching comment in internal/runner.Run.
		tick(context.Background(), s, startedAt)

		select {
		case <-ctx.Done():
			logging.Info("[heartbeat-worker] Received shutdown signal, shutting down...")
			return
		case <-time.After(tickInterval):
		}
	}
}
