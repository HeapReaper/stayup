// Package oncall resolves who holds the pager at a given instant — the Go
// half of src/lib/oncall.ts. This is the copy that actually pages: when an
// escalation step targets an OnCallSchedule rather than a fixed Integration,
// internal/incidents asks this package who to wake, at the moment the step
// fires rather than when the incident opened.
//
// Nothing precomputes a calendar. A shift is derived from the rotation's
// anchor on every lookup, so reordering participants or fixing the handoff
// hour takes effect immediately instead of from the next handoff.
package oncall

import (
	"time"

	// The rotation's handoff is wall-clock in the schedule's own zone, so the
	// worker images need zone data. Embedding it here rather than installing
	// tzdata into the container keeps the Alpine worker image unchanged and
	// the dependency with the feature that needs it.
	_ "time/tzdata"

	"stayup/worker/internal/store"
)

// Resolution is who holds the pager, and why.
type Resolution struct {
	// Participant is nil when nobody is on call — an override that covers the
	// window with nobody, or a schedule with no participants. Callers treat
	// that as "this step pages no one" and move on to the next step, rather
	// than falling back to whoever is nominally up.
	Participant *store.OnCallParticipant
	Overridden  bool
	Reason      string
}

// At resolves who is on call for `schedule` at `at`. Mirrors resolveOnCallAt()
// in src/lib/oncall.ts.
func At(schedule store.OnCallSchedule, at time.Time) Resolution {
	if override, ok := activeOverride(schedule, at); ok {
		if override.ParticipantID == nil {
			reason := "Covered by an override with nobody on call"
			if override.Reason != nil && *override.Reason != "" {
				reason = *override.Reason
			}
			return Resolution{Overridden: true, Reason: reason}
		}
		if covering := participantByID(schedule.Participants, *override.ParticipantID); covering != nil {
			return Resolution{Participant: covering, Overridden: true}
		}
		// The override names a participant who has since left the roster —
		// fall through to the rotation rather than paging nobody.
	}

	if len(schedule.Participants) == 0 {
		return Resolution{Reason: "This schedule has no participants yet"}
	}

	index := RotationIndexAt(schedule, at, len(schedule.Participants))
	return Resolution{Participant: &schedule.Participants[index]}
}

// RotationIndexAt is which slot of the rotation `at` falls in, counted from
// the schedule's anchor.
//
// Counted in whole handoff boundaries rather than by dividing elapsed time by
// a fixed period: a local day is 23 or 25 hours across a DST transition, so
// duration arithmetic drifts a slot every spring and autumn while the
// boundaries themselves stay pinned to the local wall clock.
func RotationIndexAt(schedule store.OnCallSchedule, at time.Time, participantCount int) int {
	if participantCount <= 0 {
		return 0
	}

	epoch := previousHandoff(schedule, schedule.StartsAt)
	if at.Before(epoch) {
		return 0
	}

	periods := periodsBetween(schedule, epoch, previousHandoff(schedule, at))
	index := periods % participantCount
	if index < 0 {
		index += participantCount
	}
	return index
}

// ShiftEndAt is when the shift covering `at` hands over.
func ShiftEndAt(schedule store.OnCallSchedule, at time.Time) time.Time {
	location := locationOf(schedule.Timezone)
	current := previousHandoff(schedule, at).In(location)

	step := 1
	if schedule.RotationType != "Daily" {
		step = 7
	}
	// time.Date normalizes the day overflow and resolves the hour in the
	// location, so the next handoff lands on the same wall clock even when a
	// DST transition falls in between.
	return time.Date(current.Year(), current.Month(), current.Day()+step, schedule.HandoffHour, 0, 0, 0, location)
}

// periodsBetween counts handoffs between two boundaries using calendar days
// in the schedule's zone, which is exact regardless of DST.
func periodsBetween(schedule store.OnCallSchedule, from, to time.Time) int {
	location := locationOf(schedule.Timezone)
	days := civilDays(to.In(location)) - civilDays(from.In(location))
	if schedule.RotationType == "Daily" {
		return days
	}
	// Both boundaries land on handoffDay, so this is always a whole number.
	return days / 7
}

// civilDays is the day number of a date, ignoring its time and zone offset
// entirely — Howard Hinnant's days_from_civil. Subtracting two of these gives
// the exact number of calendar days between them, which elapsed-nanosecond
// arithmetic cannot do across a DST change.
func civilDays(t time.Time) int {
	year, month, day := t.Date()
	y := year
	m := int(month)
	if m <= 2 {
		y--
	}
	era := y / 400
	if y < 0 {
		era = (y - 399) / 400
	}
	yoe := y - era*400
	mp := (m + 9) % 12
	doy := (153*mp+2)/5 + day - 1
	doe := yoe*365 + yoe/4 - yoe/100 + doy
	return era*146097 + doe - 719468
}

// previousHandoff is the most recent handoff boundary at or before `from`.
// Boundaries are wall-clock in the schedule's zone — 09:00 Monday means 09:00
// where the team is, which is the reason OnCallSchedule carries a timezone at
// all.
func previousHandoff(schedule store.OnCallSchedule, from time.Time) time.Time {
	location := locationOf(schedule.Timezone)
	local := from.In(location)

	daysBack := 0
	if schedule.RotationType != "Daily" {
		daysBack = (isoWeekday(local) - schedule.HandoffDay + 7) % 7
	}
	if daysBack == 0 && local.Hour() < schedule.HandoffHour {
		if schedule.RotationType == "Daily" {
			daysBack = 1
		} else {
			daysBack = 7
		}
	}

	boundary := local.AddDate(0, 0, -daysBack)
	return time.Date(boundary.Year(), boundary.Month(), boundary.Day(), schedule.HandoffHour, 0, 0, 0, location)
}

// locationOf falls back to UTC for a zone this build's tzdata doesn't know,
// matching what partsFormatter() does on the TypeScript side — a schedule
// with a typo'd zone still pages someone.
func locationOf(name string) *time.Location {
	if name == "" {
		return time.UTC
	}
	location, err := time.LoadLocation(name)
	if err != nil {
		return time.UTC
	}
	return location
}

// isoWeekday maps Go's Sunday-based weekday onto ISO 1-7 (Monday first),
// which is what handoffDay stores.
func isoWeekday(t time.Time) int {
	weekday := int(t.Weekday())
	if weekday == 0 {
		return 7
	}
	return weekday
}

func activeOverride(schedule store.OnCallSchedule, at time.Time) (store.OnCallOverride, bool) {
	for _, override := range schedule.Overrides {
		if !at.Before(override.StartsAt) && at.Before(override.EndsAt) {
			return override, true
		}
	}
	return store.OnCallOverride{}, false
}

func participantByID(participants []store.OnCallParticipant, id string) *store.OnCallParticipant {
	for i := range participants {
		if participants[i].ID == id {
			return &participants[i]
		}
	}
	return nil
}
