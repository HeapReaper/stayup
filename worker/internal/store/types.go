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
	// How Keyword is applied: Contains | Regex | JsonPath. See
	// internal/checkers/assert.go; anything else falls back to Contains.
	AssertionType string
	JSONPath      *string

	// DNS-only options; "A" and nil for every other monitor type. See the
	// `monitor` model in src/prisma/schemas/*.prisma and
	// internal/checkers/dns.go.
	DNSRecordType    string
	DNSExpectedValue *string

	// Secret half of a non-HTTP check's credentials (Redis/database/mail
	// password). Never logged — logResult only ever prints URL and port.
	Credential *string

	// FlappingSince is non-nil while this monitor is in a flapping state, and
	// is what suppresses its incident churn (internal/flapping).
	FlappingSince *time.Time

	// Per-monitor overrides of the instance-wide monitoring defaults. Nil
	// means "use the AppSettings value" — resolved once per check by
	// settings.ForMonitor(), so nothing downstream has to know an override
	// exists.
	HTTPTimeoutSeconds      *int
	FailedAttemptsThreshold *int
	LatencyThresholdMs      *int

	// AutoIncidents is false for a monitor that must never open an incident
	// of its own accord: it is still checked, its status still moves and its
	// history is still written, but runner skips the incident — which is also
	// what stops it alerting, since every notification hangs off an incident.
	// Recovery is deliberately not gated on it (see runner.checkOne), so an
	// incident opened before the switch was flipped still closes out.
	AutoIncidents bool
}

// IsDue reports whether this monitor's check interval has elapsed since its
// last check — mirrors isDue() in src/lib/monitor-worker.ts.
func (m Monitor) IsDue(now time.Time) bool {
	if m.LastCheckedAt == nil {
		return true
	}
	return now.Sub(*m.LastCheckedAt) >= intervalDuration(m.Interval)
}

// Must stay in step with monitorIntervalEnum in src/trpc/routers/monitor.ts —
// an interval this map doesn't know silently becomes 60s, which for a Domain
// monitor would mean hammering RDAP once a minute.
var intervals = map[string]time.Duration{
	"15s": 15 * time.Second,
	"30s": 30 * time.Second,
	"60s": 60 * time.Second,
	"5m":  5 * time.Minute,
	"1h":  time.Hour,
	"12h": 12 * time.Hour,
	"24h": 24 * time.Hour,
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
	// The registry expiry a Domain check's RDAP lookup reported, and the same
	// contract as CertExpiresAt: written straight through to
	// monitor."domainExpiresAt", nil for every other monitor type.
	DomainExpiresAt *time.Time
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

// EscalationStep mirrors one row of `escalation_step`, ordered by Order —
// exactly what EscalateOverdueIncidents needs per policy. A step points at
// exactly one target: a fixed Integration, or an OnCallSchedule whose
// rotation is resolved at the moment the step fires (internal/oncall).
type EscalationStep struct {
	Order        int
	DelayMinutes int
	// Set (with Integration filled in) for a fixed-channel step.
	IntegrationID *string
	Integration   *Integration
	// Set for a rotation step; the schedule is loaded separately, by ID, so
	// its participants and overrides are always read fresh at paging time.
	OnCallScheduleID *string
}

// OnCallSchedule is one rotation with everything needed to resolve it: the
// roster in `order`, and every override that could still cover a lookup.
type OnCallSchedule struct {
	ID           string
	Name         string
	Timezone     string
	RotationType string // Daily | Weekly
	HandoffHour  int
	HandoffDay   int // ISO 1-7, Weekly only
	StartsAt     time.Time
	Participants []OnCallParticipant
	Overrides    []OnCallOverride
}

// OnCallParticipant is one person in a rotation, and the Integration that
// actually reaches them.
type OnCallParticipant struct {
	ID            string
	Order         int
	Name          string
	IntegrationID string
	Integration   Integration
}

// OnCallOverride replaces the rotation's answer for a fixed window. A nil
// ParticipantID means nobody covers it — deliberately, so paging falls
// through to the next escalation step instead of waking someone who is away.
type OnCallOverride struct {
	StartsAt      time.Time
	EndsAt        time.Time
	ParticipantID *string
	Reason        *string
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
	// IncidentID is nil for a delivery that isn't about an incident (a
	// "Send test"). When set, AlertForIncident turns it into the detail a
	// Discord embed shows next to the message.
	IncidentID  *string
	Event       string
	Message     string
	Attempts    int
	Integration Integration
}

// IncidentAlert is one incident joined with its monitor — the row behind a
// Discord embed's fields (internal/notify's BuildAlertEmbed). It exists so
// that both the queued-delivery path and the status-page subscriber path read
// the *same* columns, the way both TypeScript call sites share
// buildAlertContext() in src/lib/incidents.ts.
type IncidentAlert struct {
	IncidentID     string
	IncidentStatus string
	IncidentImpact string
	MonitorName    *string
	MonitorType    *string
	MonitorURL     *string
	MonitorStatus  *string
	ResponseTimeMs *int
	Uptime         *float64
	LastCheckedAt  *time.Time
}

// StatusPageSubscriber mirrors `status_page_subscriber` rows reachable from a
// given monitor via its published status pages.
type StatusPageSubscriber struct {
	Channel string // Email | Discord
	Target  string
}

// NotificationRule mirrors a `notification_rule` row plus the integration ids
// it routes to — the routing layer for monitors without an escalation policy
// (internal/routing).
type NotificationRule struct {
	ID      string
	Name    string
	Order   int
	Action  string // Route | Suppress
	Enabled bool

	MatchTagID     *string
	MatchMonitorID *string
	MatchImpact    *string

	ActiveDays        *string // comma-separated ISO weekdays, "1,2,3,4,5"
	ActiveFromMinute  *int    // minutes since local midnight
	ActiveUntilMinute *int

	IntegrationIDs []string
}

// AppSettings mirrors the `app_settings` singleton row's columns the workers
// read.
type AppSettings struct {
	ID           string
	SupportEmail *string
	// Timezone the notification rules' active windows are evaluated in.
	Timezone                   string
	HTTPTimeoutSecs            int
	FailedAttemptsThreshold    int
	LatencyThreshold           int
	SSLCheckEnabled            bool
	CertExpiryWarningEnabled   bool
	CertExpiryWarningDays      int
	DomainExpiryWarningEnabled bool
	DomainExpiryWarningDays    int
	FlappingEnabled            bool
	FlappingWindowMinutes      int
	FlappingThreshold          int
	CheckRetentionDays         int
	DeliveryRetentionDays      int
	// The Settings page's SMTP block. Every field is optional: a blank one
	// falls back to the matching SMTP_* environment variable, resolved in
	// internal/settings — same precedence as resolveSmtpConfig() in
	// src/lib/email.ts.
	SMTPHost        *string
	SMTPPort        *int
	SMTPUser        *string
	SMTPPass        *string
	SMTPFromEmail   *string
	SMTPFromName    *string
	SMTPUseTLS      bool
	VapidPublicKey  *string
	VapidPrivateKey *string
	// UpdateCheckEnabled off means cmd/janitor skips its daily update check —
	// the dashboard's "Check now" button still works. See internal/updates.
	UpdateCheckEnabled bool
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
	// Response-time distribution for the day, in ms. An average hides the
	// tail users actually feel, so the Reports page reads these instead.
	// Nil when no check that day recorded a response time.
	P50ResponseTime *int
	P95ResponseTime *int
	P99ResponseTime *int
	MaxResponseTime *int
	Uptime          float64
}
