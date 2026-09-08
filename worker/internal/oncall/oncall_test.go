package oncall

import (
	"testing"
	"time"

	"stayup/worker/internal/store"
)

func participants(names ...string) []store.OnCallParticipant {
	out := make([]store.OnCallParticipant, len(names))
	for i, name := range names {
		out[i] = store.OnCallParticipant{
			ID:            "p" + name,
			Order:         i,
			Name:          name,
			IntegrationID: "i" + name,
			Integration:   store.Integration{ID: "i" + name, Enabled: true},
		}
	}
	return out
}

func mustTime(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatalf("bad test timestamp %q: %v", value, err)
	}
	return parsed
}

// A weekly rotation handing over Monday 09:00 Amsterdam: the roster advances
// exactly once a week, at that wall-clock moment.
func TestWeeklyRotationAdvancesAtHandoff(t *testing.T) {
	schedule := store.OnCallSchedule{
		Timezone:     "Europe/Amsterdam",
		RotationType: "Weekly",
		HandoffHour:  9,
		HandoffDay:   1, // Monday
		// A Wednesday, mid-shift — the anchor does not have to be a handoff.
		StartsAt:     mustTime(t, "2026-01-07T12:00:00Z"),
		Participants: participants("ann", "bo", "cy"),
	}

	tests := []struct {
		name string
		at   string
		want string
	}{
		{"anchor week", "2026-01-07T12:00:00Z", "ann"},
		{"still before Monday handoff", "2026-01-12T07:59:00Z", "ann"},
		{"just after Monday 09:00 local", "2026-01-12T08:01:00Z", "bo"},
		{"second week", "2026-01-15T12:00:00Z", "bo"},
		{"third week", "2026-01-20T12:00:00Z", "cy"},
		{"wraps back to the first", "2026-01-27T12:00:00Z", "ann"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := At(schedule, mustTime(t, tc.at))
			if got.Participant == nil || got.Participant.Name != tc.want {
				t.Errorf("At(%s) = %v, want %s", tc.at, describe(got), tc.want)
			}
		})
	}
}

func TestDailyRotation(t *testing.T) {
	schedule := store.OnCallSchedule{
		Timezone:     "UTC",
		RotationType: "Daily",
		HandoffHour:  9,
		StartsAt:     mustTime(t, "2026-03-02T10:00:00Z"),
		Participants: participants("ann", "bo"),
	}

	for _, tc := range []struct{ at, want string }{
		{"2026-03-02T10:00:00Z", "ann"},
		{"2026-03-03T08:59:00Z", "ann"},
		{"2026-03-03T09:01:00Z", "bo"},
		{"2026-03-04T09:01:00Z", "ann"},
	} {
		got := At(schedule, mustTime(t, tc.at))
		if got.Participant == nil || got.Participant.Name != tc.want {
			t.Errorf("At(%s) = %v, want %s", tc.at, describe(got), tc.want)
		}
	}
}

// The handoff is wall-clock local, so it stays at 09:00 Amsterdam across the
// spring DST jump — 08:00 UTC in winter, 07:00 UTC in summer.
func TestHandoffFollowsLocalWallClockAcrossDST(t *testing.T) {
	schedule := store.OnCallSchedule{
		Timezone:     "Europe/Amsterdam",
		RotationType: "Daily",
		HandoffHour:  9,
		StartsAt:     mustTime(t, "2026-03-27T12:00:00Z"),
		Participants: participants("ann", "bo"),
	}

	// 2026-03-29 is the spring-forward Sunday in Europe/Amsterdam.
	before := At(schedule, mustTime(t, "2026-03-30T06:59:00Z")) // 08:59 local
	after := At(schedule, mustTime(t, "2026-03-30T07:01:00Z"))  // 09:01 local

	if before.Participant == nil || after.Participant == nil {
		t.Fatal("expected somebody on call on both sides of the handoff")
	}
	if before.Participant.Name == after.Participant.Name {
		t.Errorf("expected a handoff at 09:00 local, got %s on both sides", before.Participant.Name)
	}
}

