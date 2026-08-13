// Package store is the hand-written SQL query layer the Go workers use
// instead of Prisma — every function here mirrors a specific Prisma call
// from the TS worker/lib files (noted in each function's comment). All
// queries are written with "?" placeholders and rebound per-provider via
// db.Rebind, so the same SQL runs against both SQLite and Postgres.
package store

import (
	"context"

	"stayup/worker/internal/db"
)

type Store struct {
	db *db.DB
}

func New(d *db.DB) *Store {
	return &Store{db: d}
}

// q rebinds a "?"-placeholder query for the underlying provider.
func (s *Store) q(query string) string {
	return s.db.Rebind(query)
}

func (s *Store) queryRow(ctx context.Context, query string, args ...any) rowScanner {
	return s.db.QueryRowContext(ctx, s.q(query), args...)
}

type rowScanner interface {
	Scan(dest ...any) error
}
