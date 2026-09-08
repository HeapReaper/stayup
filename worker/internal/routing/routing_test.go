package routing

import (
	"testing"
	"time"

	"stayup/worker/internal/store"
)

func strp(v string) *string { return &v }
func intp(v int) *int       { return &v }

func at(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatalf("bad test timestamp %q: %v", value, err)
	}
	return parsed
}

// The whole feature in one case: staging alerts only during office hours,
// and only to #dev.
func TestOfficeHoursRoutingForATag(t *testing.T) {
	rule := store.NotificationRule{
		ID: "r1", Name: "Staging office hours", Action: "Route", Enabled: true,
		MatchTagID:        strp("tag-staging"),
		ActiveDays:        strp("1,2,3,4,5"),
		ActiveFromMinute:  intp(9 * 60),
		ActiveUntilMinute: intp(17 * 60),
		IntegrationIDs:    []string{"integ-dev"},
	}
	staging := Context{MonitorID: strp("m1"), MonitorTagIDs: []string{"tag-staging"}, Impact: "Critical"}
	production := Context{MonitorID: strp("m2"), MonitorTagIDs: []string{"tag-prod"}, Impact: "Critical"}

	// Wednesday 14:00 UTC — inside the window.
	inHours := Decide([]store.NotificationRule{rule}, staging, at(t, "2026-01-07T14:00:00Z"), "UTC")
	if inHours.Kind != Route || len(inHours.IntegrationIDs) != 1 || inHours.IntegrationIDs[0] != "integ-dev" {
		t.Errorf("in hours = %+v, want a Route to integ-dev", inHours)
	}

	// Wednesday 22:00 — matched, but outside the window, so nobody is paged.
	outOfHours := Decide([]store.NotificationRule{rule}, staging, at(t, "2026-01-07T22:00:00Z"), "UTC")
	if outOfHours.Kind != Suppress {
		t.Errorf("out of hours = %+v, want Suppress", outOfHours)
	}

	// Saturday — not a listed weekday.
	weekend := Decide([]store.NotificationRule{rule}, staging, at(t, "2026-01-10T14:00:00Z"), "UTC")
	if weekend.Kind != Suppress {
		t.Errorf("weekend = %+v, want Suppress", weekend)
	}

	// A monitor without the tag is untouched by the rule.
	unmatched := Decide([]store.NotificationRule{rule}, production, at(t, "2026-01-07T22:00:00Z"), "UTC")
	if unmatched.Kind != Broadcast {
		t.Errorf("unmatched monitor = %+v, want the default Broadcast", unmatched)
	}
}

// With no rules at all, behaviour is exactly what it was before the feature.
func TestNoRulesBroadcasts(t *testing.T) {
	got := Decide(nil, Context{MonitorID: strp("m1")}, time.Now(), "UTC")
	if got.Kind != Broadcast {
		t.Errorf("Decide() = %+v, want Broadcast", got)
	}
}

// A Suppress rule is silent inside its window and *invisible* outside it, so
// quiet hours don't change daytime behaviour.
func TestQuietHoursOnlyApplyInsideTheirWindow(t *testing.T) {
	rules := []store.NotificationRule{{
		ID: "r1", Name: "Night quiet hours", Action: "Suppress", Enabled: true,
		ActiveFromMinute:  intp(22 * 60),
		ActiveUntilMinute: intp(6 * 60),
	}}
	ctx := Context{MonitorID: strp("m1"), Impact: "Minor"}

	for _, tc := range []struct {
		name string
		at   string
		want Kind
	}{
		{"late evening", "2026-01-07T23:30:00Z", Suppress},
		{"after midnight, still the same window", "2026-01-08T02:00:00Z", Suppress},
		{"just before it opens", "2026-01-07T21:59:00Z", Broadcast},
		{"just after it closes", "2026-01-08T06:01:00Z", Broadcast},
		{"midday", "2026-01-08T12:00:00Z", Broadcast},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := Decide(rules, ctx, at(t, tc.at), "UTC"); got.Kind != tc.want {
				t.Errorf("Decide(%s) = %v, want %v", tc.at, got.Kind, tc.want)
			}
		})
	}
}

