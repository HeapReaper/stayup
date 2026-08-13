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

// Deliver sends one notification through an Integration — mirrors
// deliverToIntegration(). Never returns an error itself; failures come back
// as Result.Error so callers always get a result to persist.
func Deliver(integration store.Integration, subject, message string, cfg settings.Settings) Result {
	switch integration.Type {
	case "Discord":
		if err := notify.SendDiscordWebhook(integration.Target, fmt.Sprintf("**%s**\n%s", subject, message)); err != nil {
			return fail("Discord webhook request failed")
		}
		return ok()

	case "Slack":
		return deliverJSONWebhook(integration.Target, map[string]string{"text": fmt.Sprintf("*%s*\n%s", subject, message)}, "Slack")

	case "Webhook":
		return deliverJSONWebhook(integration.Target, map[string]string{"subject": subject, "message": message}, "Webhook")

	case "Telegram":
		return deliverTelegram(integration, subject, message)

	case "Email":
		if err := notify.SendEmail(integration.Target, subject, notify.IntegrationAlertTemplate(), notify.IntegrationAlertData{
			Subject: subject,
			Message: message,
		}); err != nil {
			return fail("Email send failed")
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
