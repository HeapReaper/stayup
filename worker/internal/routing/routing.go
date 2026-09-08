// Package routing decides where one incident notification goes, for monitors
// that don't have an escalation policy — the Go half of
// src/lib/notification-rules.ts.
//
// Without any rules the behaviour is unchanged: broadcast to every enabled
// Integration. With rules, the first enabled one (by order) that applies
// decides instead, which is how "staging alerts only during office hours, and
// only to #dev" becomes one row.
package routing

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	_ "time/tzdata" // the active window is evaluated in the instance timezone

	"stayup/worker/internal/store"
)

// Kind is what to do with a notification.
type Kind int

const (
	// Broadcast is the default: no rule applied.
	Broadcast Kind = iota
	// Route notifies exactly the rule's integrations.
	Route
	// Suppress notifies nobody — quiet hours, or a Route rule outside its window.
	Suppress
)

// Decision is the outcome of evaluating the rule list.
type Decision struct {
	Kind Kind
	// IntegrationIDs is set for Route.
	IntegrationIDs []string
	// RuleName and Reason explain the decision in the worker log, which is
	// the only place an operator can see why an alert didn't arrive.
	RuleName string
	Reason   string
}

// Context is what the incident being routed is, as far as matching goes.
type Context struct {
	MonitorID     *string
	MonitorTagIDs []string
	Impact        string
}

// Decide picks what to do with one incident notification. Mirrors
// decideRouting() in src/lib/notification-rules.ts, including the asymmetry
// between the two actions: a Suppress rule only applies inside its window
// (outside it, evaluation continues), while a Route rule applies whenever it
// matches and its window then decides between its integrations and nobody.
func Decide(rules []store.NotificationRule, ctx Context, now time.Time, timezone string) Decision {
	for _, rule := range rules {
		if !Matches(rule, ctx) {
			continue
		}

		inWindow := WithinWindow(rule, now, timezone)

		if rule.Action == "Suppress" {
			if inWindow {
				return Decision{
					Kind:     Suppress,
					RuleName: rule.Name,
					Reason:   fmt.Sprintf("quiet hours rule %q is active", rule.Name),
				}
			}
			continue
		}

		if !inWindow {
			return Decision{
				Kind:     Suppress,
				RuleName: rule.Name,
				Reason:   fmt.Sprintf("rule %q only notifies inside its active window", rule.Name),
			}
		}
		return Decision{Kind: Route, IntegrationIDs: rule.IntegrationIDs, RuleName: rule.Name}
	}

	return Decision{Kind: Broadcast}
}

// Matches reports whether every match clause that is set holds. All null
// matches everything, which is how an instance-wide quiet-hours rule is
// written.
func Matches(rule store.NotificationRule, ctx Context) bool {
	if rule.MatchMonitorID != nil {
		if ctx.MonitorID == nil || *rule.MatchMonitorID != *ctx.MonitorID {
			return false
		}
	}
	if rule.MatchTagID != nil && !contains(ctx.MonitorTagIDs, *rule.MatchTagID) {
		return false
	}
	if rule.MatchImpact != nil && *rule.MatchImpact != ctx.Impact {
		return false
	}
	return true
}

// WithinWindow reports whether `now` falls inside the rule's active window,
// evaluated in the instance timezone. A window whose end is before its start
// wraps past midnight (22:00-06:00), and the weekday is matched against the
// day the window *started* — so a Monday 22:00-06:00 window still covers
// Tuesday 02:00.
func WithinWindow(rule store.NotificationRule, now time.Time, timezone string) bool {
	hasDays := rule.ActiveDays != nil && *rule.ActiveDays != ""
	hasHours := rule.ActiveFromMinute != nil && rule.ActiveUntilMinute != nil
	if !hasDays && !hasHours {
		return true
	}

	local := now.In(locationOf(timezone))
	isoWeekday := isoWeekdayOf(local)
	minuteOfDay := local.Hour()*60 + local.Minute()
	days := parseDays(rule.ActiveDays)

	if !hasHours {
		return days == nil || contains(days, isoWeekday)
	}

	from, until := *rule.ActiveFromMinute, *rule.ActiveUntilMinute

	if from <= until {
		if days != nil && !contains(days, isoWeekday) {
			return false
		}
		return minuteOfDay >= from && minuteOfDay < until
	}

	// Wrapped window: the tail after midnight belongs to the previous day.
	if minuteOfDay >= from {
		return days == nil || contains(days, isoWeekday)
	}
	if minuteOfDay < until {
		previousDay := isoWeekday - 1
		if previousDay == 0 {
			previousDay = 7
		}
		return days == nil || contains(days, previousDay)
	}
	return false
}

func parseDays(activeDays *string) []int {
	if activeDays == nil || *activeDays == "" {
		return nil
	}

	var days []int
	for _, part := range strings.Split(*activeDays, ",") {
		day, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil || day < 1 || day > 7 {
			continue
		}
		days = append(days, day)
	}
	return days
}

// locationOf falls back to UTC for a zone tzdata doesn't know — AppSettings
// .timezone is free text, and an unknown one must not take notifications
// down. Matches formatterFor() on the TypeScript side.
func locationOf(name string) *time.Location {
	if name == "" {
		return time.UTC
	}
	if location, err := time.LoadLocation(name); err == nil {
		return location
	}
	// The Settings page stores "utc" lowercase; tzdata wants "UTC".
	if location, err := time.LoadLocation(strings.ToUpper(name)); err == nil {
		return location
	}
	return time.UTC
}

func isoWeekdayOf(t time.Time) int {
	if weekday := int(t.Weekday()); weekday != 0 {
		return weekday
	}
	return 7
}

func contains[T comparable](values []T, want T) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
