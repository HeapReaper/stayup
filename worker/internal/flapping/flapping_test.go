package flapping

import "testing"

func TestCountTransitions(t *testing.T) {
	tests := []struct {
		name     string
		statuses []string
		want     int
	}{
		{"empty", nil, 0},
		{"single check", []string{"Up"}, 0},
		{"steady up", []string{"Up", "Up", "Up", "Up"}, 0},
		// A continuous outage is not flapping, however long it lasts.
		{"steady down", []string{"Down", "Down", "Down"}, 0},
		{"one dip and recovery", []string{"Up", "Down", "Up"}, 2},
		{"alternating", []string{"Up", "Down", "Up", "Down", "Up", "Down"}, 5},
		// Down and Degraded are both "unhealthy": oscillating between them is
		// one continuous outage, not a monitor changing its mind.
		{"down to degraded is not a transition", []string{"Down", "Degraded", "Down", "Degraded"}, 0},
		{"degraded counts as unhealthy", []string{"Up", "Degraded", "Up"}, 2},
		{"repeats between flips count once", []string{"Up", "Up", "Down", "Down", "Down", "Up"}, 2},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := CountTransitions(tc.statuses); got != tc.want {
				t.Errorf("CountTransitions(%v) = %d, want %d", tc.statuses, got, tc.want)
			}
		})
	}
}
