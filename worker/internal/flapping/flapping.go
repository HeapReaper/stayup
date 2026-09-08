// Package flapping detects a monitor that keeps changing its mind.
//
// AppSettings.failedAttemptsThreshold already debounces a single dip: it
// holds a monitor at Up until N checks in a row have failed. It cannot see
// the opposite failure — a monitor that alternates Up/Down all afternoon
// clears the threshold every time it goes down, opens an incident, recovers,
// closes it, and does it again. Twenty incidents and twenty pages later
// nobody is reading them.
//
// This counts *transitions* between healthy and unhealthy over a rolling
// window instead. Past the configured threshold the monitor is marked
// flapping (monitor.flappingSince) and its incident churn is suppressed the
// same way a maintenance window suppresses it — one standing "is flapping"
// incident replaces the storm — until it settles down again.
package flapping

import (
	"context"
	"time"

	"stayup/worker/internal/settings"
	"stayup/worker/internal/store"
)

// State is what the current check tick should do about flapping.
type State struct {
	// Flapping is whether the monitor is in a flapping state right now.
	Flapping bool
	// Started is true on the tick that first detected it — the only tick that
	// should open the standing "is flapping" incident.
	Started bool
	// Stopped is true on the tick it settled, so the caller can resume normal
	// incident handling and say so in the log.
	Stopped bool
	// Transitions counts healthy<->unhealthy flips inside the window, for the
	// incident message and the log line.
	Transitions int
}

// healthy collapses the three monitor statuses onto the only distinction that
// matters here. A monitor oscillating between Down and Degraded is still
// broken the whole time, and counting that as flapping would suppress a real,
// continuous outage.
func healthy(status string) bool { return status == "Up" }

// CountTransitions counts healthy<->unhealthy changes in a run of check
// statuses, oldest first. A monitor that was down the whole window scores 0,
// same as one that was up the whole window.
func CountTransitions(statuses []string) int {
	if len(statuses) < 2 {
		return 0
	}

	transitions := 0
	previous := healthy(statuses[0])
	for _, status := range statuses[1:] {
		current := healthy(status)
		if current != previous {
			transitions++
			previous = current
		}
	}
	return transitions
}

// Sync evaluates the monitor's recent history and moves monitor.flappingSince
// in or out of the flapping state. Called once per check, after the check row
// for this tick has been written, so the newest result is included.
func Sync(ctx context.Context, s *store.Store, cfg settings.Settings, monitor store.Monitor, now time.Time) (State, error) {
	wasFlapping := monitor.FlappingSince != nil

	if !cfg.FlappingEnabled {
		// Switching the feature off must not strand a monitor in a state
		// nothing will ever clear.
		if wasFlapping {
			if err := s.SetFlappingSince(ctx, monitor.ID, nil, now); err != nil {
				return State{}, err
			}
			return State{Stopped: true}, nil
		}
		return State{}, nil
	}

	since := now.Add(-time.Duration(cfg.FlappingWindowMinutes) * time.Minute)
	statuses, err := s.RecentCheckStatuses(ctx, monitor.ID, since)
	if err != nil {
		return State{}, err
	}

	transitions := CountTransitions(statuses)
	isFlapping := transitions >= cfg.FlappingThreshold

	switch {
	case isFlapping && !wasFlapping:
		if err := s.SetFlappingSince(ctx, monitor.ID, &now, now); err != nil {
			return State{}, err
		}
		return State{Flapping: true, Started: true, Transitions: transitions}, nil

	case !isFlapping && wasFlapping:
		if err := s.SetFlappingSince(ctx, monitor.ID, nil, now); err != nil {
			return State{}, err
		}
		return State{Stopped: true, Transitions: transitions}, nil

	default:
		return State{Flapping: isFlapping, Transitions: transitions}, nil
	}
}
