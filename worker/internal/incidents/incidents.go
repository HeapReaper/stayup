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

	"stayup/worker/internal/logging"
	"stayup/worker/internal/notify"
	"stayup/worker/internal/store"
)

// incidentURL matches the hardcoded default in
// src/emails/incident-update-email.tsx — nothing on the TS side ever passes
// a different one, so there's nothing to port here.
const incidentURL = "http://localhost:3000/dashboard/incidents"

// MonitorRef is the minimal monitor shape callers need — mirrors MonitorRef
// in src/lib/incidents.ts.
type MonitorRef struct {
	ID   string
	Name string
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

		if step.Integration.Enabled {
			monitorLabel := ""
			if incident.Monitor != nil {
				monitorLabel = fmt.Sprintf(" (%s)", incident.Monitor.Name)
			}
			message := fmt.Sprintf("[Step %d/%d] %q%s is still unacknowledged.", incident.EscalationStep+1, len(steps), incident.Title, monitorLabel)
			if err := s.CreateEscalationDelivery(ctx, step.IntegrationID, incident.ID, "Escalation Alert", message); err != nil {
				logging.Error(fmt.Sprintf("[Incidents] Failed to queue escalation delivery for %s", incident.ID), err)
				continue
			}
		}

		if err := s.RecordEscalation(ctx, incident.ID, now); err != nil {
			logging.Error(fmt.Sprintf("[Incidents] Failed to record escalation for %s", incident.ID), err)
			continue
		}

		logging.Info(fmt.Sprintf("[Incidents] Escalated %s to step %d/%d (%s)", incident.ID, incident.EscalationStep+1, len(steps), step.Integration.Name))
	}

	return nil
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

	if err := notifyStatusPageSubscribers(ctx, s, incident.MonitorID, incident.Title, incident.Status, in.Message); err != nil {
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
	if err := notifyStatusPageSubscribers(ctx, s, incident.MonitorID, incident.Title, in.Status, in.Message); err != nil {
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

	sent := 0
	for _, email := range emails {
		err := notify.SendEmail(email, fmt.Sprintf("[%s] %s", status, incidentTitle), notify.IncidentUpdateTemplate(), notify.IncidentUpdateData{
			IncidentTitle: incidentTitle,
			Status:        status,
			StatusColor:   notify.StatusColor(status),
			Message:       message,
			MonitorName:   monitorName,
			IncidentURL:   incidentURL,
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
func notifyStatusPageSubscribers(ctx context.Context, s *store.Store, monitorID *string, incidentTitle, status, message string) error {
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

	sent := 0
	for _, sub := range subs {
		var err error
		if sub.Channel == "Discord" {
			err = notify.SendDiscordWebhook(sub.Target, fmt.Sprintf("**[%s] %s**\n%s", status, incidentTitle, message))
		} else {
			err = notify.SendEmail(sub.Target, fmt.Sprintf("[%s] %s", status, incidentTitle), notify.IncidentUpdateTemplate(), notify.IncidentUpdateData{
				IncidentTitle: incidentTitle,
				Status:        status,
				StatusColor:   notify.StatusColor(status),
				Message:       message,
				IncidentURL:   incidentURL,
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

// notifyOrEscalate mirrors notifyOrEscalate(): the normal broadcast to every
// enabled Integration, unless the incident's monitor has an EscalationPolicy
// attached — in which case escalation steps page instead (see
// EscalateOverdueIncidents).
func notifyOrEscalate(ctx context.Context, s *store.Store, incident store.Incident, status, message string) error {
	if incident.Monitor != nil && incident.Monitor.EscalationPolicyID != nil {
		logging.Info(fmt.Sprintf("[Incidents] %s is on an escalation policy — skipping the Integration broadcast, escalation steps will page instead", incident.ID))
		return nil
	}
	return queueIntegrationDeliveries(ctx, s, incident.ID, incident.Title, status, message)
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
