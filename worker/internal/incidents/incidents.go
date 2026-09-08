// Package incidents mirrors src/lib/incidents.ts's worker-facing half: the
// incident lifecycle triggered by monitor checks (open/recover) and by the
// escalation clock. Actual Integration delivery is a separate, queued step —
// this package only ever writes Pending IntegrationDelivery rows; sending
// them is cmd/integrations's job (internal/delivery), same as on the TS side.
package incidents

import (
	"context"
	"fmt"
	"time"

	"stayup/worker/internal/delivery"
	"stayup/worker/internal/dependencies"
	"stayup/worker/internal/logging"
	"stayup/worker/internal/maintenance"
	"stayup/worker/internal/notify"
	"stayup/worker/internal/oncall"
	"stayup/worker/internal/routing"
	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
)

// MonitorRef is the minimal monitor shape callers need — mirrors MonitorRef
// in src/lib/incidents.ts.
type MonitorRef struct {
	ID   string
	Name string
}

// Suppressed answers the one question every "this monitor is failing" path
// has to ask before opening an incident: is this failure already explained by
// something we know about?
//
// Two reasons, checked in cost order. A maintenance window is somebody
// telling us in advance that this monitor will fail. An ancestor that is Down
// is the same statement made by the topology — the router being dead explains
// all thirty monitors behind it, and paging for each of them is thirty pages
// about one outage, which is exactly what failedAttemptsThreshold and
// flapping detection cannot fix (both reason about one monitor over time).
//
// Suppression only ever skips *opening* an incident, exactly like
// Monitor.autoIncidents: an incident that is already open still closes out on
// recovery, so a window starting or a parent falling over mid-outage can't
// strand one.
//
// Callers pass parentID (which they already hold) purely so a monitor without
// a dependency skips the walk entirely — which is most of them.
func Suppressed(ctx context.Context, s *store.Store, monitorID string, parentID *string) (bool, string, error) {
	underMaintenance, err := maintenance.IsMonitorUnderMaintenance(ctx, s, monitorID)
	if err != nil {
		return false, "", err
	}
	if underMaintenance {
		return true, "under maintenance", nil
	}

	if parentID == nil {
		return false, "", nil
	}

	ancestorDown, err := dependencies.IsAncestorDown(ctx, s, monitorID)
	if err != nil {
		return false, "", err
	}
	if ancestorDown {
		return true, "something it depends on is down", nil
	}

	return false, "", nil
}

// EnsureIncidentForMonitor mirrors ensureIncidentForMonitor(): opens a new
// incident for a Down/Degraded monitor, unless one is already open.
func EnsureIncidentForMonitor(ctx context.Context, s *store.Store, monitor MonitorRef, status, message string) (store.Incident, error) {
	existing, err := s.FindOpenIncidentForMonitor(ctx, monitor.ID)
	if err != nil {
		return store.Incident{}, err
	}
	if existing != nil {
		return *existing, nil
	}

	impact, verb := "Critical", "is down"
	if status == "Degraded" {
		impact, verb = "Minor", "is degraded"
	}
	monitorID := monitor.ID

	return createIncident(ctx, s, createIncidentInput{
		Title:     fmt.Sprintf("%s %s", monitor.Name, verb),
		Impact:    impact,
		Message:   message,
		MonitorID: &monitorID,
	})
}

// NoteMonitorRecovered mirrors noteMonitorRecovered(): moves a monitor's open
// incident to "Monitoring" once it recovers. Returns nil if there's nothing
// to update (no open incident, or already Monitoring).
func NoteMonitorRecovered(ctx context.Context, s *store.Store, monitor MonitorRef) (*store.Incident, error) {
	existing, err := s.FindOpenIncidentForMonitor(ctx, monitor.ID)
	if err != nil {
		return nil, err
	}
	if existing == nil || existing.Status == "Monitoring" {
		return nil, nil
	}

	updated, err := postIncidentUpdate(ctx, s, store.UpdateIncidentStatusInput{
		IncidentID: existing.ID,
		Status:     "Monitoring",
		Message:    fmt.Sprintf("%s has recovered and is responding normally. Continuing to monitor for stability.", monitor.Name),
	})
	if err != nil {
		return nil, err
	}
	return &updated, nil
}

