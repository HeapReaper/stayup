package maintenance

import (
	"context"
	"fmt"
	"strings"
	"time"

	"stayup/worker/internal/logging"
	"stayup/worker/internal/notify"
	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
)

// This file is the clock-driven half of src/lib/maintenance-notify.ts.
//
// A maintenance window has four announcements and two senders. The dashboard
// sends the two a person triggers (Scheduled, Cancelled); this sends the two
// a clock triggers (Started, Ended), because nothing in the Next.js app is
// awake at 02:00 to notice a window opening. Both halves have to produce the
// same wording, which is why BuildAnnouncement below mirrors
// buildAnnouncement() line for line.

// The IntegrationDelivery.event value every maintenance announcement carries
// — mirrors MAINTENANCE_EVENT.
const maintenanceEvent = "Maintenance Notice"

// announceGrace bounds how far back a transition may be and still be worth
// announcing.
//
// Without it, the first tick after an upgrade (or after a worker was down
// overnight) would mail out every window that started or ended while nobody
// was watching. An announcement that the work has begun is only useful while
// it is roughly true; an hour late it is noise, so the sweep silently lets it
// go rather than sending it stale.
const announceGrace = time.Hour

// phaseLabels mirrors PHASE_LABELS.
var phaseLabels = map[store.MaintenanceNotifyPhase]string{
	store.MaintenanceStarted: "Maintenance started",
	store.MaintenanceEnded:   "Maintenance finished",
}

// formatWindowTime mirrors formatWindowTime(): always UTC, always labelled.
// The audience is status page subscribers, who have no reason to know what
// this instance's configured timezone is.
func formatWindowTime(t time.Time) string {
	return t.UTC().Format("2006-01-02 15:04") + " UTC"
}

// Announcement is the subject and body of one maintenance announcement.
type Announcement struct {
	Subject    string
	Message    string
	PhaseLabel string
	Affected   string
}

// BuildAnnouncement mirrors buildAnnouncement() in
// src/lib/maintenance-notify.ts — same sentences, same order, same UTC
// formatting, so a window that is announced as scheduled by the dashboard and
// as started by this worker reads as one conversation.
func BuildAnnouncement(phase store.MaintenanceNotifyPhase, w store.MaintenanceWindowAnnouncement) Announcement {
	affected := strings.Join(w.MonitorNames, ", ")
	label := phaseLabels[phase]

	var lines []string
	if phase == store.MaintenanceEnded {
		lines = append(lines, fmt.Sprintf("Scheduled maintenance on %s has finished. Everything should be back to normal.", affected))
	} else {
		lines = append(lines, fmt.Sprintf("Scheduled maintenance on %s has started.", affected))
		lines = append(lines, fmt.Sprintf("Expected to finish by %s.", formatWindowTime(w.EndsAt)))
	}

	// The organiser's own note last, so it reads as detail under the facts
	// rather than competing with them.
	if w.Message != nil && strings.TrimSpace(*w.Message) != "" {
		lines = append(lines, *w.Message)
	}

	return Announcement{
		Subject:    fmt.Sprintf("[%s] %s", label, w.Title),
		Message:    strings.Join(lines, "\n"),
		PhaseLabel: label,
		Affected:   affected,
	}
}

// AnnounceDueWindows sends the Started and Ended announcements for every
// window that has just crossed into them. Called on a timer from
// cmd/integrations, which is already the worker that owns "notifications that
// happen on a clock rather than on a check".
func AnnounceDueWindows(ctx context.Context, s *store.Store) error {
	now := time.Now()
	cutoff := now.Add(-announceGrace)

	for _, phase := range []store.MaintenanceNotifyPhase{store.MaintenanceStarted, store.MaintenanceEnded} {
		windows, err := s.MaintenanceWindowsDueFor(ctx, phase, now, cutoff)
		if err != nil {
			return err
		}

		for _, window := range windows {
			announce(ctx, s, phase, window)

			// Stamped even when some of the sends above failed. A partial
			// announcement is a nuisance; one that repeats every five seconds
			// until the mail server comes back is an incident of its own.
			if err := s.MarkMaintenanceNotified(ctx, window.ID, phase, time.Now()); err != nil {
				logging.Error(fmt.Sprintf("[Maintenance] Failed to mark %q as announced (%s)", window.Title, phase), err)
			}
		}
	}

	return nil
}

func announce(ctx context.Context, s *store.Store, phase store.MaintenanceNotifyPhase, window store.MaintenanceWindowAnnouncement) {
	announcement := BuildAnnouncement(phase, window)

	if err := queueIntegrationDeliveries(ctx, s, announcement); err != nil {
		logging.Error(fmt.Sprintf("[Maintenance] Failed to queue announcement for %q", window.Title), err)
	}
	if err := notifyStatusPageSubscribers(ctx, s, phase, window, announcement); err != nil {
		logging.Error(fmt.Sprintf("[Maintenance] Failed to notify subscribers of %q", window.Title), err)
	}

	logging.Info(fmt.Sprintf("[Maintenance] Announced %q (%s)", window.Title, phase))
}

// queueIntegrationDeliveries mirrors the same function in
// src/lib/maintenance-notify.ts: a broadcast to every enabled Integration,
// deliberately *not* routed through the NotificationRule layer. Those rules
// match on monitor, tag and impact, and a maintenance window has no impact —
// a rule that suppresses out-of-hours pages would silently eat the
// announcement saying the work is happening out of hours.
func queueIntegrationDeliveries(ctx context.Context, s *store.Store, announcement Announcement) error {
	integrations, err := s.ListEnabledIntegrations(ctx)
	if err != nil {
		return err
	}
	if len(integrations) == 0 {
		return nil
	}

	ids := make([]string, len(integrations))
	for i, integ := range integrations {
		ids[i] = integ.ID
	}

	return s.CreateBroadcastDeliveries(ctx, ids, maintenanceEvent,
		fmt.Sprintf("%s: %s", announcement.Subject, announcement.Message))
}

// notifyStatusPageSubscribers reaches the same audience an incident update
// reaches: everyone subscribed to a published status page carrying any of the
// affected monitors, de-duplicated by (channel, target).
func notifyStatusPageSubscribers(
	ctx context.Context,
	s *store.Store,
	phase store.MaintenanceNotifyPhase,
	window store.MaintenanceWindowAnnouncement,
	announcement Announcement,
) error {
	subs, err := s.StatusPageSubscribersForMonitors(ctx, window.MonitorIDs)
	if err != nil {
		return err
	}
	if len(subs) == 0 {
		return nil
	}

	cfg, err := settings.Get(ctx, s)
	if err != nil {
		return err
	}

	sent := 0
	for _, sub := range subs {
		var err error
		if sub.Channel == "Discord" {
			// No AlertContext: a maintenance announcement has no incident,
			// no response time and no uptime figure to put in embed fields.
			err = notify.SendDiscordAlert(sub.Target, announcement.Subject, announcement.Message, notify.AlertContext{})
		} else {
			err = notify.SendEmail(cfg.SMTP, sub.Target, announcement.Subject, notify.MaintenanceTemplate(), notify.MaintenanceData{
				PhaseLabel: announcement.PhaseLabel,
				PhaseColor: notify.MaintenancePhaseColor(string(phase)),
				Title:      window.Title,
				Message:    announcement.Message,
				Affected:   announcement.Affected,
				LinkURL:    notify.MaintenanceURL(),
			})
		}
		if err != nil {
			continue
		}
		sent++
	}

	logging.Info(fmt.Sprintf("[Maintenance] Notified %d/%d status page subscriber(s) for %q", sent, len(subs), window.Title))
	return nil
}
