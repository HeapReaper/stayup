package store

import "time"

// Monitor mirrors the columns the workers actually touch on the `monitor`
// table (src/prisma/schemas/postgresql.prisma). Not every column — just what
// checkers/runner/incidents need.
type Monitor struct {
	ID       string
	Name     string
	URL      string
	Type     string
	Status   string
	Interval string
	Port     *int
	// Paused monitors are filtered out by ListByType — a worker never sees
	// one, so nothing downstream has to check this.
	Enabled            bool
	LastCheckedAt      *time.Time
	EscalationPolicyID *string

	// HTTP-only request options; zero values for every other monitor type.
	// See the `monitor` model in src/prisma/schemas/*.prisma for what each
	// one means, and internal/checkers/http.go for how they're applied.
	Method              string
	RequestHeaders      *string // JSON object, validated on write by the monitor router
	RequestBody         *string
	FollowRedirects     bool
	ExpectedStatusCodes *string // "200", "200,201", "200-204,301"; nil/empty = any 2xx
	Keyword             *string
	KeywordInverted     bool
}

// IsDue reports whether this monitor's check interval has elapsed since its
// last check — mirrors isDue() in src/lib/monitor-worker.ts.
func (m Monitor) IsDue(now time.Time) bool {
	if m.LastCheckedAt == nil {
		return true
	}
	return now.Sub(*m.LastCheckedAt) >= intervalDuration(m.Interval)
}

var intervals = map[string]time.Duration{
	"15s": 15 * time.Second,
	"30s": 30 * time.Second,
	"60s": 60 * time.Second,
	"5m":  5 * time.Minute,
}

func intervalDuration(interval string) time.Duration {
	if d, ok := intervals[interval]; ok {
		return d
	}
	return intervals["60s"]
}

// CheckResult is what a checker (internal/checkers) produces for one monitor
// check — mirrors MonitorCheckResult in src/lib/monitor-worker.ts.
type CheckResult struct {
	Status       string // Up | Down | Degraded
	StatusCode   *int
	ResponseTime int
	Message      *string
	// NotAfter of the TLS certificate this check saw, when it was an HTTPS
	// check that got far enough to complete a handshake. Written straight
	// through to monitor."certExpiresAt" — a check that didn't observe a
	// certificate (plain HTTP, connection refused, non-HTTP monitor) leaves
	// nil here and clears the column, so the value on a monitor always
	// describes its most recent check rather than some older one.
	CertExpiresAt *time.Time
}

// Incident mirrors the `incident` table columns the workers read/write, plus
// the subset of its related Monitor needed for notification routing.
type Incident struct {
	ID              string
	Title           string
	Status          string
	MonitorID       *string
	EscalationStep  int
	LastEscalatedAt *time.Time
	CreatedAt       time.Time
	Monitor         *IncidentMonitorRef
}

// IncidentMonitorRef is the minimal Monitor shape carried alongside an
// Incident for notification routing (src/lib/incidents.ts's MonitorRef /
// IncidentNotifyContext).
type IncidentMonitorRef struct {
	ID                 string
	Name               string
	EscalationPolicyID *string
}

// EscalationStep mirrors one row of `escalation_step` joined with its
// `integration`, ordered by Order — exactly what escalateOverdueIncidents
// needs per policy.
type EscalationStep struct {
	Order         int
	DelayMinutes  int
	IntegrationID string
	Integration   Integration
}

// Integration mirrors the `integration` table.
type Integration struct {
	ID      string
	Name    string
	Type    string
	Target  string
	Secret  *string
	Enabled bool
}

// IntegrationDelivery mirrors the `integration_delivery` table.
type IntegrationDelivery struct {
	ID            string
	IntegrationID string
	Event         string
	Message       string
	Attempts      int
	Integration   Integration
}

// StatusPageSubscriber mirrors `status_page_subscriber` rows reachable from a
// given monitor via its published status pages.
type StatusPageSubscriber struct {
	Channel string // Email | Discord
	Target  string
}

// AppSettings mirrors the `app_settings` singleton row's columns the workers
// read.
type AppSettings struct {
	ID                       string
	SupportEmail             *string
	HTTPTimeoutSecs          int
	FailedAttemptsThreshold  int
	LatencyThreshold         int
	SSLCheckEnabled          bool
	CertExpiryWarningEnabled bool
	CertExpiryWarningDays    int
	CheckRetentionDays       int
	DeliveryRetentionDays    int
	VapidPublicKey           *string
	VapidPrivateKey          *string
}

// DailyStat is one monitor's aggregate for one UTC day — a row of
// `monitor_daily_stat`, produced by AggregateChecksByDay and written by
// UpsertDailyStat (both used by cmd/janitor).
type DailyStat struct {
	MonitorID       string
	Day             time.Time // UTC midnight
	TotalChecks     int
	UpChecks        int
	DegradedChecks  int
	DownChecks      int
	AvgResponseTime *int
	Uptime          float64
}