// EscalateOverdueIncidents mirrors escalateOverdueIncidents(): pages the next
// due step of every overdue, unacknowledged, escalation-policy incident.
// Called on a timer from cmd/integrations, same as on the TS side.
func EscalateOverdueIncidents(ctx context.Context, s *store.Store) error {
	now := time.Now()

	candidates, err := s.OverdueEscalationCandidates(ctx)
	if err != nil {
		return err
	}

	stepsCache := map[string][]store.EscalationStep{}

	for _, incident := range candidates {
		var policyID string
		if incident.Monitor != nil && incident.Monitor.EscalationPolicyID != nil {
			policyID = *incident.Monitor.EscalationPolicyID
		}
		if policyID == "" {
			continue
		}

		steps, ok := stepsCache[policyID]
		if !ok {
			steps, err = s.EscalationSteps(ctx, policyID)
			if err != nil {
				logging.Error(fmt.Sprintf("[Incidents] Failed to load escalation steps for policy %s", policyID), err)
				continue
			}
			stepsCache[policyID] = steps
		}

		if incident.EscalationStep >= len(steps) {
			continue // chain exhausted — nothing left to page
		}
		step := steps[incident.EscalationStep]

		since := incident.CreatedAt
		if incident.LastEscalatedAt != nil {
			since = *incident.LastEscalatedAt
		}
		if now.Sub(since) < time.Duration(step.DelayMinutes)*time.Minute {
			continue // not due yet
		}

		target := resolveStepTarget(ctx, s, step, now)

		if target.integrationID != "" && target.enabled {
			monitorLabel := ""
			if incident.Monitor != nil {
				monitorLabel = fmt.Sprintf(" (%s)", incident.Monitor.Name)
			}
			message := fmt.Sprintf("[Step %d/%d] %q%s is still unacknowledged.", incident.EscalationStep+1, len(steps), incident.Title, monitorLabel)
			if err := s.CreateEscalationDelivery(ctx, target.integrationID, incident.ID, "Escalation Alert", message); err != nil {
				logging.Error(fmt.Sprintf("[Incidents] Failed to queue escalation delivery for %s", incident.ID), err)
				continue
			}
		}

		// The step is recorded as fired even when it paged nobody — an
		// unstaffed rotation or a disabled integration must not stall the
		// chain, or the incident would sit on a step that can never deliver
		// and never reach the steps below it.
		if err := s.RecordEscalation(ctx, incident.ID, now); err != nil {
			logging.Error(fmt.Sprintf("[Incidents] Failed to record escalation for %s", incident.ID), err)
			continue
		}

		logging.Info(fmt.Sprintf("[Incidents] Escalated %s to step %d/%d (%s)", incident.ID, incident.EscalationStep+1, len(steps), target.label))
	}

	return nil
}

// stepTarget is where one escalation step actually pages, after a rotation
// step has been resolved to a person.
type stepTarget struct {
	integrationID string
	enabled       bool
	// Human-readable, for the log line that says who was paged.
	label string
}

// resolveStepTarget turns a step into a concrete Integration. A fixed step is
// already one; a rotation step asks internal/oncall who holds the pager *now*
// — not who held it when the incident opened, which is the whole point of
// escalating on a clock.
func resolveStepTarget(ctx context.Context, s *store.Store, step store.EscalationStep, now time.Time) stepTarget {
	if step.Integration != nil {
		return stepTarget{integrationID: step.Integration.ID, enabled: step.Integration.Enabled, label: step.Integration.Name}
	}

	if step.OnCallScheduleID == nil {
		return stepTarget{label: "no target"}
	}

	schedule, err := s.OnCallScheduleByID(ctx, *step.OnCallScheduleID)
	if err != nil {
		logging.Error(fmt.Sprintf("[Incidents] Failed to load on-call schedule %s", *step.OnCallScheduleID), err)
		return stepTarget{label: "unreadable on-call schedule"}
	}
	if schedule == nil {
		return stepTarget{label: "missing on-call schedule"}
	}

	resolution := oncall.At(*schedule, now)
	if resolution.Participant == nil {
		logging.Warn(fmt.Sprintf("[Incidents] Nobody is on call for %q: %s", schedule.Name, resolution.Reason))
		return stepTarget{label: fmt.Sprintf("on call for %s: nobody", schedule.Name)}
	}

	label := fmt.Sprintf("on call for %s: %s", schedule.Name, resolution.Participant.Name)
	if resolution.Overridden {
		label += " (override)"
	}
	return stepTarget{
		integrationID: resolution.Participant.IntegrationID,
		enabled:       resolution.Participant.Integration.Enabled,
		label:         label,
	}
}

type createIncidentInput struct {
	Title     string
	Impact    string
	Message   string
	MonitorID *string
}

