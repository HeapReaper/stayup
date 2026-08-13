// Package db opens the shared *sql.DB used by every worker and bridges the
// handful of places SQLite and Postgres disagree — placeholder syntax,
// timestamp text format, and boolean representation — so the rest of the
// code (internal/store) can write one SQL string per query.
//
// Mirrors src/lib/prisma.ts: same DB_PROVIDER/DB_URL envs, same "sqlite is
// the default" behavior.
package db

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "modernc.org/sqlite"
)

type Provider string

const (
	Postgres Provider = "postgresql"
	SQLite   Provider = "sqlite"
)

// DB wraps *sql.DB with the provider it's talking to, since query building
// (placeholders, timestamp/bool encoding) depends on which one this is.
type DB struct {
	*sql.DB
	Provider Provider
}

// Open reads DB_PROVIDER/DB_URL from the environment and connects — same
// defaults as src/lib/prisma.ts's createPrismaClient (sqlite / file:./dev.db).
func Open() (*DB, error) {
	provider := Provider(os.Getenv("DB_PROVIDER"))
	if provider == "" {
		provider = SQLite
	}

	dbURL := os.Getenv("DB_URL")
	if dbURL == "" {
		dbURL = "file:./dev.db"
	}

	switch provider {
	case Postgres:
		return open("pgx", stripUnknownQueryParams(dbURL), provider, 0)
	default:
		// _busy_timeout + WAL: this file is written from up to 5 worker
		// processes (plus the Next.js app in local dev) at once. Without
		// them, a second writer gets an immediate "database is locked"
		// instead of waiting its turn.
		path := strings.TrimPrefix(dbURL, "file:") + "?_busy_timeout=5000&_pragma=journal_mode(WAL)"
		// A single connection serializes this process's own concurrent
		// writes (the runner checks monitors in parallel) instead of having
		// them contend with each other on top of the DSN-level busy_timeout.
		return open("sqlite", path, SQLite, 1)
	}
}

func open(driverName, dsn string, provider Provider, maxOpenConns int) (*DB, error) {
	sqlDB, err := sql.Open(driverName, dsn)
	if err != nil {
		return nil, fmt.Errorf("db: open %s: %w", driverName, err)
	}
	if maxOpenConns > 0 {
		sqlDB.SetMaxOpenConns(maxOpenConns)
	}

	if err := sqlDB.Ping(); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("db: ping %s: %w", driverName, err)
	}

	return &DB{DB: sqlDB, Provider: provider}, nil
}

// stripUnknownQueryParams drops query params pgx's connection string parser
// doesn't understand — namely Prisma's own "?schema=" convention documented
// in .env.example, which isn't a real libpq/pgx option.
func stripUnknownQueryParams(dsn string) string {
	u, err := url.Parse(dsn)
	if err != nil {
		return dsn
	}
	q := u.Query()
	q.Del("schema")
	u.RawQuery = q.Encode()
	return u.String()
}

// Rebind rewrites a query written with "?" placeholders into the target
// provider's native placeholder syntax ("?" for SQLite, "$1"/"$2"/... for
// Postgres) — write every query in internal/store with "?" and call this
// once before executing.
func (d *DB) Rebind(query string) string {
	if d.Provider != Postgres {
		return query
	}

	var b strings.Builder
	b.Grow(len(query) + 8)
	n := 0
	for _, r := range query {
		if r == '?' {
			n++
			b.WriteByte('$')
			b.WriteString(strconv.Itoa(n))
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// TimeArg converts a time.Time into the right bound-parameter representation
// for this provider. Postgres/pgx takes time.Time natively. SQLite (via
// Prisma's Boolean/DateTime mapping) stores DateTime columns as TEXT — match
// the exact format Prisma writes (UTC, millisecond precision, "Z" suffix) so
// rows written by Go and by the Next.js app stay interchangeable.
func (d *DB) TimeArg(t time.Time) any {
	if d.Provider == Postgres {
		return t
	}
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

// NullTimeArg is TimeArg for an optional timestamp column.
func (d *DB) NullTimeArg(t *time.Time) any {
	if t == nil {
		return nil
	}
	return d.TimeArg(*t)
}

// BoolArg converts a bool into the right bound-parameter representation:
// Postgres has a native boolean; SQLite (via Prisma's Boolean type) stores it
// as INTEGER 0/1.
func (d *DB) BoolArg(b bool) any {
	if d.Provider == Postgres {
		return b
	}
	if b {
		return int64(1)
	}
	return int64(0)
}

// Bool is a scan target for a boolean column that's native `bool` on
// Postgres but an INTEGER 0/1 on SQLite — database/sql's default conversions
// don't bridge int64->bool, so this does it explicitly.
type Bool bool

func (b *Bool) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*b = false
	case bool:
		*b = Bool(v)
	case int64:
		*b = v != 0
	case []byte:
		s := string(v)
		*b = Bool(s == "1" || strings.EqualFold(s, "true"))
	default:
		return fmt.Errorf("db.Bool: unsupported scan type %T", src)
	}
	return nil
}