func TestOverrideWins(t *testing.T) {
	roster := participants("ann", "bo")
	schedule := store.OnCallSchedule{
		Timezone:     "UTC",
		RotationType: "Weekly",
		HandoffHour:  9,
		HandoffDay:   1,
		StartsAt:     mustTime(t, "2026-01-05T09:00:00Z"),
		Participants: roster,
		Overrides: []store.OnCallOverride{{
			StartsAt:      mustTime(t, "2026-01-06T00:00:00Z"),
			EndsAt:        mustTime(t, "2026-01-08T00:00:00Z"),
			ParticipantID: &roster[1].ID,
		}},
	}

	covered := At(schedule, mustTime(t, "2026-01-07T12:00:00Z"))
	if covered.Participant == nil || covered.Participant.Name != "bo" || !covered.Overridden {
		t.Errorf("inside the override = %v, want bo (overridden)", describe(covered))
	}

	// The window is half-open, so the rotation is back in charge at endsAt.
	after := At(schedule, mustTime(t, "2026-01-08T00:00:00Z"))
	if after.Participant == nil || after.Participant.Name != "ann" || after.Overridden {
		t.Errorf("after the override = %v, want ann (not overridden)", describe(after))
	}
}

// "Nobody covers this" is a real answer: the escalation chain must fall
// through to its next step rather than paging the person who is away.
func TestOverrideWithNobodyPagesNobody(t *testing.T) {
	schedule := store.OnCallSchedule{
		Timezone:     "UTC",
		RotationType: "Weekly",
		HandoffHour:  9,
		HandoffDay:   1,
		StartsAt:     mustTime(t, "2026-01-05T09:00:00Z"),
		Participants: participants("ann"),
		Overrides: []store.OnCallOverride{{
			StartsAt: mustTime(t, "2026-01-06T00:00:00Z"),
			EndsAt:   mustTime(t, "2026-01-08T00:00:00Z"),
		}},
	}

	got := At(schedule, mustTime(t, "2026-01-07T12:00:00Z"))
	if got.Participant != nil {
		t.Errorf("At() = %v, want nobody on call", describe(got))
	}
	if !got.Overridden || got.Reason == "" {
		t.Errorf("expected an explained override, got overridden=%v reason=%q", got.Overridden, got.Reason)
	}
}

// An override pointing at someone who has since left the roster must not
// silently page nobody — the rotation answers instead.
func TestOverrideForRemovedParticipantFallsBackToRotation(t *testing.T) {
	ghost := "p-removed"
	schedule := store.OnCallSchedule{
		Timezone:     "UTC",
		RotationType: "Weekly",
		HandoffHour:  9,
		HandoffDay:   1,
		StartsAt:     mustTime(t, "2026-01-05T09:00:00Z"),
		Participants: participants("ann"),
		Overrides: []store.OnCallOverride{{
			StartsAt:      mustTime(t, "2026-01-06T00:00:00Z"),
			EndsAt:        mustTime(t, "2026-01-08T00:00:00Z"),
			ParticipantID: &ghost,
		}},
	}

	got := At(schedule, mustTime(t, "2026-01-07T12:00:00Z"))
	if got.Participant == nil || got.Participant.Name != "ann" {
		t.Errorf("At() = %v, want the rotation's ann", describe(got))
	}
}

func TestEmptyRosterHasNobodyOnCall(t *testing.T) {
	got := At(store.OnCallSchedule{Timezone: "UTC", RotationType: "Weekly", StartsAt: time.Now()}, time.Now())
	if got.Participant != nil || got.Reason == "" {
		t.Errorf("At() = %v, want nobody with a reason", describe(got))
	}
}

// A zone this build's tzdata doesn't know must not take paging down with it.
func TestUnknownTimezoneFallsBackToUTC(t *testing.T) {
	schedule := store.OnCallSchedule{
		Timezone:     "Mars/Olympus_Mons",
		RotationType: "Weekly",
		HandoffHour:  9,
		HandoffDay:   1,
		StartsAt:     mustTime(t, "2026-01-05T09:00:00Z"),
		Participants: participants("ann", "bo"),
	}

	if got := At(schedule, mustTime(t, "2026-01-07T12:00:00Z")); got.Participant == nil {
		t.Error("expected a fallback to UTC to still resolve somebody")
	}
}

func TestShiftEndAtIsTheNextHandoff(t *testing.T) {
	schedule := store.OnCallSchedule{
		Timezone:     "UTC",
		RotationType: "Weekly",
		HandoffHour:  9,
		HandoffDay:   1,
		StartsAt:     mustTime(t, "2026-01-05T09:00:00Z"),
		Participants: participants("ann", "bo"),
	}

	got := ShiftEndAt(schedule, mustTime(t, "2026-01-07T12:00:00Z"))
	want := mustTime(t, "2026-01-12T09:00:00Z")
	if !got.Equal(want) {
		t.Errorf("ShiftEndAt() = %s, want %s", got.Format(time.RFC3339), want.Format(time.RFC3339))
	}
}

func describe(r Resolution) string {
	if r.Participant == nil {
		return "nobody (" + r.Reason + ")"
	}
	return r.Participant.Name
}