// createIncident mirrors createIncident() in src/lib/incidents.ts: inserts
// the incident + its first timeline entry, then fires the same-shape
// notifications (status page subscribers, Integration broadcast-or-escalate).
// Notification failures are logged, not returned — the incident itself is
// already committed by the time they run.
func createIncident(ctx context.Context, s *store.Store, in createIncidentInput) (store.Incident, error) {
	incident, err := s.CreateIncident(ctx, store.CreateIncidentInput{
		Title:     in.Title,
		Impact:    in.Impact,
		Status:    "Investigating",
		Message:   in.Message,
		MonitorID: in.MonitorID,
	})
	if err != nil {
		return store.Incident{}, err
	}

	logging.Info(fmt.Sprintf("[Incidents] Created %q (%s) %s", incident.Title, in.Impact, incident.ID))

	if err := notifyStatusPageSubscribers(ctx, s, incident.ID, incident.MonitorID, incident.Title, incident.Status, in.Message); err != nil {
		logging.Error("[Incidents] Failed to notify status page subscribers", err)
	}
	if err := notifyOrEscalate(ctx, s, incident, incident.Status, in.Message); err != nil {
		logging.Error("[Incidents] Failed to queue Integration notification", err)
	}

	return incident, nil
}

// postIncidentUpdate mirrors postIncidentUpdate(): appends a timeline entry,
// rolls the incident's status forward, and fires the same notifications as
// createIncident plus the incident's own email subscribers.
func postIncidentUpdate(ctx context.Context, s *store.Store, in store.UpdateIncidentStatusInput) (store.Incident, error) {
	incident, err := s.UpdateIncidentStatus(ctx, in)
	if err != nil {
		return store.Incident{}, err
	}

	logging.Info(fmt.Sprintf("[Incidents] %s -> %s: %s", incident.ID, in.Status, in.Message))

	monitorName := ""
	if incident.Monitor != nil {
		monitorName = incident.Monitor.Name
	}
	if err := notifySubscribers(ctx, s, incident.ID, incident.Title, monitorName, in.Status, in.Message); err != nil {
		logging.Error("[Incidents] Failed to notify incident subscribers", err)
	}
	if err := notifyStatusPageSubscribers(ctx, s, incident.ID, incident.MonitorID, incident.Title, in.Status, in.Message); err != nil {
		logging.Error("[Incidents] Failed to notify status page subscribers", err)
	}
	if err := notifyOrEscalate(ctx, s, incident, in.Status, in.Message); err != nil {
		logging.Error("[Incidents] Failed to queue Integration notification", err)
	}

	return incident, nil
}

// notifySubscribers emails everyone subscribed to this specific incident —
// mirrors notifySubscribers().
func notifySubscribers(ctx context.Context, s *store.Store, incidentID, incidentTitle, monitorName, status, message string) error {
	emails, err := s.IncidentSubscriberEmails(ctx, incidentID)
	if err != nil {
		return err
	}
	if len(emails) == 0 {
		return nil
	}

	// Read once per notification rather than per recipient — the mail server
	// is instance-wide (Settings -> SMTP, merged over the SMTP_* environment).
	cfg, err := settings.Get(ctx, s)
	if err != nil {
		return err
	}

	sent := 0
	for _, email := range emails {
		err := notify.SendEmail(cfg.SMTP, email, fmt.Sprintf("[%s] %s", status, incidentTitle), notify.IncidentUpdateTemplate(), notify.IncidentUpdateData{
			IncidentTitle: incidentTitle,
			Status:        status,
			StatusColor:   notify.StatusColor(status),
			Message:       message,
			MonitorName:   monitorName,
			IncidentURL:   notify.IncidentsURL(),
		})
		if err != nil {
			continue
		}
		sent++
	}
	logging.Info(fmt.Sprintf("[Incidents] Notified %d/%d subscriber(s) for %s", sent, len(emails), incidentID))
	return nil
}

// notifyStatusPageSubscribers mirrors notifyStatusPageSubscribers(): emails
// or Discord-webhooks everyone subscribed to a published status page that
// includes this monitor.
func notifyStatusPageSubscribers(ctx context.Context, s *store.Store, incidentID string, monitorID *string, incidentTitle, status, message string) error {
	if monitorID == nil {
		return nil
	}

	subs, err := s.StatusPageSubscribersForMonitor(ctx, *monitorID)
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

	// Detail for the Discord embeds below, from the same query the queued
	// deliveries use (cmd/integrations) so both render identical fields. Only
	// worth the round trip if someone actually subscribed over Discord, and a
	// failure costs the fields rather than the notification.
	var alertCtx notify.AlertContext
	if hasDiscordSubscriber(subs) {
		alert, err := s.AlertForIncident(ctx, incidentID)
		if err != nil {
			logging.Error(fmt.Sprintf("[Incidents] Could not load incident detail for %s", incidentID), err)
		}
		alertCtx = delivery.AlertContextFrom(alert)
	}

	sent := 0
	for _, sub := range subs {
		var err error
		if sub.Channel == "Discord" {
			err = notify.SendDiscordAlert(sub.Target, fmt.Sprintf("[%s] %s", status, incidentTitle), message, alertCtx)
		} else {
			err = notify.SendEmail(cfg.SMTP, sub.Target, fmt.Sprintf("[%s] %s", status, incidentTitle), notify.IncidentUpdateTemplate(), notify.IncidentUpdateData{
				IncidentTitle: incidentTitle,
				Status:        status,
				StatusColor:   notify.StatusColor(status),
				Message:       message,
				IncidentURL:   notify.IncidentsURL(),
			})
		}
		if err != nil {
			continue
		}
		sent++
	}
	logging.Info(fmt.Sprintf("[Incidents] Notified %d/%d status page subscriber(s) for monitor %s", sent, len(subs), *monitorID))
	return nil
}

