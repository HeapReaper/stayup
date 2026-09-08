package notify

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"stayup/worker/internal/logging"
)

// This file mirrors src/lib/discord.ts (invariant 1 in AGENTS.md): the
// dashboard's "Send test" button runs the TypeScript copy, real queued alerts
// run this one, and an operator must not be able to tell which sent a given
// message. Every limit, colour and field below has a twin over there.

// DiscordEmbedField is one name/value row in an embed.
type DiscordEmbedField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline,omitempty"`
}

// DiscordEmbedFooter is the small print under an embed.
type DiscordEmbedFooter struct {
	Text string `json:"text"`
}

// DiscordEmbed is the subset of Discord's embed object StayUp fills in.
type DiscordEmbed struct {
	Title       string              `json:"title,omitempty"`
	Description string              `json:"description,omitempty"`
	URL         string              `json:"url,omitempty"`
	Color       int                 `json:"color,omitempty"`
	Fields      []DiscordEmbedField `json:"fields,omitempty"`
	Footer      *DiscordEmbedFooter `json:"footer,omitempty"`
	Timestamp   string              `json:"timestamp,omitempty"`
}

// DiscordPayload is a webhook post body: an embed, or plain content.
type DiscordPayload struct {
	Content string         `json:"content,omitempty"`
	Embeds  []DiscordEmbed `json:"embeds,omitempty"`
}

// AlertContext is what the alert is about — mirrors AlertContext in
// src/lib/discord.ts. Every field is a pointer because the shape has to
// survive both extremes: a queued incident alert knows all of it, a "Send
// test" click knows none of it.
type AlertContext struct {
	IncidentID     *string
	IncidentStatus *string // Investigating | Identified | Monitoring | Resolved
	IncidentImpact *string // Critical | Major | Minor
	MonitorName    *string
	MonitorType    *string // HTTP | Ping | Port | DNS
	MonitorURL     *string
	MonitorStatus  *string // Up | Down | Degraded
	ResponseTimeMs *int
	Uptime         *float64 // percentage over the rolling 30-day window
	LastCheckedAt  *time.Time
}

// Discord's documented embed limits. Exceeding any one of them makes the
// whole webhook post fail with a 400, which would turn a cosmetic problem
// (someone pasted a 5000-character incident update) into a lost alert — so
// everything is truncated on the way in instead.
const (
	titleLimit       = 256
	descriptionLimit = 4096
	fieldValueLimit  = 1024
)

// Embed colours, matching src/lib/discord.ts. Resolved/Up is the green from
// the StayUp mark.
const (
	colorDown       = 0xED4245
	colorDegraded   = 0xF59E0B
	colorMonitoring = 0x3B82F6
	colorResolved   = 0x3BA55D
	colorNeutral    = 0x99AAB5
)

// truncate cuts to a rune count, not a byte count: half a multi-byte
// character would make the JSON body invalid, and Discord counts characters.
func truncate(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit-1]) + "…"
}

// dashboardBaseURL is this instance's public origin, for the "open the
// incident" link on the embed. BETTER_AUTH_URL is the only thing either
// runtime knows about it; the fallback matches incidentURL in
// internal/incidents.
func dashboardBaseURL() string {
	base := strings.TrimSpace(os.Getenv("BETTER_AUTH_URL"))
	if base == "" {
		base = "http://localhost:3000"
	}
	return strings.TrimRight(base, "/")
}

// AlertColor mirrors alertColor(): the incident status decides first and the
// monitor's state second, so "Resolved" is green even while the monitor it
// belongs to is still catching up, and an incident that's merely being
// watched isn't as loud as one that's actively down.
func AlertColor(ctx AlertContext) int {
	if ctx.IncidentStatus != nil {
		switch *ctx.IncidentStatus {
		case "Resolved":
			return colorResolved
		case "Monitoring":
			return colorMonitoring
		case "Investigating", "Identified":
			if ctx.IncidentImpact != nil && *ctx.IncidentImpact == "Critical" {
				return colorDown
			}
			return colorDegraded
		}
	}

	if ctx.MonitorStatus != nil {
		switch *ctx.MonitorStatus {
		case "Down":
			return colorDown
		case "Degraded":
			return colorDegraded
		case "Up":
			return colorResolved
		}
	}
	return colorNeutral
}

