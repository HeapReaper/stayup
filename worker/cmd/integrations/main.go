// Command integrations is the standalone worker that delivers queued
// Integration notifications (Discord, Slack, generic Webhook, Telegram,
// Email, PagerDuty, Push) and pages overdue escalation-policy steps —
// mirrors src/workers/integrations.ts.
//
// It doesn't check monitors, so it doesn't build on internal/runner — a
// different domain (delivery queue, not scheduled checks) with its own small
// poll loop, following the same shape as the other workers.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"stayup/worker/internal/db"
	"stayup/worker/internal/delivery"
	"stayup/worker/internal/incidents"
	"stayup/worker/internal/logging"
	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
)

const (
	tickInterval = 5 * time.Second
	batchSize    = 20
	maxAttempts  = 5
)

func processDelivery(ctx context.Context, s *store.Store, cfg settings.Settings, d store.IntegrationDelivery) {
	result := delivery.Deliver(d.Integration, d.Event, d.Message, cfg)
	attempts := d.Attempts + 1
	label := fmt.Sprintf("%q via %s (%s)", d.Event, d.Integration.Name, d.Integration.Type)

	if result.Success {
		if err := s.MarkDeliverySent(ctx, d.ID, attempts); err != nil {
			logging.Error(fmt.Sprintf("[integrations-worker] Failed to record delivery of %s", label), err)
			return
		}
		logging.Info(fmt.Sprintf("[integrations-worker] ✓ Delivered %s", label))
		return
	}

	if attempts >= maxAttempts {
		if err := s.MarkDeliveryFailed(ctx, d.ID, attempts, result.Error); err != nil {
			logging.Error(fmt.Sprintf("[integrations-worker] Failed to record delivery failure of %s", label), err)
			return
		}
		logging.Error(fmt.Sprintf("[integrations-worker] ✗ Gave up on %s after %d attempts: %s", label, attempts, result.Error), nil)
		return
	}

	if err := s.RecordDeliveryAttempt(ctx, d.ID, attempts, result.Error); err != nil {
		logging.Error(fmt.Sprintf("[integrations-worker] Failed to record delivery attempt of %s", label), err)
		return
	}
	logging.Warn(fmt.Sprintf("[integrations-worker] ⚠ Attempt %d/%d failed for %s: %s", attempts, maxAttempts, label, result.Error))
}

func tick(ctx context.Context, s *store.Store) {
	if err := incidents.EscalateOverdueIncidents(ctx, s); err != nil {
		logging.Error("[integrations-worker] Failed to escalate overdue incidents", err)
	}

	pending, err := s.ListPendingDeliveries(ctx, batchSize)
	if err != nil {
		logging.Error("[integrations-worker] Tick failed", err)
		return
	}
	if len(pending) == 0 {
		return
	}

	cfg, err := settings.Get(ctx, s)
	if err != nil {
		logging.Error("[integrations-worker] Tick failed: could not load settings", err)
		return
	}

	var wg sync.WaitGroup
	for _, d := range pending {
		wg.Add(1)
		go func(d store.IntegrationDelivery) {
			defer wg.Done()
			processDelivery(ctx, s, cfg, d)
		}(d)
	}
	wg.Wait()
}

func main() {
	_ = godotenv.Load()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	conn, err := db.Open()
	if err != nil {
		logging.Error("[integrations-worker] Fatal error", err)
		os.Exit(1)
	}
	defer conn.Close()

	s := store.New(conn)

	logging.Info(fmt.Sprintf("[integrations-worker] Started — polling every %ds", int(tickInterval.Seconds())))

	for {
		// A tick already in flight when the shutdown signal arrives runs to
		// completion — see the matching comment in internal/runner.Run.
		tick(context.Background(), s)

		select {
		case <-ctx.Done():
			logging.Info("[integrations-worker] Received shutdown signal, shutting down...")
			return
		case <-time.After(tickInterval):
		}
	}
}
