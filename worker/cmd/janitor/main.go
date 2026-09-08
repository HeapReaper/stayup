// Command janitor is the housekeeping worker: it rolls finished days of raw
// monitor checks up into monitor_daily_stat and then deletes data past its
// retention window (AppSettings.checkRetentionDays / deliveryRetentionDays,
// both on the Settings page). Since it's already the one worker running on a
// daily rhythm, it also performs the daily update check (internal/updates) —
// the only outbound request StayUp makes that isn't a monitor check or a
// notification, and switchable off on the Settings page's Updates tab.
//
// It has no TypeScript ancestor — nothing ever pruned anything before, so a
// 15-second monitor quietly wrote ~5.8k rows a day forever, and every uptime
// calculation had to scan them. The rollups are what make pruning safe: a
// status page's 90-day history is served from one row per day, so raw checks
// can be dropped long before that history is.
//
// Unlike the check workers this doesn't run every few seconds — it does one
// pass per UTC day (plus one at startup), since that's the granularity of
// everything it produces.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"stayup/worker/internal/db"
	"stayup/worker/internal/logging"
	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
	"stayup/worker/internal/updates"
	"stayup/worker/internal/version"
)

const (
	// How often to check whether the UTC day has rolled over. The pass itself
	// is idempotent, so the exact moment doesn't matter — only that it lands
	// within an hour or so of midnight.
	tickInterval = 15 * time.Minute
	// Rows per DELETE statement; see store.PruneChecksBefore.
	pruneBatchSize = 5_000
)

// truncateDay returns UTC midnight of t's day.
func truncateDay(t time.Time) time.Time {
	utc := t.UTC()
	return time.Date(utc.Year(), utc.Month(), utc.Day(), 0, 0, 0, 0, time.UTC)
}

// rollup aggregates every complete day that doesn't have rollups yet: from the
// day after the newest existing rollup (or the oldest raw check, on a database
// that's never been rolled up) up to — but not including — today, which is
// still in progress and would produce a partial row.
func rollup(ctx context.Context, s *store.Store) error {
	today := truncateDay(time.Now())

	from, err := rollupStart(ctx, s)
	if err != nil {
		return err
	}
	if from == nil || !from.Before(today) {
		return nil
	}

	stats, err := s.AggregateChecksByDay(ctx, *from, today)
	if err != nil {
		return err
	}

	for _, stat := range stats {
		if err := s.UpsertDailyStat(ctx, stat); err != nil {
			return err
		}
	}

	if len(stats) > 0 {
		logging.Info(fmt.Sprintf("[janitor] Rolled up %d monitor-day(s) from %s to %s",
			len(stats), from.Format("2006-01-02"), today.AddDate(0, 0, -1).Format("2006-01-02")))
	}
	return nil
}

func rollupStart(ctx context.Context, s *store.Store) (*time.Time, error) {
	latest, err := s.LatestRollupDay(ctx)
	if err != nil {
		return nil, err
	}
	if latest != nil {
		next := truncateDay(*latest).AddDate(0, 0, 1)
		return &next, nil
	}

	oldest, err := s.OldestCheckDay(ctx)
	if err != nil {
		return nil, err
	}
	if oldest == nil {
		return nil, nil // no checks recorded yet
	}
	start := truncateDay(*oldest)
	return &start, nil
}

// prune enforces both retention windows. Always called after rollup, so no
// raw check is ever deleted before the day it belongs to has been summarized.
func prune(ctx context.Context, s *store.Store, cfg settings.Settings) error {
	now := time.Now()

	checkCutoff := now.AddDate(0, 0, -cfg.CheckRetentionDays)
	deleted, err := s.PruneChecksBefore(ctx, checkCutoff, pruneBatchSize)
	if err != nil {
		return err
	}
	if deleted > 0 {
		logging.Info(fmt.Sprintf("[janitor] Deleted %d check(s) older than %d days", deleted, cfg.CheckRetentionDays))
	}

	deliveryCutoff := now.AddDate(0, 0, -cfg.DeliveryRetentionDays)
	deleted, err = s.PruneDeliveriesBefore(ctx, deliveryCutoff, pruneBatchSize)
	if err != nil {
		return err
	}
	if deleted > 0 {
		logging.Info(fmt.Sprintf("[janitor] Deleted %d finished notification(s) older than %d days", deleted, cfg.DeliveryRetentionDays))
	}
	return nil
}

func pass(ctx context.Context, s *store.Store) {
	cfg, err := settings.Get(ctx, s)
	if err != nil {
		logging.Error("[janitor] Pass failed: could not load settings", err)
		return
	}

	if err := rollup(ctx, s); err != nil {
		logging.Error("[janitor] Failed to roll up daily stats", err)
		return
	}

	if err := prune(ctx, s, cfg); err != nil {
		logging.Error("[janitor] Failed to prune old rows", err)
	}

	// Deliberately last, and deliberately not fatal to the pass: housekeeping
	// is this worker's job, and a GitLab outage must not cost a day of
	// rollups or leave data past its retention.
	if cfg.UpdateCheckEnabled {
		checkForUpdates(ctx, s)
	}
}

// heartbeat records that this worker is still ticking. Written every
// tickInterval (15 minutes) rather than once per pass (once a day), because
// "alive" has to be answerable on a human timescale — a daily row would make
// every reader wait a day to distinguish a stopped janitor from a healthy one.
func heartbeat(ctx context.Context, s *store.Store, startedAt time.Time) {
	if err := s.RecordHeartbeat(ctx, store.Heartbeat{
		Worker:          "janitor",
		IntervalSeconds: int(tickInterval.Seconds()),
		StartedAt:       startedAt,
		LastSeenAt:      time.Now(),
		Version:         version.Current(),
		Revision:        version.Revision(),
	}); err != nil {
		logging.Error("[janitor] Failed to record heartbeat", err)
	}
}

// checkForUpdates records whether a newer StayUp has been published. The
// error is already persisted by updates.Check (the Updates tab reads it) —
// logging it here is what makes it visible in Dashboard -> Logs too.
func checkForUpdates(ctx context.Context, s *store.Store) {
	result, err := updates.Check(ctx, s)
	if err != nil {
		logging.Error("[janitor] Update check failed", err)
		return
	}
	if result.Available {
		logging.Info(fmt.Sprintf("[janitor] Update available: %s (running %s)", result.LatestVersion, version.Current()))
	}
}

func main() {
	_ = godotenv.Load()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	conn, err := db.Open()
	if err != nil {
		logging.Error("[janitor] Fatal error", err)
		os.Exit(1)
	}
	defer conn.Close()

	s := store.New(conn)

	logging.Info(fmt.Sprintf("[janitor] Started (%s) — one pass now, then once per UTC day", version.Current()))

	startedAt := time.Now()
	heartbeat(context.Background(), s, startedAt)

	// A pass already in flight when the shutdown signal arrives runs to
	// completion — same reasoning as internal/runner.Run.
	pass(context.Background(), s)
	lastRunDay := truncateDay(time.Now())

	for {
		select {
		case <-ctx.Done():
			logging.Info("[janitor] Received shutdown signal, shutting down...")
			return
		case <-time.After(tickInterval):
			heartbeat(context.Background(), s, startedAt)

			today := truncateDay(time.Now())
			if today.After(lastRunDay) {
				pass(context.Background(), s)
				lastRunDay = today
			}
		}
	}
}