// A wrapped window's weekday is the day it *started* on, so a Friday-night
// rule still covers Saturday 02:00 while a Saturday-night one does not.
func TestWrappedWindowBelongsToItsStartingDay(t *testing.T) {
	friday := []store.NotificationRule{{
		ID: "r1", Name: "Friday night", Action: "Suppress", Enabled: true,
		ActiveDays: strp("5"), ActiveFromMinute: intp(22 * 60), ActiveUntilMinute: intp(6 * 60),
	}}
	ctx := Context{MonitorID: strp("m1")}

	// Saturday 02:00 — the tail of Friday's window.
	if got := Decide(friday, ctx, at(t, "2026-01-10T02:00:00Z"), "UTC"); got.Kind != Suppress {
		t.Errorf("Saturday 02:00 = %v, want Suppress (tail of Friday night)", got.Kind)
	}
	// Sunday 02:00 — the tail of Saturday, which the rule doesn't list.
	if got := Decide(friday, ctx, at(t, "2026-01-11T02:00:00Z"), "UTC"); got.Kind != Broadcast {
		t.Errorf("Sunday 02:00 = %v, want Broadcast", got.Kind)
	}
}

// Order decides: the first applicable rule wins and the rest are not consulted.
func TestFirstApplicableRuleWins(t *testing.T) {
	rules := []store.NotificationRule{
		{ID: "r1", Name: "Critical straight through", Order: 0, Action: "Route", Enabled: true,
			MatchImpact: strp("Critical"), IntegrationIDs: []string{"integ-pager"}},
		{ID: "r2", Name: "Night quiet hours", Order: 1, Action: "Suppress", Enabled: true,
			ActiveFromMinute: intp(22 * 60), ActiveUntilMinute: intp(6 * 60)},
	}

	// A critical incident at 23:30 takes the first rule, so quiet hours never
	// get to swallow it.
	critical := Decide(rules, Context{MonitorID: strp("m1"), Impact: "Critical"}, at(t, "2026-01-07T23:30:00Z"), "UTC")
	if critical.Kind != Route {
		t.Errorf("critical at night = %+v, want Route", critical)
	}

	// A minor one falls through to quiet hours.
	minor := Decide(rules, Context{MonitorID: strp("m1"), Impact: "Minor"}, at(t, "2026-01-07T23:30:00Z"), "UTC")
	if minor.Kind != Suppress {
		t.Errorf("minor at night = %+v, want Suppress", minor)
	}
}

// The window is evaluated in the instance timezone, not the server's.
func TestWindowUsesTheInstanceTimezone(t *testing.T) {
	rules := []store.NotificationRule{{
		ID: "r1", Name: "Office hours", Action: "Route", Enabled: true,
		ActiveFromMinute: intp(9 * 60), ActiveUntilMinute: intp(17 * 60),
		IntegrationIDs: []string{"integ-dev"},
	}}
	ctx := Context{MonitorID: strp("m1")}

	// 08:00 UTC is 09:00 in Amsterdam (CET) — inside there, outside in UTC.
	moment := at(t, "2026-01-07T08:00:00Z")
	if got := Decide(rules, ctx, moment, "Europe/Amsterdam"); got.Kind != Route {
		t.Errorf("Amsterdam = %v, want Route", got.Kind)
	}
	if got := Decide(rules, ctx, moment, "UTC"); got.Kind != Suppress {
		t.Errorf("UTC = %v, want Suppress", got.Kind)
	}
	// The Settings page stores "utc" lowercase; tzdata wants "UTC".
	if got := Decide(rules, ctx, moment, "utc"); got.Kind != Suppress {
		t.Errorf("lowercase utc = %v, want the same as UTC", got.Kind)
	}
}

// A rule with no window at all is always active.
func TestRuleWithoutAWindowIsAlwaysActive(t *testing.T) {
	rules := []store.NotificationRule{{
		ID: "r1", Name: "Everything to ops", Action: "Route", Enabled: true,
		IntegrationIDs: []string{"integ-ops"},
	}}

	if got := Decide(rules, Context{MonitorID: strp("m1")}, at(t, "2026-01-07T03:00:00Z"), "UTC"); got.Kind != Route {
		t.Errorf("Decide() = %+v, want Route at any hour", got)
	}
}
