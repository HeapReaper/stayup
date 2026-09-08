package notify

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// The embed builder is pure, and it has a twin in src/lib/discord.ts that
// must produce the same payload — so it gets tested here, and the table below
// is mirrored by the parity check described in AGENTS.md section 4.

func str(v string) *string { return &v }

func fullContext() AlertContext {
	checked := time.Unix(1_760_000_000, 0)
	ms := 1234
	uptime := 99.876
	return AlertContext{
		IncidentID:     str("inc_abc123"),
		IncidentStatus: str("Investigating"),
		IncidentImpact: str("Critical"),
		MonitorName:    str("API"),
		MonitorType:    str("HTTP"),
		MonitorURL:     str("https://api.example.com/health"),
		MonitorStatus:  str("Down"),
		ResponseTimeMs: &ms,
		Uptime:         &uptime,
		LastCheckedAt:  &checked,
	}
}

func TestBuildAlertEmbedFullContext(t *testing.T) {
	embed := BuildAlertEmbed("[Investigating] API is down", "Connection refused", fullContext())

	if embed.Title != "[Investigating] API is down" {
		t.Errorf("title = %q", embed.Title)
	}
	if embed.Description != "Connection refused" {
		t.Errorf("description = %q", embed.Description)
	}
	if embed.Color != colorDown {
		t.Errorf("color = %#x, want %#x (Critical + Investigating)", embed.Color, colorDown)
	}
	if embed.Footer == nil || embed.Footer.Text != "StayUp" {
		t.Errorf("footer = %+v", embed.Footer)
	}
	if !strings.HasSuffix(embed.URL, "/dashboard/incidents") {
		t.Errorf("url = %q, want the incidents page", embed.URL)
	}
	if _, err := time.Parse(time.RFC3339, embed.Timestamp); err != nil {
		t.Errorf("timestamp %q is not RFC3339: %v", embed.Timestamp, err)
	}

	// Order matters: identity, then severity, then measurements.
	want := []struct {
		name  string
		value string
	}{
		{"Monitor", "API · HTTP"},
		{"Status", "Investigating"},
		{"Impact", "Critical"},
		{"Endpoint", "`https://api.example.com/health`"},
		{"Response time", "1234 ms"},
		{"Uptime (30d)", "99.88%"},
		{"Last check", "<t:1760000000:R>"},
	}
	if len(embed.Fields) != len(want) {
		t.Fatalf("got %d fields, want %d: %+v", len(embed.Fields), len(want), embed.Fields)
	}
	for i, w := range want {
		if embed.Fields[i].Name != w.name || embed.Fields[i].Value != w.value {
			t.Errorf("field %d = %q/%q, want %q/%q", i, embed.Fields[i].Name, embed.Fields[i].Value, w.name, w.value)
		}
	}
}

func TestBuildAlertEmbedEmptyContext(t *testing.T) {
	// A "Send test" click: no incident, no monitor. An embed full of empty
	// rows would read as a bug, so there should be no rows at all.
	embed := BuildAlertEmbed("Test Notification", "This is a test.", AlertContext{})

	if len(embed.Fields) != 0 {
		t.Errorf("got %d fields, want none: %+v", len(embed.Fields), embed.Fields)
	}
	if embed.Color != colorNeutral {
		t.Errorf("color = %#x, want %#x", embed.Color, colorNeutral)
	}
	if embed.URL != "" {
		t.Errorf("url = %q, want empty without an incident", embed.URL)
	}
}

func TestBuildAlertEmbedOmitsUnknownFields(t *testing.T) {
	// A Ping monitor that has never been checked: a name and a state, nothing
	// measurable yet.
	embed := BuildAlertEmbed("Ping is down", "No reply", AlertContext{
		MonitorName:   str("gateway"),
		MonitorType:   str("Ping"),
		MonitorStatus: str("Down"),
	})

	names := make([]string, 0, len(embed.Fields))
	for _, f := range embed.Fields {
		names = append(names, f.Name)
	}
	got := strings.Join(names, ",")
	if got != "Monitor,Status" {
		t.Errorf("fields = %q, want %q", got, "Monitor,Status")
	}
	// Without an incident status, the monitor's own state picks the colour.
	if embed.Color != colorDown {
		t.Errorf("color = %#x, want %#x", embed.Color, colorDown)
	}
}

func TestAlertColor(t *testing.T) {
	cases := []struct {
		name string
		ctx  AlertContext
		want int
	}{
		{"resolved wins over a still-down monitor", AlertContext{IncidentStatus: str("Resolved"), MonitorStatus: str("Down")}, colorResolved},
		{"monitoring", AlertContext{IncidentStatus: str("Monitoring")}, colorMonitoring},
		{"critical investigating", AlertContext{IncidentStatus: str("Investigating"), IncidentImpact: str("Critical")}, colorDown},
		{"minor investigating", AlertContext{IncidentStatus: str("Investigating"), IncidentImpact: str("Minor")}, colorDegraded},
		{"identified without impact", AlertContext{IncidentStatus: str("Identified")}, colorDegraded},
		{"monitor down, no incident", AlertContext{MonitorStatus: str("Down")}, colorDown},
		{"monitor degraded, no incident", AlertContext{MonitorStatus: str("Degraded")}, colorDegraded},
		{"monitor up, no incident", AlertContext{MonitorStatus: str("Up")}, colorResolved},
		{"nothing known", AlertContext{}, colorNeutral},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := AlertColor(tc.ctx); got != tc.want {
				t.Errorf("AlertColor = %#x, want %#x", got, tc.want)
			}
		})
	}
}

func TestBuildAlertEmbedTruncates(t *testing.T) {
	// Discord rejects the whole post over these limits, so an over-long
	// incident update must cost characters, not the alert.
	embed := BuildAlertEmbed(strings.Repeat("a", 300), strings.Repeat("b", 5000), AlertContext{})

	if got := len([]rune(embed.Title)); got != titleLimit {
		t.Errorf("title length = %d, want %d", got, titleLimit)
	}
	if !strings.HasSuffix(embed.Title, "…") {
		t.Error("truncated title should end in an ellipsis")
	}
	if got := len([]rune(embed.Description)); got != descriptionLimit {
		t.Errorf("description length = %d, want %d", got, descriptionLimit)
	}
}

func TestTruncateIsRuneSafe(t *testing.T) {
	// Byte slicing would split a multi-byte character and produce invalid
	// JSON — which Discord answers with a 400, losing the alert.
	out := truncate(strings.Repeat("é", 400), titleLimit)

	if got := len([]rune(out)); got != titleLimit {
		t.Errorf("length = %d runes, want %d", got, titleLimit)
	}
	if !json.Valid(mustMarshal(t, out)) {
		t.Error("truncated string does not marshal to valid JSON")
	}
}

func mustMarshal(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

func TestPayloadOmitsEmptyKeys(t *testing.T) {
	// Discord rejects an embed carrying an empty `fields` array, and a
	// payload carrying both `content` and `embeds` is ambiguous.
	body := string(mustMarshal(t, DiscordPayload{Embeds: []DiscordEmbed{BuildAlertEmbed("s", "m", AlertContext{})}}))

	for _, unwanted := range []string{`"content"`, `"fields"`, `"url"`} {
		if strings.Contains(body, unwanted) {
			t.Errorf("payload should not contain %s: %s", unwanted, body)
		}
	}
}
