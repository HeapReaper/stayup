package store

import (
	"context"
	"database/sql"
	"fmt"

	"stayup/worker/internal/db"
)

// DependencyLink is one step up a monitor's dependency chain: the parent it
// points at, that parent's rolled-up status, and whether the parent is still
// being checked at all.
type DependencyLink struct {
	ParentID      *string
	ParentStatus  string
	ParentEnabled bool
}

// ParentOf reads one link of the chain above `monitorID` — the row behind
// internal/dependencies' walk, and the Go half of the two findUnique calls
// isAncestorDown() makes in src/lib/monitor-dependencies.ts.
//
// Returns nil when the monitor has no parent (or the monitor itself is gone),
// which is what ends the walk.
func (s *Store) ParentOf(ctx context.Context, monitorID string) (*DependencyLink, error) {
	var parentID sql.NullString
	var status sql.NullString
	var enabled db.Bool

	err := s.queryRow(ctx, `
		SELECT parent.id, parent.status, parent.enabled
		FROM monitor child
		JOIN monitor parent ON parent.id = child."parentId"
		WHERE child.id = ?
	`, monitorID).Scan(&parentID, &status, &enabled)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("store: parent of monitor: %w", err)
	}
	if !parentID.Valid {
		return nil, nil
	}

	id := parentID.String
	return &DependencyLink{ParentID: &id, ParentStatus: status.String, ParentEnabled: bool(enabled)}, nil
}
