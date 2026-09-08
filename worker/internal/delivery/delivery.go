// Package delivery dispatches one Integration notification to the right
// channel — mirrors src/lib/integration-delivery.ts, used by both
// cmd/integrations (queued deliveries) and internal/incidents (escalation
// deliveries share the exact same send path).
package delivery

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"stayup/worker/internal/logging"
	"stayup/worker/internal/notify"
	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
)

type Result struct {
	Success bool
	Error   string
}

func ok() Result             { return Result{Success: true} }
func fail(err string) Result { return Result{Success: false, Error: err} }

// AlertContextFrom turns a joined incident row into what a Discord embed
// shows — the Go half of buildAlertContext() in src/lib/incidents.ts. A nil
// row (a test send, or an incident that has since been deleted) yields an
// empty context, and BuildAlertEmbed then simply omits every field.
func AlertContextFrom(alert *store.IncidentAlert) notify.AlertContext {
	if alert == nil {
		return notify.AlertContext{}
	}

	ctx := notify.AlertContext{
		MonitorName:    alert.MonitorName,
		MonitorType:    alert.MonitorType,
		MonitorURL:     alert.MonitorURL,
		MonitorStatus:  alert.MonitorStatus,
		ResponseTimeMs: alert.ResponseTimeMs,
		Uptime:         alert.Uptime,
		LastCheckedAt:  alert.LastCheckedAt,
	}
	if alert.IncidentID != "" {
		ctx.IncidentID = &alert.IncidentID
	}
	if alert.IncidentStatus != "" {
		ctx.IncidentStatus = &alert.IncidentStatus
	}
	if alert.IncidentImpact != "" {
		ctx.IncidentImpact = &alert.IncidentImpact
	}
	return ctx
}

// Deliver sends one notification through an Integration — mirrors
// deliverToIntegration(). Never returns an error itself; failures come back
// as Result.Error so callers always get a result to persist.
//
// `alert` is what the notification is *about* (which monitor, which incident,
// how slow). Only Discord renders it, as embed fields; every other channel
// still gets subject + message, so an empty context changes nothing for them.
func Deliver(integration store.Integration, subject, message string, alert notify.AlertContext, cfg settings.Settings) Result {
	switch integration.Type {
	case "Discord":
		if err := notify.SendDiscordAlert(integration.Target, subject, message, alert); err != nil {
			return fail("Discord webhook request failed")
		}
		return ok()

	case "Slack":
		return deliverJSONWebhook(integration.Target, map[string]string{"text": fmt.Sprintf("*%s*\n%s", subject, message)}, "Slack")

	case "Webhook":
		// The one channel StayUp signs. Slack, Telegram and PagerDuty are
		// third-party endpoints that authenticate the URL or the token; a
		// generic webhook lands on somebody's own service, which otherwise
		// cannot tell a real alert from a POST by anyone who learned the URL.
		return deliverSignedWebhook(integration.Target, map[string]string{"subject": subject, "message": message}, cfg.WebhookSigningSecret)

	case "Telegram":
		return deliverTelegram(integration, subject, message)

	case "Email":
		if err := notify.SendEmail(cfg.SMTP, integration.Target, subject, notify.IntegrationAlertTemplate(), notify.IntegrationAlertData{
			Subject: subject,
			Message: message,
		}); err != nil {
			return fail(err.Error())
		}
		return ok()

	case "Push":
		return deliverPush(integration, subject, message, cfg)

	case "PagerDuty":
		return deliverPagerDuty(integration.Target, subject, message)

	default:
		return fail("Unknown integration type: " + integration.Type)
	}
}

// deliverSignedWebhook is deliverJSONWebhook plus the HMAC headers from
// internal/notify — mirrors the 'Webhook' branch of deliverToIntegration() in
// src/lib/integration-delivery.ts, which signs the same bytes the same way.
//
// The marshalled body is signed and sent in that order, deliberately: signing
// a re-marshalled copy would let a key-order difference invalidate a correct
// signature.
func deliverSignedWebhook(url string, payload map[string]string, secret string) Result {
	body, err := json.Marshal(payload)
	if err != nil {
		return fail(err.Error())
	}

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fail(err.Error())
	}
	req.Header.Set("Content-Type", "application/json")
	for name, value := range notify.WebhookSignatureHeaders(secret, body, time.Now()) {
		req.Header.Set(name, value)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		logging.Error("[Integrations] Delivery to Webhook failed", err)
		return fail(err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fail(fmt.Sprintf("Webhook returned %d", resp.StatusCode))
	}
	return ok()
}

func deliverJSONWebhook(url string, payload map[string]string, label string) Result {
	body, err := json.Marshal(payload)
	if err != nil {
		return fail(err.Error())
	}

	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		logging.Error(fmt.Sprintf("[Integrations] Delivery to %s failed", label), err)
		return fail(err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fail(fmt.Sprintf("%s webhook returned %d", label, resp.StatusCode))
	}
	return ok()
}

func deliverTelegram(integration store.Integration, subject, message string) Result {
	if integration.Secret == nil || *integration.Secret == "" {
		return fail("Missing Telegram bot token")
	}

	body, err := json.Marshal(map[string]string{
		"chat_id": integration.Target,
		"text":    subject + "\n" + message,
	})
	if err != nil {
		return fail(err.Error())
	}

	resp, err := http.Post(
		fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", *integration.Secret),
		"application/json", bytes.NewReader(body),
	)
	if err != nil {
		logging.Error("[Integrations] Delivery to Telegram failed", err)
		return fail(err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 200))
		return fail(fmt.Sprintf("Telegram API returned %d: %s", resp.StatusCode, respBody))
	}
	return ok()
}

func deliverPush(integration store.Integration, subject, message string, cfg settings.Settings) Result {
	supportEmail := ""
	if cfg.SupportEmail != nil {
		supportEmail = *cfg.SupportEmail
	}

	err := notify.SendPushNotification(integration.Target, notify.PushPayload{Title: subject, Body: message},
		cfg.VapidPublicKey, cfg.VapidPrivateKey, supportEmail)
	if err == nil {
		return ok()
	}
	if errors.Is(err, notify.ErrInvalidPushSubscription) {
		return fail("This browser subscription is no longer valid — reconnect it")
	}
	return fail(err.Error())
}

type pagerDutyEvent struct {
	RoutingKey  string           `json:"routing_key"`
	EventAction string           `json:"event_action"`
	Payload     pagerDutyPayload `json:"payload"`
}

type pagerDutyPayload struct {
	Summary       string            `json:"summary"`
	Source        string            `json:"source"`
	Severity      string            `json:"severity"`
	CustomDetails map[string]string `json:"custom_details"`
}

func deliverPagerDuty(routingKey, subject, message string) Result {
	body, err := json.Marshal(pagerDutyEvent{
		RoutingKey:  routingKey,
		EventAction: "trigger",
		Payload: pagerDutyPayload{
			Summary:       subject,
			Source:        "stayup",
			Severity:      "critical",
			CustomDetails: map[string]string{"message": message},
		},
	})
	if err != nil {
		return fail(err.Error())
	}

	resp, err := http.Post("https://events.pagerduty.com/v2/enqueue", "application/json", bytes.NewReader(body))
	if err != nil {
		logging.Error("[Integrations] Delivery to PagerDuty failed", err)
		return fail(err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fail(fmt.Sprintf("PagerDuty API returned %d", resp.StatusCode))
	}
	return ok()
}