// BuildAlertEmbed mirrors buildAlertEmbed(). Fields are omitted rather than
// filled with "unknown": a test notification carries no monitor, and a Ping
// monitor has no URL worth printing — an embed of empty rows reads as a bug.
func BuildAlertEmbed(subject, message string, ctx AlertContext) DiscordEmbed {
	var fields []DiscordEmbedField

	if ctx.MonitorName != nil && *ctx.MonitorName != "" {
		value := *ctx.MonitorName
		if ctx.MonitorType != nil && *ctx.MonitorType != "" {
			value = fmt.Sprintf("%s · %s", value, *ctx.MonitorType)
		}
		fields = append(fields, DiscordEmbedField{Name: "Monitor", Value: truncate(value, fieldValueLimit), Inline: true})
	}

	state := ctx.IncidentStatus
	if state == nil {
		state = ctx.MonitorStatus
	}
	if state != nil && *state != "" {
		fields = append(fields, DiscordEmbedField{Name: "Status", Value: *state, Inline: true})
	}

	if ctx.IncidentImpact != nil && *ctx.IncidentImpact != "" {
		fields = append(fields, DiscordEmbedField{Name: "Impact", Value: *ctx.IncidentImpact, Inline: true})
	}

	if ctx.MonitorURL != nil && *ctx.MonitorURL != "" {
		// Backticks, not a link: monitor targets are frequently internal
		// hosts, and Discord would try to unfurl anything clickable.
		fields = append(fields, DiscordEmbedField{
			Name:  "Endpoint",
			Value: truncate("`"+*ctx.MonitorURL+"`", fieldValueLimit),
		})
	}

	if ctx.ResponseTimeMs != nil {
		fields = append(fields, DiscordEmbedField{
			Name:   "Response time",
			Value:  fmt.Sprintf("%d ms", *ctx.ResponseTimeMs),
			Inline: true,
		})
	}

	if ctx.Uptime != nil {
		fields = append(fields, DiscordEmbedField{
			Name:   "Uptime (30d)",
			Value:  fmt.Sprintf("%.2f%%", *ctx.Uptime),
			Inline: true,
		})
	}

	if ctx.LastCheckedAt != nil {
		// Discord renders <t:unix:R> as a live "3 minutes ago" in the
		// reader's own locale and timezone — worth more on an alert than any
		// string formatted here, since AppSettings.timezone never reaches
		// Discord.
		fields = append(fields, DiscordEmbedField{
			Name:   "Last check",
			Value:  fmt.Sprintf("<t:%d:R>", ctx.LastCheckedAt.Unix()),
			Inline: true,
		})
	}

	embed := DiscordEmbed{
		Title:       truncate(subject, titleLimit),
		Description: truncate(message, descriptionLimit),
		Color:       AlertColor(ctx),
		Fields:      fields,
		Footer:      &DiscordEmbedFooter{Text: "StayUp"},
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
	}

	if ctx.IncidentID != nil && *ctx.IncidentID != "" {
		embed.URL = dashboardBaseURL() + "/dashboard/incidents"
	}
	return embed
}

// SendDiscordWebhook posts a payload — an embed, or plain content — to a
// Discord incoming webhook URL. Mirrors sendDiscordWebhook().
func SendDiscordWebhook(webhookURL string, payload DiscordPayload) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("notify: encode discord payload: %w", err)
	}

	resp, err := http.Post(webhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		logging.Error("[Discord] Webhook post failed with error", err)
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		err := fmt.Errorf("discord webhook returned status %d", resp.StatusCode)
		logging.Error(fmt.Sprintf("[Discord] Webhook post failed with status %d", resp.StatusCode), nil)
		return err
	}
	return nil
}

// SendDiscordAlert posts one alert as an embed — how every caller sends.
// Mirrors sendDiscordAlert().
func SendDiscordAlert(webhookURL, subject, message string, ctx AlertContext) error {
	return SendDiscordWebhook(webhookURL, DiscordPayload{Embeds: []DiscordEmbed{BuildAlertEmbed(subject, message, ctx)}})
}
