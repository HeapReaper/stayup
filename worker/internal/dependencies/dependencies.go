// Package dependencies mirrors src/lib/monitor-dependencies.ts: whether a
// monitor's failing check should be suppressed because something it sits
// behind is already Down.
//
// The problem it solves is the one neither failedAttemptsThreshold nor
// flapping detection can: both reason about a single monitor over time, so a
// router or a database going down still lights up all thirty monitors behind
// it, each opening its own incident and paging separately. A parent that is
// Down suppresses its children exactly the way a maintenance window does —
// checks are still written, statuses still flip, only the incident is skipped
// — so what pages is the actual cause.
package dependencies

import (
	"context"

	"stayup/worker/internal/store"
)

// maxDepth bounds the walk up the chain. A well-formed graph has no cycle —
// the monitor router refuses to create one — but a hand-edited row must not
// be able to hang a worker tick. Must stay in step with
// MAX_DEPENDENCY_DEPTH in src/lib/monitor-dependencies.ts.
const maxDepth = 30

// IsAncestorDown reports whether anything above this monitor in the chain is
// currently Down — mirrors isAncestorDown().
//
// The whole chain rather than just the immediate parent: a site behind a load
// balancer behind a router has to fall silent when the router does. Only
// "Down" counts; a Degraded parent is still serving, so a child failing
// underneath it is news rather than an echo.
func IsAncestorDown(ctx context.Context, s *store.Store, monitorID string) (bool, error) {
	seen := map[string]bool{monitorID: true}
	current := monitorID

	for depth := 0; depth < maxDepth; depth++ {
		link, err := s.ParentOf(ctx, current)
		if err != nil {
			return false, err
		}
		if link == nil || link.ParentID == nil {
			return false, nil
		}
		// A paused parent is not evidence of anything: no worker is checking
		// it, so its stored status is however it happened to be left.
		if !link.ParentEnabled {
			return false, nil
		}
		if link.ParentStatus == "Down" {
			return true, nil
		}
		if seen[*link.ParentID] {
			return false, nil // only reachable from a hand-edited row
		}
		seen[*link.ParentID] = true
		current = *link.ParentID
	}

	return false, nil
}