func hasDiscordSubscriber(subs []store.StatusPageSubscriber) bool {
	for _, sub := range subs {
		if sub.Channel == "Discord" {
			return true
		}
	}
	return false
}

// notifyOrEscalate mirrors notifyOrEscalate(): the normal broadcast to every
// enabled Integration, unless the incident's monitor has an EscalationPolicy
// attached — in which case escalation steps page instead (see
// EscalateOverdueIncidents).
func notifyOrEscalate(ctx context.Context, s *store.Store, incident store.Incident, status, message string) error {
	if incident.Monitor != nil && incident.Monitor.EscalationPolicyID != nil {
		logging.Info(fmt.Sprintf("[Incidents] %s is on an escalation policy — skipping the Integration broadcast, escalation steps will page instead", incident.ID))
		return nil
	}

	decision, err := routeFor(ctx, s, incident)
	if err != nil {
		// A rule that can't be read must not silence an alert — fall back to
		// the default broadcast, which is the safe direction to fail in.
		logging.Error(fmt.Sprintf("[Incidents] Could not evaluate notification rules for %s — broadcasting", incident.ID), err)
		return queueIntegrationDeliveries(ctx, s, incident.ID, incident.Title, status, message)
	}

	switch decision.Kind {
	case routing.Suppress:
		logging.Info(fmt.Sprintf("[Incidents] %s not notified: %s", incident.ID, decision.Reason))
		return nil

	case routing.Route:
		if len(decision.IntegrationIDs) == 0 {
			logging.Warn(fmt.Sprintf("[Incidents] Rule %q matched %s but has no enabled integrations — nobody was notified",
				decision.RuleName, incident.ID))
			return nil
		}
		logging.Info(fmt.Sprintf("[Incidents] %s routed by rule %q to %d integration(s)",
			incident.ID, decision.RuleName, len(decision.IntegrationIDs)))
		return s.CreateDeliveries(ctx, decision.IntegrationIDs, incident.ID, "Incident Alert",
			fmt.Sprintf("[%s] %s: %s", status, incident.Title, message))

	default:
		return queueIntegrationDeliveries(ctx, s, incident.ID, incident.Title, status, message)
	}
}

// routeFor evaluates the notification rules against this incident. Mirrors
// the same call in notifyOrEscalate() on the TypeScript side.
func routeFor(ctx context.Context, s *store.Store, incident store.Incident) (routing.Decision, error) {
	rules, err := s.ListNotificationRules(ctx)
	if err != nil {
		return routing.Decision{}, err
	}
	if len(rules) == 0 {
		return routing.Decision{Kind: routing.Broadcast}, nil
	}

	cfg, err := settings.Get(ctx, s)
	if err != nil {
		return routing.Decision{}, err
	}

	impact, err := s.IncidentImpact(ctx, incident.ID)
	if err != nil {
		return routing.Decision{}, err
	}

	var tagIDs []string
	if incident.MonitorID != nil {
		if tagIDs, err = s.MonitorTagIDs(ctx, *incident.MonitorID); err != nil {
			return routing.Decision{}, err
		}
	}

	return routing.Decide(rules, routing.Context{
		MonitorID:     incident.MonitorID,
		MonitorTagIDs: tagIDs,
		Impact:        impact,
	}, time.Now(), cfg.Timezone), nil
}

// queueIntegrationDeliveries mirrors queueIntegrationDeliveries(): one
// Pending IntegrationDelivery row per enabled Integration.
func queueIntegrationDeliveries(ctx context.Context, s *store.Store, incidentID, incidentTitle, status, message string) error {
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

	if err := s.CreateDeliveries(ctx, ids, incidentID, "Incident Alert", fmt.Sprintf("[%s] %s: %s", status, incidentTitle, message)); err != nil {
		return err
	}

	logging.Info(fmt.Sprintf("[Incidents] Queued %d integration deliver%s for %s", len(integrations), pluralY(len(integrations)), incidentID))
	return nil
}

func pluralY(n int) string {
	if n == 1 {
		return "y"
	}
	return "ies"
}
